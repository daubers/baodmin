import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import type { BaoClient } from '../../api/bao'
import { listKvMounts, listSecrets } from '../../api/secrets'
import { RequireConnection } from '../shared/RequireConnection'
import { AccessPanel } from './AccessPanel'

function Browser({ client }: { client: BaoClient }) {
  const mounts = useQuery({ queryKey: ['kv-mounts'], queryFn: () => listKvMounts(client) })
  const [mountChoice, setMount] = useState<string | null>(null)
  const [prefix, setPrefix] = useState('')
  const [selected, setSelected] = useState<string | null>(null)

  const mount = mountChoice ?? mounts.data?.[0]?.path ?? null
  const entries = useQuery({
    queryKey: ['kv-list', mount, prefix],
    queryFn: () => listSecrets(client, mount!, prefix),
    enabled: mount !== null,
  })

  const crumbs = prefix.split('/').filter(Boolean)
  const go = (p: string) => {
    setPrefix(p)
    setSelected(null)
  }

  if (mounts.error) return <p role="alert">{mounts.error.message}</p>
  if (mounts.isPending) return <p>Loading…</p>
  if (!mount) return <p>No KV v2 secrets engines are mounted.</p>

  const where = prefix ? `${mount}${prefix}` : mount

  return (
    <div className="secrets-layout">
      <div className="secrets-browser">
        <nav aria-label="Path" className="crumbs">
          {mounts.data.length > 1 && (
            <select
              aria-label="Mount"
              value={mount}
              onChange={(e) => {
                setMount(e.target.value)
                go('')
              }}
            >
              {mounts.data.map((m) => (
                <option key={m.path}>{m.path}</option>
              ))}
            </select>
          )}
          <button type="button" onClick={() => go('')}>
            {mount}
          </button>
          {crumbs.map((c, i) => (
            <button key={i} type="button" onClick={() => go(crumbs.slice(0, i + 1).join('/') + '/')}>
              {c}/
            </button>
          ))}
        </nav>
        {entries.isPending && <p className="hint">Loading…</p>}
        {entries.error && <p role="alert">{entries.error.message}</p>}
        {entries.data?.length === 0 && <p className="hint">No secrets in {where} yet.</p>}
        {!!entries.data?.length && (
          <ul className="entries" aria-label={`Contents of ${where}`}>
            {entries.data.map((e) => (
              <li key={e.path}>
                <button
                  type="button"
                  className={e.isFolder ? 'entry-folder' : undefined}
                  aria-pressed={e.isFolder ? undefined : selected === e.path}
                  onClick={() => (e.isFolder ? go(e.path) : setSelected(e.path))}
                >
                  {e.name}
                  {e.isFolder && <span aria-hidden="true">›</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {selected ? (
        <AccessPanel key={`${mount}${selected}`} client={client} mount={mount} secret={selected} />
      ) : (
        <p className="secret-placeholder">Select a secret to see who can reach it.</p>
      )}
    </div>
  )
}

export function SecretsPage() {
  return (
    <section>
      <h1>Secrets</h1>
      <RequireConnection>{(client) => <Browser client={client} />}</RequireConnection>
    </section>
  )
}
