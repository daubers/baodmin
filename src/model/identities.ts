import type { Entity, Group, UserpassUser } from '../api/identities'
import type { TokenSummary } from '../api/tokens'
import type { Identity } from './graph'

interface Sources {
  users: UserpassUser[]
  entities: Entity[]
  groups: Group[]
  tokens: TokenSummary[]
}

const USERPASS_MOUNT = 'auth/userpass/'

/**
 * Flatten OpenBao's identity sources into the graph's Identity list.
 * A userpass user's effective policies are its own plus those of any entity aliased
 * to it and the groups that entity belongs to, which is what the token it logs in
 * with receives. Entities also include their groups' policies.
 */
export function resolveIdentities({ users, entities, groups, tokens }: Sources): Identity[] {
  const groupPolicies = (entityId: string) =>
    groups.filter((g) => g.member_entity_ids.includes(entityId)).flatMap((g) => g.policies)

  const out: Identity[] = []

  for (const u of users) {
    const entity = entities.find((e) => !e.disabled && e.aliases.some((a) => a.name === u.name && a.mount_path === USERPASS_MOUNT))
    const policies = [...u.policies, ...(entity ? [...entity.policies, ...groupPolicies(entity.id)] : [])]
    out.push({ kind: 'user', name: u.name, policies: [...new Set(policies)] })
  }
  for (const e of entities) {
    out.push({ kind: 'entity', name: e.name, policies: [...new Set([...e.policies, ...groupPolicies(e.id)])] })
  }
  for (const g of groups) out.push({ kind: 'group', name: g.name, policies: g.policies })
  for (const t of tokens) {
    out.push({ kind: 'token', name: t.display_name || t.accessor, policies: t.policies })
  }
  return out
}
