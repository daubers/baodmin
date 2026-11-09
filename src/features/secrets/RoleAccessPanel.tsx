import { useMutation } from '@tanstack/react-query'
import { useState, type FormEvent, type KeyboardEvent } from 'react'
import type { BaoClient } from '../../api/bao'
import type { RoleKind } from '../../api/engines/registry'
import { grantAccess } from '../../api/grants'
import type { Identity } from '../../model/graph'
import { dynamicGrantRules, validateGrantPath, type DynamicAccess } from '../../model/managed'
import { DynamicAccessPicker } from '../shared/DynamicAccessPicker'
import { useAccessInputs } from '../shared/useAccessInputs'
import { useRefreshAccess } from '../shared/useRefreshAccess'
import { Entries } from './AccessPanel'

const noEnterSubmit = (e: KeyboardEvent<HTMLSelectElement>) => e.key === 'Enter' && e.preventDefault()

const GROUPS = [
  { kind: 'user', label: 'Users' },
  { kind: 'entity', label: 'Entities' },
  { kind: 'group', label: 'Groups' },
] as const

function GrantRole({ client, mount, kind, role, identities, onClose, onGranted }: {
  client: BaoClient
  mount: string
  kind: RoleKind
  role: string
  identities: Identity[]
  onClose: () => void
  onGranted: (message: string) => void
}) {
  const refresh = useRefreshAccess()
  // Tokens can't hold a managed policy: their policies are fixed when they are created.
  const people = GROUPS.flatMap((g) => identities.filter((i) => i.kind === g.kind).sort((a, b) => a.name.localeCompare(b.name)))
  const [who, setWho] = useState(0)
  const [all, setAll] = useState(false)
  const [access, setAccess] = useState<DynamicAccess[]>(['generate'])
  const [error, setError] = useState<string | null>(null)
  const target = people[who]
  const granted = all ? '*' : role

  const grant = useMutation({
    mutationFn: () =>
      grantAccess(client, { kind: target.kind as 'user' | 'entity' | 'group', name: target.name }, dynamicGrantRules(kind, mount, granted, access)),
    onSuccess: async () => {
      await refresh()
      const where = all ? `every role in ${mount}${kind.path}` : `${mount}${kind.path}/${role}`
      onGranted(`Granted ${access.map((a) => (a === 'generate' ? 'generate credentials' : 'manage role')).join(' and ')} on ${where} to ${target.kind} “${target.name}”.`)
    },
  })

  function submit(e: FormEvent) {
    e.preventDefault()
    const err = validateGrantPath(`${mount}${kind.path}/${granted}`) ?? (access.length === 0 ? 'Select at least one kind of access.' : null)
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
    <form onSubmit={submit} aria-label="Grant access to this role" className="wide grant-here">
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
      <label className="check">
        <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
        <span>
          Every role in <code>{mount + kind.path}</code>
          <span className="hint"> including ones added later</span>
        </span>
      </label>
      <DynamicAccessPicker value={access} onChange={setAccess} />
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

/** Who can generate credentials from, or manage, one role; and a form to grant that to an identity. */
export function RoleAccessPanel({ client, mount, kind, role, onClose }: {
  client: BaoClient
  mount: string
  kind: RoleKind
  role: string
  onClose: () => void
}) {
  const data = useAccessInputs(client)
  const [granting, setGranting] = useState(false)
  const [granted, setGranted] = useState<string | null>(null)
  const credPaths = kind.creds.map((c) => ({ id: c.id, label: c.label, path: mount + c.path(role) }))
  const rolePath = `${mount}${kind.path}/${role}`

  return (
    <section aria-label={`Access to ${role}`} className="secret-detail">
      <header>
        <div>
          <h2>{role}</h2>
          <code>{rolePath}</code>
        </div>
        <div>
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
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </header>
      {granted && (
        <p role="status" className="note-ok">
          {granted}
        </p>
      )}
      {granting && data.data && (
        <GrantRole
          client={client}
          mount={mount}
          kind={kind}
          role={role}
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
      {data.data && (
        <>
          {data.data.notes.map((n) => (
            <p key={n} role="alert">
              Incomplete: could not read {n}
            </p>
          ))}
          {credPaths.map((c) => (
            <div key={c.id}>
              <h3>{c.label}</h3>
              <code>{c.path}</code>
              <Entries data={{ ...data.data, notes: [] }} path={c.path} label={`Who can: ${c.label}`} empty="No identity can do this." />
            </div>
          ))}
          <h3>Manage role</h3>
          <code>{rolePath}</code>
          <Entries data={{ ...data.data, notes: [] }} path={rolePath} label="Who can manage this role" empty="No identity can manage this role." />
        </>
      )}
    </section>
  )
}
