import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type { BaoClient } from '../../api/bao'
import { deleteConfig, listConfigs, readConfig, runAction, writeConfig } from '../../api/engines/config'
import type { ConfigKind, EngineDef } from '../../api/engines/registry'
import { draftFromRole, emptyDraft, payloadFromDraft, type RoleData, type RoleDraft } from '../../api/engines/roles'
import { ListState } from '../shared/ListState'
import { useConfirm } from '../shared/useConfirm'
import { RoleEditor } from './RoleEditor'

function ConfigEditor({ client, mount, kind, name, initial, onDone }: {
  client: BaoClient
  mount: string
  kind: ConfigKind
  /** Config name for named kinds; undefined for single-endpoint configs. */
  name?: string
  /** Existing values (null when nothing is configured yet). */
  initial: RoleData | null
  onDone: () => void
}) {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [draft, setDraft] = useState<RoleDraft>(() =>
    initial ? draftFromRole(kind, name ?? '', initial) : { ...emptyDraft(kind), name: name ?? '' },
  )
  const [formError, setFormError] = useState<string | null>(null)
  const done = () => qc.invalidateQueries({ queryKey: ['engine-config', mount, kind.id] })

  const save = useMutation({
    mutationFn: (d: RoleDraft) => writeConfig(client, mount, kind, payloadFromDraft(kind, d), kind.named ? d.name.trim() : undefined),
    onSuccess: async () => {
      await done()
      onDone()
    },
  })
  const act = useMutation({
    mutationFn: (id: string) => runAction(client, mount, kind.actions!.find((a) => a.id === id)!, name),
    onSuccess: done,
  })
  const remove = useMutation({
    mutationFn: () => deleteConfig(client, mount, kind, name),
    onSuccess: async () => {
      await done()
      onDone()
    },
  })

  const shown = kind.shown?.filter((s) => typeof initial?.[s.key] === 'string' && initial[s.key] !== '')
  return (
    <div>
      {shown?.map((s) => (
        <label key={s.key}>
          {s.label}
          <textarea readOnly rows={3} value={String(initial?.[s.key])} />
        </label>
      ))}
      <RoleEditor
        kind={kind}
        noun={kind.named ? 'connection' : kind.label.toLowerCase()}
        showName={kind.named}
        draft={draft}
        pending={save.isPending}
        error={formError ?? save.error?.message ?? null}
        onChange={setDraft}
        onSubmit={() => {
          setFormError(null)
          try {
            payloadFromDraft(kind, draft)
          } catch (e) {
            setFormError((e as Error).message)
            return
          }
          save.mutate(draft)
        }}
        onCancel={onDone}
      />
      {(initial !== null || !kind.named) &&
        kind.actions?.map((a) => (
          <button
            key={a.id}
            type="button"
            disabled={act.isPending}
            onClick={async () => {
              if (await confirm(a.confirm)) act.mutate(a.id)
            }}
          >
            {a.label}
          </button>
        ))}
      {kind.deletable && initial !== null && (
        <button
          type="button"
          onClick={async () => {
            if (await confirm({ title: `Delete ${kind.named ? `“${name}”` : kind.label.toLowerCase()}?`, message: 'This cannot be undone.', confirmLabel: 'Delete' }))
              remove.mutate()
          }}
        >
          Delete
        </button>
      )}
      {act.isSuccess && <p role="status">Done.</p>}
      {act.error && <p role="alert">{act.error.message}</p>}
      {remove.error && <p role="alert">{remove.error.message}</p>}
    </div>
  )
}

function SingleConfig({ client, mount, kind }: { client: BaoClient; mount: string; kind: ConfigKind }) {
  const q = useQuery({ queryKey: ['engine-config', mount, kind.id, ''], queryFn: () => readConfig(client, mount, kind) })
  if (q.isPending) return <p role="status">Loading…</p>
  if (q.error) return <p role="alert">{q.error.message}</p>
  // `key` remounts the form with fresh values after a save or action reloads the config.
  return (
    <ConfigEditor
      key={JSON.stringify(q.data)}
      client={client}
      mount={mount}
      kind={kind}
      initial={q.data}
      onDone={() => void q.refetch()}
    />
  )
}

function NamedConfigs({ client, mount, kind }: { client: BaoClient; mount: string; kind: ConfigKind }) {
  const [editing, setEditing] = useState<{ name?: string; initial: RoleData | null } | null>(null)
  const names = useQuery({ queryKey: ['engine-config', mount, kind.id], queryFn: () => listConfigs(client, mount, kind) })
  const open = useMutation({
    mutationFn: (name: string) => readConfig(client, mount, kind, name),
    onSuccess: (initial, name) => setEditing({ name, initial }),
  })
  return (
    <div>
      <ListState query={names} empty={`No ${kind.label.toLowerCase()} yet.`} />
      {!!names.data?.length && (
        <table aria-label={kind.label}>
          <thead>
            <tr>
              <th>Name</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {names.data.map((n) => (
              <tr key={n}>
                <td>{n}</td>
                <td>
                  <button type="button" aria-label={`Edit ${n}`} onClick={() => open.mutate(n)}>
                    Edit
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {open.error && <p role="alert">{open.error.message}</p>}
      {!editing && (
        <button type="button" onClick={() => setEditing({ initial: null })}>
          New connection
        </button>
      )}
      {editing && (
        <ConfigEditor
          key={editing.name ?? 'new'}
          client={client}
          mount={mount}
          kind={kind}
          name={editing.name}
          initial={editing.initial}
          onDone={() => setEditing(null)}
        />
      )}
    </div>
  )
}

export function ConfigPanel({ client, mount, engine }: { client: BaoClient; mount: string; engine: EngineDef }) {
  return (
    <section aria-label="Config">
      {engine.configs.map((kind) => (
        <div key={kind.id}>
          <h3>{kind.label}</h3>
          {kind.named ? <NamedConfigs client={client} mount={mount} kind={kind} /> : <SingleConfig client={client} mount={mount} kind={kind} />}
        </div>
      ))}
    </section>
  )
}
