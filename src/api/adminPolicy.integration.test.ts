import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { BaoClient } from './bao'
import { getGrantState, grantAccess, revokeAccess } from './grants'
import * as ids from './identities'
import * as secrets from './secrets'
import * as tokens from './tokens'
import { kvGrantRules } from '../model/managed'
import { deleteConfig, listConfigs, readConfig, runAction, writeConfig } from './engines/config'
import { generateCreds } from './engines/creds'
import { listLeases, lookupLease, renewLease, revokeLease, revokePrefix } from './engines/leases'
import { ENGINES } from './engines/registry'
import { pgTarget } from '../test/postgres'
import { createMount, deleteMount, mountImpact, PartialMountError, readKvConfig, tuneMount } from './mounts'
import { MOUNT_TYPES } from './engines/registry'
import { deleteRole, emptyDraft, listRoles, payloadFromDraft, readRole, writeRole } from './engines/roles'

// Everything the UI does, run with ONLY docs/envbao-admin.hcl (plus the default policy), so the
// documented least-privilege policy can't silently drift from what the app needs.
const root = new BaoClient(process.env.BAO_ADDR ?? 'http://127.0.0.1:8200', process.env.BAO_TOKEN ?? 'root')
const sfx = Math.random().toString(36).slice(2, 8)
const policyName = `it-admin-${sfx}`
let admin: BaoClient
let adminToken: tokens.CreatedToken

beforeAll(async () => {
  const auth = await root.request<{ data: Record<string, { type: string }> }>('GET', 'sys/auth')
  if (!Object.values(auth.data).some((m) => m.type === 'userpass')) {
    await root.request('POST', 'sys/auth/userpass', { type: 'userpass' })
  }
  await root.request('PUT', `sys/policies/acl/${policyName}`, { policy: readFileSync('docs/envbao-admin.hcl', 'utf8') })
  adminToken = await tokens.createToken(root, { displayName: policyName, policies: [policyName], renewable: false, orphan: false })
  admin = root.withToken(adminToken.token)
})

afterAll(async () => {
  await tokens.revokeToken(root, adminToken.accessor).catch(() => {})
  await root.request('DELETE', `sys/policies/acl/${policyName}`).catch(() => {})
})

describe('the documented admin policy is sufficient for every UI operation', () => {
  const user = `it-pol-u-${sfx}`
  const entity = `it-pol-e-${sfx}`
  const group = `it-pol-g-${sfx}`

  afterAll(async () => {
    await ids.deleteGroup(root, group).catch(() => {})
    await ids.deleteEntity(root, entity).catch(() => {})
    await ids.deleteUser(root, user).catch(() => {})
    await root.request('DELETE', `sys/policies/acl/envbao-user-${user}`).catch(() => {})
    await root.request('DELETE', `sys/policies/acl/envbao-group-${group}`).catch(() => {})
  })

  test('connect and discovery', async () => {
    expect((await admin.lookupSelf()).policies).toContain(policyName)
    expect((await secrets.listKvMounts(admin)).map((m) => m.path)).toContain('secret/')
    expect(await ids.userpassAccessor(admin)).toBeTruthy()
    await secrets.listSecrets(admin, 'secret/', '')
    await ids.listPolicyNames(admin)
  })

  test('users, entities, aliases and groups', async () => {
    await ids.saveUser(admin, { name: user, password: 'pw-123456', policies: ['default'] })
    expect((await ids.listUsers(admin)).some((u) => u.name === user)).toBe(true)

    await ids.saveEntity(admin, { name: entity, policies: [] })
    const e = await ids.readEntity(admin, entity)
    await ids.addAlias(admin, { name: user, entityId: e.id, mountAccessor: (await ids.userpassAccessor(admin))! })
    const withAlias = await ids.readEntity(admin, entity)
    expect(withAlias.aliases).toHaveLength(1)
    await ids.listEntities(admin)

    await ids.saveGroup(admin, { name: group, policies: [], memberEntityIds: [e.id] })
    await ids.listGroups(admin)

    await ids.deleteAlias(admin, withAlias.aliases[0].id)
    await ids.deleteGroup(admin, group)
    await ids.deleteEntity(admin, entity)
  })

  test('tokens: create, list, inspect, revoke', async () => {
    const t = await tokens.createToken(admin, { displayName: 'it-pol', policies: ['default'], ttl: '5m', renewable: false, orphan: false })
    expect((await tokens.listTokens(admin)).some((x) => x.accessor === t.accessor)).toBe(true)
    await tokens.revokeToken(admin, t.accessor)
  })

  test('grant and revoke', async () => {
    const target = { kind: 'user' as const, name: user }
    await grantAccess(admin, target, kvGrantRules('secret/', `it-pol-${sfx}/*`, ['read', 'list']))
    expect((await getGrantState(admin, target)).attached).toBe(true)
    await revokeAccess(admin, target, [`secret/data/it-pol-${sfx}/*`, `secret/metadata/it-pol-${sfx}/*`])
    expect((await getGrantState(admin, target)).attached).toBe(false)
  })

  test('the access graph inputs can be read', async () => {
    // (other test files create and delete policies concurrently, so only check ones we know exist)
    expect(await ids.listPolicyNames(admin)).toEqual(expect.arrayContaining(['default', policyName]))
    expect(await secrets.readPolicyHcl(admin, 'default')).not.toBeNull()
    expect(await secrets.readPolicyHcl(admin, policyName)).toContain('sys/policies/acl')
  })

  test('orphan tokens need sudo, which the policy deliberately omits', async () => {
    // surfaced to the user verbatim by the Tokens tab
    await expect(
      tokens.createToken(admin, { displayName: 'it-orphan', policies: ['default'], renewable: false, orphan: true }),
    ).rejects.toThrow(/sudo/)
  })
})

