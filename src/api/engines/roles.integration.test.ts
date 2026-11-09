import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { BaoClient } from '../bao'
import { readConfig, runAction, writeConfig, deleteConfig } from './config'
import { generateCreds } from './creds'
import { listLeases, lookupLease, renewLease, revokeLease, revokePrefix } from './leases'
import { accessForPath } from '../../model/graph'
import { dynamicGrantRules, renderManagedPolicy } from '../../model/managed'
import { pathMatches } from '../../model/policy'
import { capabilitiesSelf, listMounts } from '../secrets'
import { createToken, revokeToken } from '../tokens'
import { ENGINES } from './registry'
import { deleteRole, draftFromRole, emptyDraft, listRoles, payloadFromDraft, readRole, writeRole } from './roles'

const client = new BaoClient(process.env.BAO_ADDR ?? 'http://127.0.0.1:8200', process.env.BAO_TOKEN ?? 'root')
const sfx = Math.random().toString(36).slice(2, 8)
const mount = `it-ssh-${sfx}/`
const kind = ENGINES.ssh.roleKinds[0]
const awsMount = `it-aws-${sfx}/`
// Not every OpenBao build bundles the AWS engine (some ship it as an external plugin).
let awsAvailable = false
// A throwaway public key made only for this test; there is no matching private key anywhere.
const PUBLIC_KEY = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIDI/MhHH9Rd3dBZwAa4gQOkxfuw0ogMWlO2G4rlINbfv it'

beforeAll(async () => {
  await client.request('POST', `sys/mounts/${mount.slice(0, -1)}`, { type: 'ssh' })
  awsAvailable = await client
    .request('POST', `sys/mounts/${awsMount.slice(0, -1)}`, { type: 'aws' })
    .then(() => true)
    .catch(() => false)
})

afterAll(async () => {
  await client.request('DELETE', `sys/mounts/${mount.slice(0, -1)}`).catch(() => {})
  await client.request('DELETE', `sys/mounts/${awsMount.slice(0, -1)}`).catch(() => {})
})

describe('dynamic engine roles (ssh)', () => {
  test('the new mount is listed with its type', async () => {
    const m = (await listMounts(client)).find((x) => x.path === mount)
    expect(m?.type).toBe('ssh')
  })

  test('creates, lists, edits and deletes a role through the form model', async () => {
    expect(await listRoles(client, mount, kind)).toEqual([])

    const draft = emptyDraft(kind)
    draft.values.key_type = 'ca'
    draft.values.allowed_users = 'alice,bob'
    draft.values.ttl = '30m'
    draft.values.allow_user_certificates = true
    await writeRole(client, mount, kind, 'ops', payloadFromDraft(kind, draft))
    expect(await listRoles(client, mount, kind)).toEqual(['ops'])

    const read = draftFromRole(kind, 'ops', await readRole(client, mount, kind, 'ops'))
    expect(read.values).toMatchObject({ key_type: 'ca', allowed_users: 'alice,bob', ttl: '1800s', allow_user_certificates: true })

    // an edit writes the whole role back, so values it did not touch must survive
    read.values.max_ttl = '2h'
    await writeRole(client, mount, kind, 'ops', payloadFromDraft(kind, read))
    const again = draftFromRole(kind, 'ops', await readRole(client, mount, kind, 'ops'))
    expect(again.values).toMatchObject({ allowed_users: 'alice,bob', ttl: '1800s', max_ttl: '7200s' })

    await deleteRole(client, mount, kind, 'ops')
    expect(await listRoles(client, mount, kind)).toEqual([])
  })
})

