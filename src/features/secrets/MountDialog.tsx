import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type { BaoClient } from '../../api/bao'
import { MOUNT_TYPES, mountTypeFor, type MountType } from '../../api/engines/registry'
import { draftFromRole, emptyDraft, payloadFromDraft, type RoleDraft, type Schema } from '../../api/engines/roles'
import { createMount, PartialMountError, readKvConfig, tuneMount } from '../../api/mounts'
import type { Mount } from '../../api/secrets'
import { validateMountPath } from '../../model/mounts'
import { RoleEditor } from './RoleEditor'

const schemaOf = (t: MountType): Schema => ({ fields: [...t.fields, ...t.configFields] })

function CreateMount({ client, existing, onClose, onDone }: { client: BaoClient; existing: string[]; onClose: () => void; onDone: (path: string) => void }) {
  const qc = useQueryClient()
  const [type, setType] = useState<MountType>(MOUNT_TYPES[0])
  const [draft, setDraft] = useState<RoleDraft>(() => emptyDraft(schemaOf(MOUNT_TYPES[0])))
  const [formError, setFormError] = useState<string | null>(null)

  const create = useMutation({
    mutationFn: async () => {
      const path = draft.name.trim().replace(/\/+$/, '')
      try {
        await createMount(client, path, type, payloadFromDraft(schemaOf(type), draft))
      } finally {
        // Even a half-finished create leaves a mount behind, so always refresh the list.
        await qc.invalidateQueries({ queryKey: ['mounts'] })
      }
      return `${path}/`
    },
    onSuccess: (path) => onDone(path),
  })

  function submit() {
    setFormError(null)
    const pathError = validateMountPath(draft.name.trim(), existing)
    if (pathError) return setFormError(pathError)
    try {
      payloadFromDraft(schemaOf(type), draft)
    } catch (e) {
      return setFormError((e as Error).message)
    }
    create.mutate()
  }

  return (
    <section aria-label="New secrets engine" className="mount-dialog">
      <label>
        Type
        <select
          value={type.type}
          onChange={(e) => {
            const next = MOUNT_TYPES.find((t) => t.type === e.target.value) ?? MOUNT_TYPES[0]
            setType(next)
            // Keep what was typed in the path; the other fields differ per type.
            setDraft({ ...emptyDraft(schemaOf(next)), name: draft.name })
            setFormError(null)
            create.reset()
          }}
        >
          {MOUNT_TYPES.map((t) => (
            <option key={t.type} value={t.type}>
              {t.label}
            </option>
          ))}
        </select>
      </label>
      <RoleEditor
        key={type.type}
        kind={schemaOf(type)}
        noun="secrets engine"
        nameLabel="Path"
        submitLabel="Create"
        draft={draft}
        pending={create.isPending}
        error={formError ?? (create.error instanceof PartialMountError ? create.error.message : create.error?.message) ?? null}
        onChange={setDraft}
        onSubmit={submit}
        onCancel={onClose}
      />
      {type.type === 'aws' && (
        <p className="hint">Not every OpenBao build includes the AWS engine. If it is missing, OpenBao says the plugin was not found in the catalog.</p>
      )}
    </section>
  )
}

function EditForm({ client, mount, type, initial, onClose, onDone }: {
  client: BaoClient
  mount: Mount
  type: MountType
  initial: Record<string, unknown>
  onClose: () => void
  onDone: (path: string) => void
}) {
  const qc = useQueryClient()
  const schema = schemaOf(type)
  const [draft, setDraft] = useState<RoleDraft>(() => draftFromRole(schema, mount.path, initial))
  const [formError, setFormError] = useState<string | null>(null)
  const save = useMutation({
    mutationFn: async () => {
      await tuneMount(client, mount.path, type, payloadFromDraft(schema, draft))
      await qc.invalidateQueries({ queryKey: ['mounts'] })
    },
    onSuccess: () => onDone(mount.path),
  })
  return (
    <RoleEditor
      kind={schema}
      noun={`${mount.path} settings`}
      showName={false}
      draft={draft}
      pending={save.isPending}
      error={formError ?? save.error?.message ?? null}
      onChange={setDraft}
      onSubmit={() => {
        setFormError(null)
        try {
          payloadFromDraft(schema, draft)
        } catch (e) {
          return setFormError((e as Error).message)
        }
        save.mutate()
      }}
      onCancel={onClose}
    />
  )
}

function EditMount({ client, mount, onClose, onDone }: { client: BaoClient; mount: Mount; onClose: () => void; onDone: (path: string) => void }) {
  const type = mountTypeFor(mount)
  // KV v2 settings live on the engine, not in sys/mounts, so they are read separately.
  const kvConfig = useQuery({
    queryKey: ['kv-config', mount.path],
    queryFn: () => readKvConfig(client, mount.path),
    enabled: type !== null && type.configFields.length > 0,
    // Never reuse an earlier read: a stale value would be written back as if it were current.
    gcTime: 0,
    staleTime: 0,
  })
  if (!type) return <p className="hint">The UI can’t change {mount.type} engines.</p>
  if (type.configFields.length > 0 && kvConfig.isPending) return <p role="status">Loading…</p>
  if (kvConfig.error) return <p role="alert">{kvConfig.error.message}</p>
  return (
    <EditForm
      client={client}
      mount={mount}
      type={type}
      initial={{
        description: mount.description,
        default_lease_ttl: mount.defaultLeaseTtl,
        max_lease_ttl: mount.maxLeaseTtl,
        ...kvConfig.data,
      }}
      onClose={onClose}
      onDone={onDone}
    />
  )
}

/** Create a secrets engine mount, or change the settings of an existing one. Path and type can't be changed. */
export function MountDialog(props: { client: BaoClient; existing: string[]; mount?: Mount; onClose: () => void; onDone: (path: string) => void }) {
  return props.mount ? (
    <section aria-label={`Settings for ${props.mount.path}`} className="mount-dialog">
      <EditMount client={props.client} mount={props.mount} onClose={props.onClose} onDone={props.onDone} />
    </section>
  ) : (
    <CreateMount client={props.client} existing={props.existing} onClose={props.onClose} onDone={props.onDone} />
  )
}