// docs/envbao-admin.hcl names the default mounts, so this needs the ssh engine at ssh/. It mounts one if the
// server has none (a dev server or CI), and skips rather than overwrite the CA of an ssh/ mount that was already there.
describe('the admin policy covers dynamic engines (ssh at the default mount)', () => {
  let mounted = false
  const ssh = ENGINES.ssh
  const role = ssh.roleKinds[0]
  const sshRole = `it-pol-${sfx}`

  beforeAll(async () => {
    const mounts = await root.request<{ data: Record<string, unknown> }>('GET', 'sys/mounts')
    if (!('ssh/' in mounts.data)) {
      await root.request('POST', 'sys/mounts/ssh', { type: 'ssh' })
      mounted = true
    }
  })
  afterAll(async () => {
    if (mounted) await root.request('DELETE', 'sys/mounts/ssh').catch(() => {})
  })

  test('config, roles, credentials and leases', async (ctx) => {
    if (!mounted) ctx.skip()
    const ca = ssh.configs[0]
    expect(await readConfig(admin, 'ssh/', ca)).toBeNull()
    await runAction(admin, 'ssh/', ca.actions![0])
    expect((await readConfig(admin, 'ssh/', ca))?.public_key).toBeTruthy()

    await writeRole(admin, 'ssh/', role, sshRole, { key_type: 'ca', allow_user_certificates: true, allowed_users: '*', default_user: 'alice' })
    expect(await listRoles(admin, 'ssh/', role)).toContain(sshRole)
    expect((await readRole(admin, 'ssh/', role, sshRole)).key_type).toBe('ca')
    const key = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIDI/MhHH9Rd3dBZwAa4gQOkxfuw0ogMWlO2G4rlINbfv it'
    expect((await generateCreds(admin, 'ssh/', role.creds[0], sshRole, { public_key: key })).data.signed_key).toBeTruthy()

    await writeRole(admin, 'ssh/', role, `${sshRole}-otp`, { key_type: 'otp', default_user: 'alice', cidr_list: '10.0.0.0/8' })
    const otp = await generateCreds(admin, 'ssh/', role.creds[1], `${sshRole}-otp`, { ip: '10.0.0.9' })
    expect((await listLeases(admin, 'ssh/creds/')).length).toBeGreaterThan(0)
    expect((await lookupLease(admin, otp.leaseId)).id).toBe(otp.leaseId)
    // OTP leases can't be renewed, so this fails; what matters is that it fails for that reason and not for permissions
    const renewError = await renewLease(admin, otp.leaseId).then(() => null, (e: Error) => e.message)
    expect(renewError).not.toBeNull()
    expect(renewError).not.toMatch(/permission denied/)
    await revokeLease(admin, otp.leaseId)

    const again = await generateCreds(admin, 'ssh/', role.creds[1], `${sshRole}-otp`, { ip: '10.0.0.10' })
    expect(again.leaseId).toBeTruthy()
    await revokePrefix(admin, `ssh/creds/${sshRole}-otp/`)

    await deleteRole(admin, 'ssh/', role, sshRole)
    await deleteRole(admin, 'ssh/', role, `${sshRole}-otp`)
    await deleteConfig(admin, 'ssh/', ca)
  })
})

