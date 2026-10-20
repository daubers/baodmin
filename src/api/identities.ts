import type { BaoClient } from './bao'

const enc = encodeURIComponent

export interface UserpassUser {
  name: string
  policies: string[]
  ttl: number
}

export interface EntityAlias {
  id: string
  name: string
  mount_accessor: string
  mount_path: string
}

export interface Entity {
  id: string
  name: string
  policies: string[]
  disabled: boolean
  aliases: EntityAlias[]
}

export interface Group {
  id: string
  name: string
  policies: string[]
  member_entity_ids: string[]
}

export async function listPolicyNames(c: BaoClient): Promise<string[]> {
  return c.list('sys/policies/acl')
}

// ---- userpass users ----

export async function listUsers(c: BaoClient): Promise<UserpassUser[]> {
  const names = await c.list('auth/userpass/users')
  return Promise.all(names.map((n) => readUser(c, n)))
}

export async function readUser(c: BaoClient, name: string): Promise<UserpassUser> {
  const res = await c.request<{ data: { token_policies?: string[]; token_ttl?: number } }>(
    'GET',
    `auth/userpass/users/${enc(name)}`,
  )
  return { name, policies: res.data.token_policies ?? [], ttl: res.data.token_ttl ?? 0 }
}

/** `password` is omitted on edit to keep the existing one. */
export async function saveUser(
  c: BaoClient,
  user: { name: string; password?: string; policies: string[]; ttl?: string },
): Promise<void> {
  await c.request('POST', `auth/userpass/users/${enc(user.name)}`, {
    ...(user.password ? { password: user.password } : {}),
    token_policies: user.policies,
    ...(user.ttl ? { token_ttl: user.ttl } : {}),
  })
}

export async function deleteUser(c: BaoClient, name: string): Promise<void> {
  await c.request('DELETE', `auth/userpass/users/${enc(name)}`)
}

/** Mount accessor of the userpass auth method, needed to create entity aliases. */
export async function userpassAccessor(c: BaoClient): Promise<string | null> {
  const res = await c.request<{ data: Record<string, { accessor: string; type: string }> }>('GET', 'sys/auth')
  return Object.values(res.data).find((m) => m.type === 'userpass')?.accessor ?? null
}

// ---- entities ----

export async function listEntities(c: BaoClient): Promise<Entity[]> {
  const names = await c.list('identity/entity/name')
  return Promise.all(names.map((n) => readEntity(c, n)))
}

export async function readEntity(c: BaoClient, name: string): Promise<Entity> {
  const res = await c.request<{ data: Partial<Entity> & { id: string } }>('GET', `identity/entity/name/${enc(name)}`)
  const d = res.data
  return { id: d.id, name, policies: d.policies ?? [], disabled: d.disabled ?? false, aliases: d.aliases ?? [] }
}

export async function saveEntity(
  c: BaoClient,
  e: { name: string; policies: string[]; disabled?: boolean },
): Promise<void> {
  await c.request('POST', `identity/entity/name/${enc(e.name)}`, { policies: e.policies, disabled: e.disabled ?? false })
}

export async function deleteEntity(c: BaoClient, name: string): Promise<void> {
  await c.request('DELETE', `identity/entity/name/${enc(name)}`)
}

export async function addAlias(
  c: BaoClient,
  a: { name: string; entityId: string; mountAccessor: string },
): Promise<void> {
  await c.request('POST', 'identity/entity-alias', {
    name: a.name,
    canonical_id: a.entityId,
    mount_accessor: a.mountAccessor,
  })
}

export async function deleteAlias(c: BaoClient, aliasId: string): Promise<void> {
  await c.request('DELETE', `identity/entity-alias/id/${enc(aliasId)}`)
}

// ---- groups ----

export async function listGroups(c: BaoClient): Promise<Group[]> {
  const names = await c.list('identity/group/name')
  return Promise.all(names.map((n) => readGroup(c, n)))
}

export async function readGroup(c: BaoClient, name: string): Promise<Group> {
  const res = await c.request<{ data: Partial<Group> & { id: string } }>('GET', `identity/group/name/${enc(name)}`)
  const d = res.data
  return { id: d.id, name, policies: d.policies ?? [], member_entity_ids: d.member_entity_ids ?? [] }
}

export async function saveGroup(
  c: BaoClient,
  g: { name: string; policies: string[]; memberEntityIds: string[] },
): Promise<void> {
  await c.request('POST', `identity/group/name/${enc(g.name)}`, {
    type: 'internal',
    policies: g.policies,
    member_entity_ids: g.memberEntityIds,
  })
}

export async function deleteGroup(c: BaoClient, name: string): Promise<void> {
  await c.request('DELETE', `identity/group/name/${enc(name)}`)
}
