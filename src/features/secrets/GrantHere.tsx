import { useMutation } from '@tanstack/react-query'
import { useState, type FormEvent, type KeyboardEvent } from 'react'
import type { BaoClient } from '../../api/bao'
import { grantAccess } from '../../api/grants'
import type { Identity } from '../../model/graph'
import { kvGrantRules, validateGrantPath, type KvCapability } from '../../model/managed'
import { CapabilityPicker } from '../shared/CapabilityPicker'
import { useRefreshAccess } from '../shared/useRefreshAccess'

interface Props {
  client: BaoClient
  mount: string
  /** Secret path within the mount, e.g. "app/database". */
  secret: string
  identities: Identity[]
  onClose: () => void
  onGranted: (message: string) => void
}

// Enter on a dropdown confirms the choice in some browsers and submits the form in others; never grant by accident.
const noEnterSubmit = (e: KeyboardEvent<HTMLSelectElement>) => e.key === 'Enter' && e.preventDefault()

const GROUPS = [
  { kind: 'user', label: 'Users' },
  { kind: 'entity', label: 'Entities' },
  { kind: 'group', label: 'Groups' },
] as const

/** Grant an identity access to the secret that is open, without leaving the Secrets page. */
export function GrantHere({ client, mount, secret, identities, onClose, onGranted }: Props) {
  const refresh = useRefreshAccess()
  // Tokens can't hold a managed policy: their policies are fixed when they are created.
  const people = GROUPS.flatMap((g) => identities.filter((i) => i.kind === g.kind).sort((a, b) => a.name.localeCompare(b.name)))
  const [who, setWho] = useState(0)
  const [scope, setScope] = useState<'secret' | 'folder'>('secret')
  const [caps, setCaps] = useState<KvCapability[]>(['read'])
  const [error, setError] = useState<string | null>(null)

  const folder = secret.slice(0, secret.lastIndexOf('/') + 1)
  const path = scope === 'secret' ? secret : `${folder}*`
  const target = people[who]

  const grant = useMutation({
    mutationFn: () => grantAccess(client, { kind: target.kind as 'user' | 'entity' | 'group', name: target.name }, kvGrantRules(mount, path, caps)),
    onSuccess: async () => {
      await refresh()
      onGranted(`Granted ${caps.join(', ')} on ${mount}${path} to ${target.kind} “${target.name}”.`)
    },
  })

  function submit(e: FormEvent) {
    e.preventDefault()
    const err = validateGrantPath(path) ?? (caps.length === 0 ? 'Select at least one capability.' : null)
    setError(err)
    if (!err) grant.mutate()
  }

  if (people.length === 0) {
    return (
      <p className="hint">
        There are no users, entities or groups to grant access to yet.{' '}
        <button type="button" className="link" onClick={onClose}>
          Close
        </button>
      </p>
    )
  }

  return (
    <form onSubmit={submit} aria-label="Grant access to this secret" className="wide grant-here">
      <h3>Grant access</h3>
      <label>
        Who
        <select value={who} onChange={(e) => setWho(Number(e.target.value))} onKeyDown={noEnterSubmit}>
          {GROUPS.map((g) => {
            const items = people.filter((p) => p.kind === g.kind)
            return (
              items.length > 0 && (
                <optgroup key={g.kind} label={g.label}>
                  {items.map((p) => (
                    <option key={`${p.kind}:${p.name}`} value={people.indexOf(p)}>
                      {p.name}
                    </option>
                  ))}
                </optgroup>
              )
            )
          })}
        </select>
      </label>
      <fieldset>
        <legend>Where</legend>
        <label className="check">
          <input type="radio" name="grant-scope" checked={scope === 'secret'} onChange={() => setScope('secret')} />
          <span>
            Just this secret <code>{mount + secret}</code>
          </span>
        </label>
        <label className="check">
          <input type="radio" name="grant-scope" checked={scope === 'folder'} onChange={() => setScope('folder')} />
          <span>
            Everything in <code>{mount + folder}</code>
            <span className="hint"> including subfolders and secrets added later</span>
          </span>
        </label>
      </fieldset>
      <CapabilityPicker value={caps} onChange={setCaps} />
      {(error || grant.error) && <p role="alert">{error ?? grant.error?.message}</p>}
      <div className="form-actions">
        <button type="submit" disabled={grant.isPending}>
          Grant
        </button>
        <button type="button" onClick={onClose}>
          Cancel
        </button>
      </div>
    </form>
  )
}
