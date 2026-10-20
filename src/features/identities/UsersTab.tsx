import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import type { BaoClient } from '../../api/bao'
import { deleteUser, listUsers, saveUser } from '../../api/identities'
import { AccessEditor } from '../access/AccessEditor'
import { ListState } from '../shared/ListState'
import { PolicyPicker } from '../shared/PolicyPicker'
import { useConfirm } from '../shared/useConfirm'
import { PolicyChips } from '../shared/PolicyChips'

interface Draft {
  name: string
  password: string
  policies: string[]
  ttl: string
  isNew: boolean
}

const empty: Draft = { name: '', password: '', policies: [], ttl: '', isNew: true }

export function UsersTab({ client }: { client: BaoClient }) {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const users = useQuery({ queryKey: ['users'], queryFn: () => listUsers(client) })
  const [draft, setDraft] = useState<Draft | null>(null)
  const [accessFor, setAccessFor] = useState<string | null>(null)

  const save = useMutation({
    mutationFn: (d: Draft) => saveUser(client, { name: d.name, password: d.password, policies: d.policies, ttl: d.ttl }),
    onSuccess: () => {
      setDraft(null)
      return qc.invalidateQueries({ queryKey: ['users'] })
    },
  })
  const remove = useMutation({
    mutationFn: (name: string) => deleteUser(client, name),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  })

  function submit(e: FormEvent) {
    e.preventDefault()
    if (draft) save.mutate(draft)
  }

  return (
    <section>
      <ListState query={users} empty="No users yet." />
      {!!users.data?.length && (
      <table aria-label="Users">
        <thead>
          <tr>
            <th>User</th>
            <th>Policies</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {users.data?.map((u) => (
            <tr key={u.name}>
              <td>{u.name}</td>
              <td>
                <PolicyChips policies={u.policies} />
              </td>
              <td>
                <button type="button" aria-label={`Access ${u.name}`} onClick={() => setAccessFor(u.name)}>
                  Access
                </button>
                <button type="button" aria-label={`Edit ${u.name}`} onClick={() => setDraft({ ...u, password: '', ttl: u.ttl ? `${u.ttl}s` : '', isNew: false })}>
                  Edit
                </button>
                <button
                  type="button"
                  aria-label={`Delete ${u.name}`}
                  onClick={async () => {
                    if (await confirm({ title: `Delete user “${u.name}”?`, message: 'This cannot be undone.', confirmLabel: 'Delete' })) remove.mutate(u.name)
                  }}
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      )}
      {remove.error && <p role="alert">{remove.error.message}</p>}
      {!draft && (
        <button type="button" onClick={() => setDraft(empty)}>
          New user
        </button>
      )}
      {draft && (
        <form onSubmit={submit} aria-label={draft.isNew ? 'New user' : `Edit ${draft.name}`}>
          <label>
            Username
            <input value={draft.name} disabled={!draft.isNew} onChange={(e) => setDraft({ ...draft, name: e.target.value })} required />
          </label>
          <label>
            Password
            <input
              type="password"
              value={draft.password}
              onChange={(e) => setDraft({ ...draft, password: e.target.value })}
              required={draft.isNew}
              placeholder={draft.isNew ? '' : 'Leave blank to keep'}
              autoComplete="new-password"
            />
          </label>
          <label>
            Token TTL
            <input value={draft.ttl} onChange={(e) => setDraft({ ...draft, ttl: e.target.value })} placeholder="e.g. 1h (optional)" />
          </label>
          <PolicyPicker client={client} value={draft.policies} onChange={(policies) => setDraft({ ...draft, policies })} />
          {save.error && <p role="alert">{save.error.message}</p>}
          <div className="form-actions">
            <button type="submit" disabled={save.isPending}>
              Save
            </button>
            <button type="button" onClick={() => setDraft(null)}>
              Cancel
            </button>
          </div>
        </form>
      )}
      {accessFor && <AccessEditor key={accessFor} client={client} target={{ kind: 'user', name: accessFor }} onClose={() => setAccessFor(null)} />}
    </section>
  )
}
