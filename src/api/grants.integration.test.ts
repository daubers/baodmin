import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { kvGrantRules } from '../model/managed'
import { BaoClient } from './bao'
import { getGrantState, grantAccess, revokeAccess, type Target } from './grants'
import * as ids from './identities'
import { capabilitiesSelf } from './secrets'

const client = new BaoClient(process.env.BAO_ADDR ?? 'http://127.0.0.1:8200', process.env.BAO_TOKEN ?? 'root')
const sfx = Math.random().toString(36).slice(2, 8)
const secretPath = `it-grant-${sfx}`

const loginCaps = async (user: string, path: string) => {
  const { token } = await client.loginUserpass(user, 'pw-123456')
  return (await capabilitiesSelf(client.withToken(token), path)).sort()
}

beforeAll(async () => {
  const mounts = await client.request<{ data: Record<string, { type: string }> }>('GET', 'sys/auth')
  if (!Object.values(mounts.data).some((m) => m.type === 'userpass')) {
    await client.request('POST', 'sys/auth/userpass', { type: 'userpass' })
  }
})

describe('grant / revoke against a dev OpenBao', () => {
  const user: Target = { kind: 'user', name: `it-gu-${sfx}` }
  const dataPath = `secret/data/${secretPath}/app/x`

  beforeAll(() => ids.saveUser(client, { name: user.name, password: 'pw-123456', policies: ['default'] }))
  afterAll(async () => {
    await ids.deleteUser(client, user.name).catch(() => {})
    await client.request('DELETE', `sys/policies/acl/envbao-user-${user.name}`).catch(() => {})
  })

  test('granting gives the user the capability on login, keeping existing policies', async () => {
    expect(await loginCaps(user.name, dataPath)).toEqual(['deny'])

    await grantAccess(client, user, kvGrantRules('secret/', `${secretPath}/app/*`, ['read', 'update', 'list']))

    expect(await loginCaps(user.name, dataPath)).toEqual(['read', 'update'])
    expect(await loginCaps(user.name, `secret/metadata/${secretPath}/app/x`)).toEqual(['list'])
    expect((await ids.readUser(client, user.name)).policies.sort()).toEqual(['default', `envbao-user-${user.name}`])
  })

  test('granting the same path again replaces its capabilities', async () => {
    await grantAccess(client, user, kvGrantRules('secret/', `${secretPath}/app/*`, ['read']))
    expect(await loginCaps(user.name, dataPath)).toEqual(['read'])
    // the metadata rule was dropped because list was deselected
    expect(await loginCaps(user.name, `secret/metadata/${secretPath}/app/x`)).toEqual(['deny'])
  })

  test('state reports managed grants and unmanaged policies', async () => {
    const s = await getGrantState(client, user)
    expect(s).toMatchObject({ attached: true, otherPolicies: ['default'] })
    expect(s.managed?.editable).toBe(true)
    expect(s.managed?.grants).toEqual([{ path: `secret/data/${secretPath}/app/*`, capabilities: ['read'] }])
  })

  test('revoking the last grant removes access, the policy and the attachment', async () => {
    await revokeAccess(client, user, [`secret/data/${secretPath}/app/*`])
    expect(await loginCaps(user.name, dataPath)).toEqual(['deny'])
    const s = await getGrantState(client, user)
    expect(s).toMatchObject({ attached: false, hcl: null, otherPolicies: ['default'] })
  })

  test('refuses to edit a managed policy that was changed outside EnvBao', async () => {
    await grantAccess(client, user, kvGrantRules('secret/', `${secretPath}/a`, ['read']))
    await client.request('PUT', `sys/policies/acl/envbao-user-${user.name}`, {
      policy: '# envbao-owner: user:' + user.name + '\npath "x" {\n capabilities = ["read"]\n allowed_parameters = { "a" = [] }\n}',
    })
    await expect(grantAccess(client, user, kvGrantRules('secret/', `${secretPath}/b`, ['read']))).rejects.toThrow(/edited outside/)
  })

  test('refuses to overwrite a policy owned by a different identity with a colliding name', async () => {
    const other: Target = { kind: 'user', name: user.name.toUpperCase() } // same sanitised policy name
    await expect(grantAccess(client, other, kvGrantRules('secret/', `${secretPath}/c`, ['read']))).rejects.toThrow(/not managed/)
  })
})

describe('entity and group grants', () => {
  const uname = `it-eu-${sfx}`
  const entity: Target = { kind: 'entity', name: `it-ge-${sfx}` }
  const group: Target = { kind: 'group', name: `it-gg-${sfx}` }
  const path = `secret/data/${secretPath}/ent`

  afterAll(async () => {
    await ids.deleteGroup(client, group.name).catch(() => {})
    await ids.deleteEntity(client, entity.name).catch(() => {})
    await ids.deleteUser(client, uname).catch(() => {})
    for (const p of [`envbao-entity-${entity.name}`, `envbao-group-${group.name}`]) {
      await client.request('DELETE', `sys/policies/acl/${p}`).catch(() => {})
    }
  })

  test('entity and group policies reach an aliased userpass login', async () => {
    await ids.saveUser(client, { name: uname, password: 'pw-123456', policies: ['default'] })
    await ids.saveEntity(client, { name: entity.name, policies: [] })
    const e = await ids.readEntity(client, entity.name)
    await ids.addAlias(client, { name: uname, entityId: e.id, mountAccessor: (await ids.userpassAccessor(client))! })
    await ids.saveGroup(client, { name: group.name, policies: [], memberEntityIds: [e.id] })

    await grantAccess(client, entity, [{ path, capabilities: ['read'] }])
    expect(await loginCaps(uname, path)).toEqual(['read'])

    await grantAccess(client, group, [{ path: `${path}2`, capabilities: ['update'] }])
    expect(await loginCaps(uname, `${path}2`)).toEqual(['update'])
    // group membership is preserved by the policy update
    expect((await ids.readGroup(client, group.name)).member_entity_ids).toEqual([e.id])

    await revokeAccess(client, entity, [path])
    expect(await loginCaps(uname, path)).toEqual(['deny'])
  })
})
