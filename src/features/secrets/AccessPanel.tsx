import { useQuery } from '@tanstack/react-query'
import type { BaoClient } from '../../api/bao'
import { listEntities, listGroups, listPolicyNames, listUsers } from '../../api/identities'
import { dataPath, readPolicyHcl } from '../../api/secrets'
import { listTokens } from '../../api/tokens'
import { accessForPath } from '../../model/graph'
import { resolveIdentities } from '../../model/identities'
import { pathMatches } from '../../model/policy'

interface Props {
  client: BaoClient
  mount: string
  secret: string
}

export function AccessPanel({ client, mount, secret }: Props) {
  const data = useQuery({
    queryKey: ['access-inputs'],
    queryFn: async () => {
      // Each source can be forbidden for a limited admin, so a failure degrades to "none" with a note.
      const soft = async <T,>(label: string, p: Promise<T>, fallback: T) => {
        try {
          return { value: await p, note: null }
        } catch (e) {
          return { value: fallback, note: `${label}: ${e instanceof Error ? e.message : String(e)}` }
        }
      }
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

  if (data.isPending) return <p>Loading access…</p>
  if (data.error) return <p role="alert">Could not load access: {data.error.message}</p>

  const path = dataPath(mount, secret)
  const entries = accessForPath(data.data.identities, data.data.policies, path, pathMatches)

  return (
    <section aria-label="Access">
      <h2>Access to {secret}</h2>
      <p>
        Evaluated against <code>{path}</code>
      </p>
      {data.data.notes.map((n) => (
        <p key={n} role="alert">
          Incomplete: could not read {n}
        </p>
      ))}
      {entries.length === 0 ? (
        <p>No identity can reach this secret.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Identity</th>
              <th>Type</th>
              <th>Via policy</th>
              <th>Capabilities</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={`${e.identity.kind}:${e.identity.name}:${e.policy}`}>
                <td>{e.identity.name}</td>
                <td>{e.identity.kind}</td>
                <td>{e.policy}</td>
                <td>{e.capabilities.join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="hint">
        Only the most specific matching policy path applies, as in OpenBao. Parameter constraints and templated paths are approximated.
      </p>
    </section>
  )
}
