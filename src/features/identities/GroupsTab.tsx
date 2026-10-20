import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import type { BaoClient } from '../../api/bao'
import { deleteGroup, listEntities, listGroups, saveGroup } from '../../api/identities'
import { AccessEditor } from '../access/AccessEditor'
import { ListState } from '../shared/ListState'
import { PolicyPicker } from '../shared/PolicyPicker'

interface Draft {
  name: string
  policies: string[]
  members: string[]
  isNew: boolean
}

export function GroupsTab({ client }: { client: BaoClient }) {
  const qc = useQueryClient()
  const groups = useQuery({ queryKey: ['groups'], queryFn: () => listGroups(client) })
  const entities = useQuery({ queryKey: ['entities'], queryFn: () => listEntities(client) })
  const [draft, setDraft] = useState<Draft | null>(null)
  const [accessFor, setAccessFor] = useState<string | null>(null)
  const refresh = () => qc.invalidateQueries({ queryKey: ['groups'] })

  const nameOf = (id: string) => entities.data?.find((e) => e.id === id)?.name ?? id

  const save = useMutation({
    mutationFn: (d: Draft) => saveGroup(client, { name: d.name, policies: d.policies, memberEntityIds: d.members }),
    onSuccess: () => {
      setDraft(null)
      return refresh()
    },
  })
  const remove = useMutation({ mutationFn: (name: string) => deleteGroup(client, name), onSuccess: refresh })

  function submit(e: FormEvent) {
    e.preventDefault()
    if (draft) save.mutate(draft)
  }

  return (
    <section>
      <ListState query={groups} empty="No groups yet." />
      {!!groups.data?.length && (
      <table aria-label="Groups">
        <thead>
          <tr>
            <th>Group</th>
            <th>Members</th>
            <th>Policies</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {groups.data?.map((g) => (
            <tr key={g.id}>
              <td>{g.name}</td>
              <td>{g.member_entity_ids.map(nameOf).join(', ') || '—'}</td>
              <td>{g.policies.join(', ') || '—'}</td>
              <td>
                <button type="button" aria-label={`Access ${g.name}`} onClick={() => setAccessFor(g.name)}>
                  Access
                </button>{' '}
                <button
                  type="button"
                  aria-label={`Edit ${g.name}`}
                  onClick={() => setDraft({ name: g.name, policies: g.policies, members: g.member_entity_ids, isNew: false })}
                >
                  Edit
                </button>{' '}
                <button type="button" aria-label={`Delete ${g.name}`} onClick={() => window.confirm(`Delete group "${g.name}"?`) && remove.mutate(g.name)}>
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
        <button type="button" onClick={() => setDraft({ name: '', policies: [], members: [], isNew: true })}>
          New group
        </button>
      )}
      {draft && (
        <form onSubmit={submit} aria-label={draft.isNew ? 'New group' : `Edit ${draft.name}`}>
          <label>
            Name
            <input value={draft.name} disabled={!draft.isNew} onChange={(e) => setDraft({ ...draft, name: e.target.value })} required />
          </label>
          <fieldset>
            <legend>Member entities</legend>
            {entities.data?.map((e) => (
              <label key={e.id} className="check">
                <input
                  type="checkbox"
                  checked={draft.members.includes(e.id)}
                  onChange={(ev) =>
                    setDraft({ ...draft, members: ev.target.checked ? [...draft.members, e.id] : draft.members.filter((m) => m !== e.id) })
                  }
                />{' '}
                {e.name}
              </label>
            ))}
            {entities.data?.length === 0 && <p>No entities yet.</p>}
          </fieldset>
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
      {accessFor && <AccessEditor key={accessFor} client={client} target={{ kind: 'group', name: accessFor }} onClose={() => setAccessFor(null)} />}
    </section>
  )
}