// Same idea for the database engine at database/, when BAO_PG_URL points at a Postgres (see src/test/postgres.ts).
describe('the admin policy covers the database engine (at the default mount)', () => {
  const pg = pgTarget()
  const db = ENGINES.database
  let mounted = false

  beforeAll(async () => {
    const mounts = await root.request<{ data: Record<string, unknown> }>('GET', 'sys/mounts')
    if (pg && !('database/' in mounts.data)) {
      await root.request('POST', 'sys/mounts/database', { type: 'database' })
      mounted = true
    }
  })
  afterAll(async () => {
    if (mounted) await root.request('DELETE', 'sys/mounts/database').catch(() => {})
  })

  test('connection, roles, credentials and leases', async (ctx) => {
    if (!mounted) ctx.skip()
    const conn = db.configs[0]
    const kind = db.roleKinds[0]
    const cfg = emptyDraft(conn)
    Object.assign(cfg.values, pg!.values)
    await writeConfig(admin, 'database/', conn, payloadFromDraft(conn, cfg), 'app')
    expect(await listConfigs(admin, 'database/', conn)).toEqual(['app'])
    expect(await readConfig(admin, 'database/', conn, 'app')).not.toBeNull()
    await runAction(admin, 'database/', conn.actions![1], 'app')

    const role = emptyDraft(kind)
    role.values.db_name = 'app'
    role.values.creation_statements = pg!.creationStatements
    await writeRole(admin, 'database/', kind, 'ro', payloadFromDraft(kind, role))
    expect(await listRoles(admin, 'database/', kind)).toEqual(['ro'])
    expect((await readRole(admin, 'database/', kind, 'ro')).db_name).toBe('app')

    const creds = await generateCreds(admin, 'database/', kind.creds[0], 'ro', {})
    expect((await listLeases(admin, 'database/creds/ro/')).length).toBe(1)
    expect((await lookupLease(admin, creds.leaseId)).id).toBe(creds.leaseId)
    await revokeLease(admin, creds.leaseId)
    await generateCreds(admin, 'database/', kind.creds[0], 'ro', {})
    await revokePrefix(admin, 'database/creds/ro/')

    await deleteRole(admin, 'database/', kind, 'ro')
    await deleteConfig(admin, 'database/', conn, 'app')
  })
})

describe('the admin policy covers managing secrets engine mounts', () => {
  const kv = MOUNT_TYPES.find((t) => t.type === 'kv')!
  const sshType = MOUNT_TYPES.find((t) => t.type === 'ssh')!
  const made: string[] = []
  afterAll(async () => {
    for (const p of made) await root.request('DELETE', `sys/mounts/${p}`).catch(() => {})
  })
  const find = async (path: string) => (await secrets.listMounts(admin)).find((m) => m.path === path)

  test('create, tune, inspect and delete a dynamic engine', async () => {
    const path = `it-pol-ssh-${sfx}`
    made.push(path)
    await createMount(admin, path, sshType, { description: 'hosts', default_lease_ttl: '1h' })
    expect(await find(`${path}/`)).toMatchObject({ type: 'ssh', description: 'hosts', defaultLeaseTtl: 3600 })
    await tuneMount(admin, path, sshType, { description: 'changed' })
    expect(await find(`${path}/`)).toMatchObject({ description: 'changed', defaultLeaseTtl: 0 })
    expect((await mountImpact(admin, `${path}/`, 'ssh')).kind).toBe('dynamic')
    await deleteMount(admin, path)
    expect(await find(`${path}/`)).toBeUndefined()
  })

  test('create and delete a KV v2 store without settings', async () => {
    const path = `it-pol-kv-${sfx}`
    made.push(path)
    await createMount(admin, path, kv, { description: 'plain' })
    expect(await find(`${path}/`)).toMatchObject({ type: 'kv', version: '2' })
    await deleteMount(admin, path)
  })

  test('KV settings work on secret/ but not on other mounts, which the README says', async () => {
    // secret/config is the one KV config path the policy names
    const before = await readKvConfig(admin, 'secret/')
    await tuneMount(admin, 'secret/', kv, { description: 'key/value secret storage', max_versions: String(before.max_versions), cas_required: before.cas_required === true })

    const path = `it-pol-kvset-${sfx}`
    made.push(path)
    const err = await createMount(admin, path, kv, { max_versions: '3' }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PartialMountError)
    expect((err as Error).message).toMatch(/was mounted, but saving its KV settings failed: .*permission denied/s)
    expect(await find(`${path}/`)).toBeDefined()
  })
})
