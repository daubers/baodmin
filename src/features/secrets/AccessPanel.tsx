import type { BaoClient } from '../../api/bao'
import { dataPath } from '../../api/secrets'
import { accessForPath } from '../../model/graph'
import { pathMatches } from '../../model/policy'
import { useAccessInputs } from '../shared/useAccessInputs'

interface Props {
  client: BaoClient
  mount: string
  secret: string
}

export function AccessPanel({ client, mount, secret }: Props) {
  const data = useAccessInputs(client)

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
