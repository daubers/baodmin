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

// Capabilities that let someone change or remove the secret, or bypass policy checks.
const RISKY = new Set(['delete', 'sudo'])

export function AccessPanel({ client, mount, secret }: Props) {
  const data = useAccessInputs(client)
  const path = dataPath(mount, secret)

  return (
    <section aria-label="Access" className="secret-detail">
      <header>
        <h2>{secret}</h2>
        <code>{path}</code>
      </header>
      {data.isPending && <p className="hint">Loading access…</p>}
      {data.error && <p role="alert">Could not load access: {data.error.message}</p>}
      {data.data && <Entries data={data.data} path={path} />}
    </section>
  )
}

function Entries({ data, path }: { data: NonNullable<ReturnType<typeof useAccessInputs>['data']>; path: string }) {
  const entries = accessForPath(data.identities, data.policies, path, pathMatches)
  return (
    <>
      {data.notes.map((n) => (
        <p key={n} role="alert">
          Incomplete: could not read {n}
        </p>
      ))}
      {entries.length === 0 ? (
        <p>No identity can reach this secret.</p>
      ) : (
        <table aria-label="Who can access this secret">
          <thead>
            <tr>
              <th>Identity</th>
              <th>Via policy</th>
              <th>Can</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={`${e.identity.kind}:${e.identity.name}:${e.policy}`}>
                <td>
                  <span>{e.identity.name}</span> <span className="tag">{e.identity.kind}</span>
                </td>
                <td>
                  <code>{e.policy}</code>
                </td>
                <td>
                  {e.policy === 'root' ? (
                    <ul className="chips">
                      <li className="risky">full access</li>
                    </ul>
                  ) : (
                    <ul className="chips">
                      {e.capabilities.map((c) => (
                        <li key={c} className={RISKY.has(c) ? 'risky' : undefined}>
                          {c}
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="hint">
        Only the most specific matching policy path applies, as in OpenBao. Parameter constraints and templated paths are approximated.
      </p>
    </>
  )
}
