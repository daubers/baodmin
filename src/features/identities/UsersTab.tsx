import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import type { BaoClient } from '../../api/bao'
import { deleteUser, listUsers, saveUser } from '../../api/identities'
import { PolicyPicker } from '../shared/PolicyPicker'

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
  const users = useQuery({ queryKey: ['users'], queryFn: () => listUsers(client) })
  const [draft, setDraft] = useState<Draft | null>(null)

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
      {users.error && <p role="alert">{users.error.message}</p>}
      <table>
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
              <td>{u.policies.join(', ') || '—'}</td>
              <td>
                <button type="button" onClick={() => setDraft({ ...u, password: '', ttl: u.ttl ? `${u.ttl}s` : '', isNew: false })}>
                  Edit
                </button>{' '}
                <button
                  type="button"
                  onClick={() => window.confirm(`Delete user "${u.name}"? This cannot be undone.`) && remove.mutate(u.name)}
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
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
          <div>
            <button type="submit" disabled={save.isPending}>
              Save
            </button>{' '}
            <button type="button" onClick={() => setDraft(null)}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  )
}
