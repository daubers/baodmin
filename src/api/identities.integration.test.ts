import { beforeAll, describe, expect, test } from 'vitest'
import { BaoClient } from './bao'
import * as api from './identities'

const client = new BaoClient(process.env.BAO_ADDR ?? 'http://127.0.0.1:8200', process.env.BAO_TOKEN ?? 'root')
const suffix = Math.random().toString(36).slice(2, 8)

beforeAll(async () => {
  const mounts = await client.request<{ data: Record<string, { type: string }> }>('GET', 'sys/auth')
  if (!Object.values(mounts.data).some((m) => m.type === 'userpass')) {
    await client.request('POST', 'sys/auth/userpass', { type: 'userpass' })
  }
})

describe('identity API against a dev OpenBao', () => {
  test('userpass user CRUD', async () => {
    const name = `it-user-${suffix}`
    await api.saveUser(client, { name, password: 'pw-123456', policies: ['default'], ttl: '1h' })
    expect((await api.listUsers(client)).find((u) => u.name === name)).toMatchObject({
      policies: ['default'],
      ttl: 3600,
    })

    // edit without a password keeps the old one and updates policies
    await api.saveUser(client, { name, policies: ['default', 'it-extra'] })
    expect((await api.readUser(client, name)).policies).toEqual(['default', 'it-extra'])
    const login = await client.loginUserpass(name, 'pw-123456')
    expect(login.token).toBeTruthy()

    await api.deleteUser(client, name)
    expect((await api.listUsers(client)).some((u) => u.name === name)).toBe(false)
  })

  test('entity with alias, and group membership', async () => {
    const user = `it-alias-${suffix}`
    const ename = `it-entity-${suffix}`
    const gname = `it-group-${suffix}`
    await api.saveUser(client, { name: user, password: 'pw-123456', policies: [] })

    await api.saveEntity(client, { name: ename, policies: ['default'] })
    const entity = await api.readEntity(client, ename)
    const accessor = await api.userpassAccessor(client)
    expect(accessor).toBeTruthy()
    await api.addAlias(client, { name: user, entityId: entity.id, mountAccessor: accessor! })
    const withAlias = await api.readEntity(client, ename)
    expect(withAlias.aliases).toHaveLength(1)
    expect(withAlias.aliases[0].name).toBe(user)

    await api.saveGroup(client, { name: gname, policies: ['default'], memberEntityIds: [entity.id] })
    expect((await api.listGroups(client)).find((g) => g.name === gname)?.member_entity_ids).toEqual([entity.id])

    await api.deleteGroup(client, gname)
    await api.deleteAlias(client, withAlias.aliases[0].id)
    expect((await api.readEntity(client, ename)).aliases).toHaveLength(0)
    await api.deleteEntity(client, ename)
    await api.deleteUser(client, user)
    expect((await api.listEntities(client)).some((e) => e.name === ename)).toBe(false)
  })
})
