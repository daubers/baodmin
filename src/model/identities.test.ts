import { expect, test } from 'vitest'
import { resolveIdentities } from './identities'

const entity = (over = {}) => ({
  id: 'e1',
  name: 'alice-entity',
  policies: ['ent'],
  disabled: false,
  aliases: [{ id: 'a1', name: 'alice', mount_accessor: 'x', mount_path: 'auth/userpass/' }],
  ...over,
})

test('user inherits aliased entity and group policies', () => {
  const ids = resolveIdentities({
    users: [{ name: 'alice', policies: ['own'], ttl: 0 }],
    entities: [entity()],
    groups: [{ id: 'g1', name: 'devs', policies: ['grp'], member_entity_ids: ['e1'] }],
    tokens: [],
  })
  expect(ids.find((i) => i.kind === 'user')?.policies.sort()).toEqual(['ent', 'grp', 'own'])
  expect(ids.find((i) => i.kind === 'entity')?.policies.sort()).toEqual(['ent', 'grp'])
  expect(ids.find((i) => i.kind === 'group')?.policies).toEqual(['grp'])
})

test('disabled entities and aliases on other mounts are not inherited', () => {
  const users = [{ name: 'alice', policies: ['own'], ttl: 0 }]
  const disabled = resolveIdentities({ users, entities: [entity({ disabled: true })], groups: [], tokens: [] })
  expect(disabled.find((i) => i.kind === 'user')?.policies).toEqual(['own'])

  const other = entity({ aliases: [{ id: 'a', name: 'alice', mount_accessor: 'x', mount_path: 'auth/ldap/' }] })
  const res = resolveIdentities({ users, entities: [other], groups: [], tokens: [] })
  expect(res.find((i) => i.kind === 'user')?.policies).toEqual(['own'])
})

test('tokens are named by display name, falling back to accessor', () => {
  const t = { accessor: 'acc', display_name: '', policies: ['p'], ttl: 0, renewable: false, orphan: false, creation_time: '', expire_time: null }
  const res = resolveIdentities({ users: [], entities: [], groups: [], tokens: [t, { ...t, display_name: 'token-ci' }] })
  expect(res.map((i) => i.name)).toEqual(['acc', 'token-ci'])
})
