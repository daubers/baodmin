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

  return (
    <>
      <label>
        Mount
        <select
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
      </label>
      <nav aria-label="Path" className="crumbs">
        <button type="button" onClick={() => go('')}>
          {mount}
        </button>
        {crumbs.map((c, i) => (
          <button key={i} type="button" onClick={() => go(crumbs.slice(0, i + 1).join('/') + '/')}>
            {c}/
          </button>
        ))}
      </nav>
      {entries.error && <p role="alert">{entries.error.message}</p>}
      {entries.data?.length === 0 && <p>Nothing here.</p>}
      <ul className="entries">
        {entries.data?.map((e) => (
          <li key={e.path}>
            <button
              type="button"
              aria-pressed={selected === e.path}
              onClick={() => (e.isFolder ? go(e.path) : setSelected(e.path))}
            >
              {e.isFolder ? '📁 ' : '🔑 '}
              {e.name}
            </button>
          </li>
        ))}
      </ul>
      {selected && <AccessPanel client={client} mount={mount} secret={selected} />}
    </>
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
