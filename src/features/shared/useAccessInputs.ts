import { useQuery } from '@tanstack/react-query'
import type { BaoClient } from '../../api/bao'
import { listEntities, listGroups, listPolicyNames, listUsers } from '../../api/identities'
import { readPolicyHcl } from '../../api/secrets'
import { listTokens } from '../../api/tokens'
import type { Identity, PolicyInput } from '../../model/graph'
import { resolveIdentities } from '../../model/identities'

export interface AccessInputs {
  identities: Identity[]
  policies: PolicyInput[]
  /** Sources a limited admin could not read, so the picture may be incomplete. */
  notes: string[]
}

async function soft<T>(label: string, p: Promise<T>, fallback: T) {
  try {
    return { value: await p, note: null }
  } catch (e) {
    return { value: fallback, note: `${label}: ${e instanceof Error ? e.message : String(e)}` }
  }
}

/** Everything needed to compute who can reach what. Shared by the Access panel and the graph. */
export function useAccessInputs(client: BaoClient) {
  return useQuery({
    queryKey: ['access-inputs'],
    queryFn: async (): Promise<AccessInputs> => {
      const [users, entities, groups, tokens, names] = await Promise.all([
        soft('users', listUsers(client), []),
        soft('entities', listEntities(client), []),
        soft('groups', listGroups(client), []),
        soft('tokens', listTokens(client), []),
        listPolicyNames(client),
      ])
      const policies = await Promise.all(names.map(async (name) => ({ name, hcl: await readPolicyHcl(client, name) })))
      return {
        identities: resolveIdentities({
          users: users.value,
          entities: entities.value,
          groups: groups.value,
          tokens: tokens.value,
        }),
        policies,
        notes: [users, entities, groups, tokens].flatMap((r) => (r.note ? [r.note] : [])),
      }
    },
  })
}
