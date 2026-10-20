import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import type { BaoClient } from '../../api/bao'
import { addAlias, deleteAlias, deleteEntity, listEntities, saveEntity, userpassAccessor, type Entity } from '../../api/identities'
import { AccessEditor } from '../access/AccessEditor'
import { ListState } from '../shared/ListState'
import { PolicyPicker } from '../shared/PolicyPicker'

interface Draft {
  name: string
  policies: string[]
  isNew: boolean
  entity?: Entity
}

export function EntitiesTab({ client }: { client: BaoClient }) {
  const qc = useQueryClient()
  const entities = useQuery({ queryKey: ['entities'], queryFn: () => listEntities(client) })
  const [draft, setDraft] = useState<Draft | null>(null)
  const [accessFor, setAccessFor] = useState<string | null>(null)
  const [aliasName, setAliasName] = useState('')
  const refresh = () => qc.invalidateQueries({ queryKey: ['entities'] })

  const save = useMutation({
    mutationFn: (d: Draft) => saveEntity(client, { name: d.name, policies: d.policies }),
    onSuccess: () => {
      setDraft(null)
      return refresh()
    },
  })
  const remove = useMutation({ mutationFn: (name: string) => deleteEntity(client, name), onSuccess: refresh })
  const attach = useMutation({
    mutationFn: async ({ entity, name }: { entity: Entity; name: string }) => {
      const accessor = await userpassAccessor(client)
      if (!accessor) throw new Error('The userpass auth method is not enabled.')
      await addAlias(client, { name, entityId: entity.id, mountAccessor: accessor })
    },
    onSuccess: () => {
      setAliasName('')
      setDraft(null)
      return refresh()
    },
  })
  const detach = useMutation({
    mutationFn: (aliasId: string) => deleteAlias(client, aliasId),
    onSuccess: () => {
      setDraft(null)
      return refresh()
    },
  })

  function submit(e: FormEvent) {
    e.preventDefault()
    if (draft) save.mutate(draft)
  }

  return (
    <section>
      <ListState query={entities} empty="No entities yet." />
      {!!entities.data?.length && (
      <table aria-label="Entities">
        <thead>
          <tr>
            <th>Entity</th>
            <th>Aliases</th>
            <th>Policies</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {entities.data?.map((e) => (
            <tr key={e.id}>
              <td>{e.name}</td>
              <td>{e.aliases.map((a) => a.name).join(', ') || '—'}</td>
              <td>{e.policies.join(', ') || '—'}</td>
              <td>
                <button type="button" aria-label={`Access ${e.name}`} onClick={() => setAccessFor(e.name)}>
                  Access
                </button>{' '}
                <button type="button" aria-label={`Edit ${e.name}`} onClick={() => setDraft({ name: e.name, policies: e.policies, isNew: false, entity: e })}>
                  Edit
                </button>{' '}
                <button
                  type="button"
                  aria-label={`Delete ${e.name}`}
                  onClick={() => window.confirm(`Delete entity "${e.name}" and its aliases?`) && remove.mutate(e.name)}
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
        <button type="button" onClick={() => setDraft({ name: '', policies: [], isNew: true })}>
          New entity
        </button>
      )}
      {draft && (
        <form onSubmit={submit} aria-label={draft.isNew ? 'New entity' : `Edit ${draft.name}`}>
          <label>
            Name
            <input value={draft.name} disabled={!draft.isNew} onChange={(e) => setDraft({ ...draft, name: e.target.value })} required />
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
          {draft.entity && (
            <fieldset>
              <legend>Userpass aliases</legend>
              {draft.entity.aliases.map((a) => (
                <div key={a.id}>
                  {a.name}{' '}
                  <button type="button" onClick={() => window.confirm(`Remove alias "${a.name}"?`) && detach.mutate(a.id)}>
                    Remove
                  </button>
                </div>
              ))}
              <label>
                Link userpass user
                <input value={aliasName} onChange={(e) => setAliasName(e.target.value)} placeholder="username" />
              </label>
              <button
                type="button"
                disabled={!aliasName || attach.isPending}
                onClick={() => draft.entity && attach.mutate({ entity: draft.entity, name: aliasName })}
              >
                Link
              </button>
              {(attach.error || detach.error) && <p role="alert">{(attach.error ?? detach.error)?.message}</p>}
            </fieldset>
          )}
        </form>
      )}
      {accessFor && <AccessEditor key={accessFor} client={client} target={{ kind: 'entity', name: accessFor }} onClose={() => setAccessFor(null)} />}
    </section>
  )
}
