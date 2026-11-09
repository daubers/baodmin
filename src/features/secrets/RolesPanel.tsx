import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type { BaoClient } from '../../api/bao'
import type { EngineDef } from '../../api/engines/registry'
import {
  deleteRole,
  draftFromRole,
  emptyDraft,
  listRoles,
  payloadFromDraft,
  readRole,
  writeRole,
  type RoleDraft,
} from '../../api/engines/roles'
import { ListState } from '../shared/ListState'
import { useConfirm } from '../shared/useConfirm'
import { GenerateCreds } from './GenerateCreds'
import { RoleAccessPanel } from './RoleAccessPanel'
import { RoleEditor } from './RoleEditor'

export function RolesPanel({ client, mount, engine }: { client: BaoClient; mount: string; engine: EngineDef }) {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [kindId, setKindId] = useState(engine.roleKinds[0].id)
  const kind = engine.roleKinds.find((k) => k.id === kindId) ?? engine.roleKinds[0]
  const [draft, setDraft] = useState<RoleDraft | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [credsFor, setCredsFor] = useState<string | null>(null)
  const [accessFor, setAccessFor] = useState<string | null>(null)

  const key = ['engine-roles', mount, kind.id]
  const roles = useQuery({ queryKey: key, queryFn: () => listRoles(client, mount, kind) })

  const save = useMutation({
    mutationFn: (d: RoleDraft) => writeRole(client, mount, kind, d.name.trim(), payloadFromDraft(kind, d)),
    onSuccess: () => {
      setDraft(null)
      return qc.invalidateQueries({ queryKey: key })
    },
  })
  const remove = useMutation({
    mutationFn: (name: string) => deleteRole(client, mount, kind, name),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  })
  const edit = useMutation({
    mutationFn: (name: string) => readRole(client, mount, kind, name).then((data) => draftFromRole(kind, name, data)),
    onSuccess: (d) => {
      setFormError(null)
      setDraft(d)
    },
  })

  const switchKind = (id: string) => {
    setKindId(id)
    setDraft(null)
    setCredsFor(null)
    setAccessFor(null)
    save.reset()
  }

  return (
    <section aria-label="Roles">
      {engine.roleKinds.length > 1 && (
        <div role="tablist" aria-label="Role type" className="tabs">
          {engine.roleKinds.map((k) => (
            <button key={k.id} type="button" role="tab" aria-selected={k.id === kind.id} onClick={() => switchKind(k.id)}>
              {k.label}
            </button>
          ))}
        </div>
      )}
      <ListState query={roles} empty={`No ${kind.label.toLowerCase()} yet.`} />
      {!!roles.data?.length && (
        <table aria-label={kind.label}>
          <thead>
            <tr>
              <th>Role</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {roles.data.map((name) => (
              <tr key={name}>
                <td>{name}</td>
                <td>
                  {kind.creds.length > 0 && (
                    <button type="button" aria-label={`Generate ${name}`} onClick={() => setCredsFor(name)}>
                      Generate
                    </button>
                  )}
                  <button type="button" aria-label={`Access ${name}`} onClick={() => setAccessFor(name)}>
                    Access
                  </button>
                  <button type="button" aria-label={`Edit ${name}`} onClick={() => edit.mutate(name)}>
                    Edit
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete ${name}`}
                    onClick={async () => {
                      if (
                        await confirm({
                          title: `Delete role “${name}”?`,
                          message: 'Credentials already issued from it stay valid until their leases end.',
                          confirmLabel: 'Delete',
                        })
                      )
                        remove.mutate(name)
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
      {credsFor && (
        <GenerateCreds
          key={`${kind.id}/${credsFor}`}
          client={client}
          mount={mount}
          role={credsFor}
          kinds={kind.creds}
          onClose={() => setCredsFor(null)}
        />
      )}
      {accessFor && (
        <RoleAccessPanel key={`${kind.id}/${accessFor}`} client={client} mount={mount} kind={kind} role={accessFor} onClose={() => setAccessFor(null)} />
      )}
      {remove.error && <p role="alert">{remove.error.message}</p>}
      {edit.error && <p role="alert">{edit.error.message}</p>}
      {!draft && (
        <button
          type="button"
          onClick={() => {
            setFormError(null)
            save.reset()
            setDraft(emptyDraft(kind))
          }}
        >
          New role
        </button>
      )}
      {draft && (
        <RoleEditor
          kind={kind}
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
          onCancel={() => {
            setDraft(null)
            save.reset()
          }}
        />
      )}
    </section>
  )
}
