import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useId, useState, type FormEvent } from 'react'
import type { BaoClient } from '../../api/bao'
import { engineFor } from '../../api/engines/registry'
import { deleteMount, mountImpact, type MountImpact } from '../../api/mounts'
import type { Mount } from '../../api/secrets'
import { policiesReferencing } from '../../model/mounts'
import { useAccessInputs } from '../shared/useAccessInputs'
import { NameChips } from '../shared/PolicyChips'

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

function Consequences({ mount, impact }: { mount: Mount; impact: MountImpact }) {
  if (impact.kind === 'kv') {
    return (
      <p>
        Every secret stored in <code>{mount.path}</code>, with all of its versions, will be permanently deleted
        {impact.topLevelEntries !== undefined && <> (at least {plural(impact.topLevelEntries, 'entry', 'entries')} at the top level)</>}.
      </p>
    )
  }
  return (
    <p>
      The {engineFor(mount.type).label} engine at <code>{mount.path}</code> will be permanently deleted
      {impact.roles !== undefined && <>, with its {plural(impact.roles, 'role')} and its configuration</>}.
      {impact.hasLeases ? ' Every lease it has issued will be revoked, so credentials already handed out stop working.' : ''}
    </p>
  )
}

/**
 * Deleting a mount destroys its data and revokes its leases, so the button stays disabled until the path is typed.
 * Policies that mention the mount are listed, not changed: they are left in place.
 */
export function DeleteMountDialog({ client, mount, onClose, onDeleted }: {
  client: BaoClient
  mount: Mount
  onClose: () => void
  onDeleted: () => void
}) {
  const qc = useQueryClient()
  const inputId = useId()
  const [typed, setTyped] = useState('')
  const impact = useQuery({
    queryKey: ['mount-impact', mount.path],
    queryFn: () => mountImpact(client, mount.path, mount.type),
    gcTime: 0,
    staleTime: 0,
  })
  const access = useAccessInputs(client)
  const referencing = access.data ? policiesReferencing(access.data.policies, mount.path) : []
  const confirmed = typed.trim().replace(/\/+$/, '') === mount.path.replace(/\/+$/, '')

  const remove = useMutation({
    mutationFn: () => deleteMount(client, mount.path),
    onSuccess: async () => {
      qc.removeQueries({ predicate: (q) => ['kv-list', 'engine-roles', 'engine-config', 'leases', 'mount-impact', 'kv-config'].includes(String(q.queryKey[0])) && q.queryKey[1] === mount.path })
      await qc.invalidateQueries({ queryKey: ['mounts'] })
      onDeleted()
    },
  })

  function submit(e: FormEvent) {
    e.preventDefault()
    if (confirmed) remove.mutate()
  }

  return (
    <section role="alertdialog" aria-label={`Delete ${mount.path}`} className="mount-dialog mount-delete">
      <h3>Delete {mount.path}?</h3>
      {impact.isPending && <p role="status">Checking what is in it…</p>}
      {impact.error && <p role="alert">{impact.error.message}</p>}
      {impact.data && <Consequences mount={mount} impact={impact.data} />}
      {impact.data && impact.data.unknown.length > 0 && (
        <p className="hint">Could not count {impact.data.unknown.join(', ')}, so there may be more than shown.</p>
      )}
      <p>This cannot be undone.</p>
      {referencing.length > 0 && (
        <>
          <p>
            {plural(referencing.length, 'policy', 'policies')} grant{referencing.length === 1 ? 's' : ''} access under this mount.
            They are not changed, and will point at nothing:
          </p>
          <NameChips names={referencing} />
        </>
      )}
      {access.error && <p className="hint">Could not check which policies refer to this mount: {access.error.message}</p>}
      <form onSubmit={submit} aria-label={`Confirm deleting ${mount.path}`}>
        <label htmlFor={inputId}>
          Type <code>{mount.path}</code> to confirm
        </label>
        <input id={inputId} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} />
        {remove.error && <p role="alert">{remove.error.message}</p>}
        <div className="form-actions">
          <button type="submit" disabled={!confirmed || remove.isPending}>
            Delete forever
          </button>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </section>
  )
}