describe('dynamic engine config and credentials', () => {
  const ca = ENGINES.ssh.configs[0]

  test('an unconfigured CA reads as null, then generate, sign and delete', async () => {
    expect(await readConfig(client, mount, ca)).toBeNull()

    await runAction(client, mount, ca.actions![0])
    const cfg = await readConfig(client, mount, ca)
    expect(cfg?.public_key).toMatch(/^ssh-rsa /)

    const role = emptyDraft(kind)
    role.values.allow_user_certificates = true
    role.values.allowed_users = '*'
    role.values.default_user = 'alice'
    role.values.ttl = '10m'
    await writeRole(client, mount, kind, 'signer', payloadFromDraft(kind, role))

    const sign = kind.creds[0]
    const out = await generateCreds(client, mount, sign, 'signer', { public_key: PUBLIC_KEY })
    expect(String(out.data.signed_key)).toMatch(/^ssh-ed25519-cert-v01@openssh.com /)

    await deleteConfig(client, mount, ca)
    expect(await readConfig(client, mount, ca)).toBeNull()
  })

  test('OTP credentials come with a lease that can be revoked', async () => {
    const role = emptyDraft(kind)
    role.values.key_type = 'otp'
    role.values.default_user = 'alice'
    role.values.cidr_list = '10.0.0.0/8'
    await writeRole(client, mount, kind, 'otp', payloadFromDraft(kind, role))

    const out = await generateCreds(client, mount, kind.creds[1], 'otp', { ip: '10.1.2.3' })
    expect(out.leaseId).toContain('/creds/otp/')
    expect(out.data.key).toBeTruthy()
    await revokeLease(client, out.leaseId)
  })

  test('leases can be browsed, inspected, renewed and revoked by prefix', async () => {
    const a = await generateCreds(client, mount, kind.creds[1], 'otp', { ip: '10.1.2.3' })
    const b = await generateCreds(client, mount, kind.creds[1], 'otp', { ip: '10.1.2.4' })

    // folders first: mount -> creds/ -> otp/ -> lease ids
    expect(await listLeases(client, mount)).toContainEqual({ name: 'creds/', path: `${mount}creds/`, isFolder: true })
    const ids = (await listLeases(client, `${mount}creds/otp/`)).map((e) => e.path)
    expect(ids).toEqual(expect.arrayContaining([a.leaseId, b.leaseId]))

    const info = await lookupLease(client, a.leaseId)
    expect(info.id).toBe(a.leaseId)
    expect(info.ttl).toBeGreaterThan(0)
    expect(info.renewable).toBe(false)
    // OTP leases are not renewable, and the UI only offers Renew when renewable; OpenBao says so itself
    await expect(renewLease(client, a.leaseId)).rejects.toThrow()

    await revokePrefix(client, `${mount}creds/otp/`)
    expect(await listLeases(client, `${mount}creds/otp/`)).toEqual([])
  })

  test('single-endpoint config round-trips (aws lease)', async (ctx) => {
    if (!awsAvailable) ctx.skip()
    const lease = ENGINES.aws.configs[1]
    await writeConfig(client, awsMount, lease, { lease: '30m', lease_max: '2h' })
    expect(await readConfig(client, awsMount, lease)).toMatchObject({ lease: '30m0s', lease_max: '2h0m0s' })
  })
})

describe('grants on dynamic roles match what OpenBao enforces', () => {
  const polName = `it-dyn-${sfx}`
  const ca = ENGINES.ssh.configs[0]
  let token: Awaited<ReturnType<typeof createToken>>

  beforeAll(async () => {
    const role = emptyDraft(kind)
    role.values.allow_user_certificates = true
    role.values.allowed_users = '*'
    role.values.default_user = 'alice'
    for (const name of ['granted', 'other']) await writeRole(client, mount, kind, name, payloadFromDraft(kind, role))
    await runAction(client, mount, ca.actions![0])

    const grants = dynamicGrantRules(kind, mount, 'granted', ['generate', 'manage']).filter((g) => g.capabilities.length)
    await client.request('PUT', `sys/policies/acl/${polName}`, { policy: renderManagedPolicy('user', 'x', grants) })
    token = await createToken(client, { displayName: polName, policies: [polName], renewable: false, orphan: false })
  })

  afterAll(async () => {
    await revokeToken(client, token.accessor).catch(() => {})
    await client.request('DELETE', `sys/policies/acl/${polName}`).catch(() => {})
  })

  test('capabilities-self agrees with the access model for granted and other roles', async () => {
    const as = client.withToken(token.token)
    const hcl = renderManagedPolicy('user', 'x', dynamicGrantRules(kind, mount, 'granted', ['generate', 'manage']).filter((g) => g.capabilities.length))
    const who = [{ kind: 'user' as const, name: 'x', policies: [polName] }]
    for (const role of ['granted', 'other']) {
      for (const path of [`${mount}sign/${role}`, `${mount}creds/${role}`, `${mount}roles/${role}`]) {
        const real = (await capabilitiesSelf(as, path)).filter((c) => c !== 'deny').sort()
        const modelled = accessForPath(who, [{ name: polName, hcl }], path, pathMatches).flatMap((e) => e.capabilities).sort()
        expect(modelled, path).toEqual(real)
      }
    }
  })

  test('the granted token can sign with its role and not with another', async () => {
    const as = client.withToken(token.token)
    const out = await generateCreds(as, mount, kind.creds[0], 'granted', { public_key: PUBLIC_KEY })
    expect(String(out.data.signed_key)).toContain('cert-v01')
    await expect(generateCreds(as, mount, kind.creds[0], 'other', { public_key: PUBLIC_KEY })).rejects.toThrow()
    expect(await listRoles(as, mount, kind)).toEqual(expect.arrayContaining(['granted']))
  })
})
