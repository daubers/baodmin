import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { BaoClient } from './bao'
import { getGrantState, grantAccess, revokeAccess } from './grants'
import * as ids from './identities'
import * as secrets from './secrets'
import * as tokens from './tokens'
import { kvGrantRules } from '../model/managed'

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
