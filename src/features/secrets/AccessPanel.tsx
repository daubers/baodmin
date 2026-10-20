import { useState } from 'react'
import type { BaoClient } from '../../api/bao'
import { dataPath } from '../../api/secrets'
import { accessForPath } from '../../model/graph'
import { pathMatches } from '../../model/policy'
import { CapabilityChips } from '../shared/CapabilityChips'
import { useAccessInputs } from '../shared/useAccessInputs'
import { GrantHere } from './GrantHere'

interface Props {
  client: BaoClient
  mount: string
  secret: string
}

export function AccessPanel({ client, mount, secret }: Props) {
  const data = useAccessInputs(client)
  const path = dataPath(mount, secret)
  const [granting, setGranting] = useState(false)
  const [granted, setGranted] = useState<string | null>(null)

  return (
    <section aria-label="Access" className="secret-detail">
      <header>
        <div>
          <h2>{secret}</h2>
          <code>{path}</code>
        </div>
        {!granting && (
          <button
            type="button"
            disabled={!data.data}
            onClick={() => {
              setGranted(null)
              setGranting(true)
            }}
          >
            Grant access
          </button>
        )}
      </header>
      {granted && (
        <p role="status" className="note-ok">
          {granted}
        </p>
      )}
      {granting && data.data && (
        <GrantHere
          client={client}
          mount={mount}
          secret={secret}
          identities={data.data.identities}
          onClose={() => setGranting(false)}
          onGranted={(message) => {
            setGranting(false)
            setGranted(message)
          }}
        />
      )}
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
                <td data-label="Via policy">
                  <code>{e.policy}</code>
                </td>
                <td data-label="Can">
                  <CapabilityChips capabilities={e.capabilities} />
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
