import { useQuery } from '@tanstack/react-query'
import { useId, useState } from 'react'
import type { BaoClient } from '../../api/bao'
import { engineFor, mountKind, mountTypeFor } from '../../api/engines/registry'
import { listSecrets } from '../../api/secrets'
import { RequireConnection } from '../shared/RequireConnection'
import { useMounts } from '../shared/useMounts'
import { AccessPanel } from './AccessPanel'
import { DeleteMountDialog } from './DeleteMountDialog'
import { EngineView } from './EngineView'
import { MountDialog } from './MountDialog'

function Browser({ client }: { client: BaoClient }) {
  const mounts = useMounts(client)
  const selectId = useId()
  const [mountChoice, setMount] = useState<string | null>(null)
  const [prefix, setPrefix] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [dialog, setDialog] = useState<'create' | 'edit' | 'delete' | null>(null)

  const current = mounts.data?.find((m) => m.path === mountChoice) ?? mounts.data?.[0] ?? null
  const mount = current?.path ?? null
  const isKv = current !== null && mountKind(current) === 'kv'
  const entries = useQuery({
    queryKey: ['kv-list', mount, prefix],
    queryFn: () => listSecrets(client, mount!, prefix),
    enabled: isKv,
  })

  const crumbs = prefix.split('/').filter(Boolean)
  const go = (p: string) => {
    setPrefix(p)
    setSelected(null)
  }

  if (mounts.error) return <p role="alert">{mounts.error.message}</p>
  if (mounts.isPending) return <p>Loading…</p>

  const existing = mounts.data.map((m) => m.path)
  const closeDialog = () => setDialog(null)
  const newButton = (
    <div className="mount-new">
      <button type="button" onClick={() => setDialog(dialog === 'create' ? null : 'create')} aria-expanded={dialog === 'create'}>
        New secrets engine
      </button>
    </div>
  )
  const dialogs = dialog === 'delete' && current ? (
    <DeleteMountDialog
      key={current.path}
      client={client}
      mount={current}
      onClose={closeDialog}
      onDeleted={() => {
        closeDialog()
        // Fall back to the first remaining mount.
        setMount(null)
        go('')
      }}
    />
  ) : dialog && dialog !== 'delete' && (
    <MountDialog
      // Remount per mount so one mount's settings are never shown (or saved) for another.
      key={dialog === 'edit' ? current?.path : 'create'}
      client={client}
      existing={existing}
      mount={dialog === 'edit' && current ? current : undefined}
      onClose={closeDialog}
      onDone={(path) => {
        closeDialog()
        // A new mount starts at its root; saving settings keeps your place.
        if (path !== mount) {
          setMount(path)
          go('')
        }
      }}
    />
  )

  if (!current || !mount) {
    return (
      <>
        <p>No secrets engines are mounted.</p>
        {newButton}
        {dialogs}
      </>
    )
  }

  const where = prefix ? `${mount}${prefix}` : mount
  const kv = mounts.data.filter((m) => mountKind(m) === 'kv')
  const dynamic = mounts.data.filter((m) => mountKind(m) === 'dynamic')

  // New engine on its own line; then the engine picker with what you can do to it; then (for KV) where you are in it.
  const header = (
    <>
      {newButton}
      <div className="mount-bar">
        <div className="mount-pick">
          <label htmlFor={selectId}>Secrets engine</label>
          <select
            id={selectId}
            value={mount}
            onChange={(e) => {
              setMount(e.target.value)
              go('')
              // A settings or delete panel belongs to the mount it was opened for.
              setDialog(null)
            }}
          >
            {kv.length > 0 && (
              <optgroup label="KV">
                {kv.map((m) => (
                  <option key={m.path}>{m.path}</option>
                ))}
              </optgroup>
            )}
            {[...new Set(dynamic.map((m) => m.type))].map((type) => (
              <optgroup key={type} label={engineFor(type).label}>
                {dynamic
                  .filter((m) => m.type === type)
                  .map((m) => (
                    <option key={m.path}>{m.path}</option>
                  ))}
              </optgroup>
            ))}
          </select>
        </div>
        <div className="mount-actions">
          {mountTypeFor(current) && (
            <button type="button" onClick={() => setDialog(dialog === 'edit' ? null : 'edit')} aria-expanded={dialog === 'edit'}>
              Settings
            </button>
          )}
          <button type="button" onClick={() => setDialog(dialog === 'delete' ? null : 'delete')} aria-expanded={dialog === 'delete'}>
            Delete
          </button>
        </div>
      </div>
      {dialogs}
    </>
  )

  if (!isKv) {
    return (
      <>
        {header}
        <EngineView client={client} mount={current} />
      </>
    )
  }

  return (
    <>
      {header}
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
      <div className="secrets-layout">
        <div className="secrets-browser">
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
