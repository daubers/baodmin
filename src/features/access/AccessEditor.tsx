import { useMutation, useQuery } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import type { BaoClient } from '../../api/bao'
import { getGrantState, grantAccess, revokeAccess, type Target } from '../../api/grants'
import { engineFor, mountKind } from '../../api/engines/registry'
import { readPolicyHcl } from '../../api/secrets'
import { dynamicGrantRules, kvGrantRules, validateGrantPath, type DynamicAccess, type KvCapability } from '../../model/managed'
import { groupGrants } from '../../model/grantRows'
import { CapabilityChips } from '../shared/CapabilityChips'
import { CapabilityPicker } from '../shared/CapabilityPicker'
import { DynamicAccessPicker } from '../shared/DynamicAccessPicker'
import { useMounts } from '../shared/useMounts'
import { useRefreshAccess } from '../shared/useRefreshAccess'
import { PathPicker } from './PathPicker'
import { RolePicker, type RoleSelection } from './RolePicker'
import { useConfirm } from '../shared/useConfirm'

interface Props {
  client: BaoClient
  target: Target
  onClose: () => void
}

function PolicyView({ client, name }: { client: BaoClient; name: string }) {
  const [open, setOpen] = useState(false)
  const hcl = useQuery({ queryKey: ['policy-hcl', name], queryFn: () => readPolicyHcl(client, name), enabled: open })
  return (
    <li>
      {name}{' '}
      <button type="button" aria-label={`${open ? 'Hide' : 'View'} ${name}`} aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? 'Hide' : 'View'}
      </button>
      {open && <pre>{hcl.isPending ? 'Loading…' : (hcl.data ?? 'Could not read this policy.')}</pre>}
    </li>
  )
}

export function AccessEditor({ client, target, onClose }: Props) {
  const confirm = useConfirm()
  const stateKey = ['grant-state', target.kind, target.name]
  const state = useQuery({ queryKey: stateKey, queryFn: () => getGrantState(client, target) })
  const mounts = useMounts(client)

  const [mountChoice, setMount] = useState<string | null>(null)
  const [secretPath, setSecretPath] = useState('')
  const [caps, setCaps] = useState<KvCapability[]>(['read'])
  const [roleSel, setRoleSel] = useState<RoleSelection>({ kindId: '', role: '' })
  const [access, setAccess] = useState<DynamicAccess[]>(['generate'])
  const [showRaw, setShowRaw] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const current = mounts.data?.find((m) => m.path === mountChoice) ?? mounts.data?.[0]
  const mount = current?.path ?? ''
  const dynamic = current !== undefined && mountKind(current) === 'dynamic'
  const engine = dynamic ? engineFor(current.type) : null
  const roleKind = engine ? (engine.roleKinds.find((k) => k.id === roleSel.kindId) ?? engine.roleKinds[0]) : null

  const done = useRefreshAccess()

  const grant = useMutation({
    mutationFn: () =>
      grantAccess(client, target, roleKind ? dynamicGrantRules(roleKind, mount, roleSel.role, access) : kvGrantRules(mount, secretPath, caps)),
    onSuccess: () => {
      setSecretPath('')
      setRoleSel({ kindId: roleSel.kindId, role: '' })
      return done()
    },
  })
  const revoke = useMutation({ mutationFn: (paths: string[]) => revokeAccess(client, target, paths), onSuccess: done })

  function submit(e: FormEvent) {
    e.preventDefault()
    const err = roleKind
      ? (roleSel.role ? validateGrantPath(`${mount}${roleKind.path}/${roleSel.role}`) : 'Choose a role.') ??
        (access.length === 0 ? 'Select at least one kind of access.' : null)
      : (validateGrantPath(secretPath) ?? (caps.length === 0 ? 'Select at least one capability.' : null))
    setFormError(err)
    if (!err) grant.mutate()
  }

  const s = state.data
  const rows = groupGrants(s?.managed?.grants ?? [], mounts.data?.map((m) => m.path) ?? [])
  const editable = !s?.managed || s.managed.editable

  return (
    <section aria-label={`Access for ${target.name}`} className="access-editor">
      <header className="access-head">
        <h2>
          Access for <strong>{target.name}</strong> <span className="kind">{target.kind}</span>
        </h2>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </header>
      {state.error && <p role="alert">{state.error.message}</p>}
      {s && (
        <div className="access-body">
          <div className="access-current">
            <div className="section-head">
              <h3>Granted by EnvBao</h3>
              {s.hcl && (
                <button type="button" className="link" aria-expanded={showRaw} onClick={() => setShowRaw(!showRaw)}>
                  {showRaw ? 'Hide' : 'Show'} policy HCL ({s.policyName})
                </button>
              )}
            </div>
            {s.managed && !s.managed.editable && (
              <p role="alert">
                This policy was changed outside EnvBao and is read-only here: {s.managed.reasons.join('; ')}
              </p>
            )}
            {showRaw && <pre>{s.hcl}</pre>}
            {rows.length ? (
              <table aria-label="Granted by EnvBao">
                <thead>
                  <tr>
                    <th>Secret</th>
                    <th>Can</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.display}>
                      <td>
                        <code>{row.display}</code>
                        {row.wildcard && <span className="tag">everything inside</span>}
                      </td>
                      <td data-label="Can">
                        <CapabilityChips capabilities={row.capabilities} />
                      </td>
                      <td>
                        <button
                          type="button"
                          aria-label={`Revoke ${row.display}`}
                          disabled={!editable}
                          onClick={async () => {
                            const ok = await confirm({
                              title: `Revoke access to ${row.display}?`,
                              message: `Removes ${row.capabilities.join(', ')} from ${target.kind} “${target.name}”.`,
                              confirmLabel: 'Revoke',
                            })
                            if (ok) revoke.mutate(row.paths)
                          }}
                        >
                          Revoke
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="hint">No access granted through EnvBao yet.</p>
            )}
            {revoke.error && <p role="alert">{revoke.error.message}</p>}

            <h3>Other policies</h3>
            <p className="hint">Set outside EnvBao, so they can only be viewed here.</p>
            {s.otherPolicies.length ? (
              <ul className="policy-list">
                {s.otherPolicies.map((p) => (
                  <PolicyView key={p} client={client} name={p} />
                ))}
              </ul>
            ) : (
              <p className="hint">None.</p>
            )}
          </div>

          {editable && (
            <form onSubmit={submit} aria-label="Grant access" className="access-grant">
              <h3>Grant access</h3>
              <label>
                Secrets engine
                <select
                  value={mount}
                  onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
                  onChange={(e) => {
                    setMount(e.target.value)
                    setSecretPath('')
                    setRoleSel({ kindId: '', role: '' })
                  }}
                >
                  {mounts.data?.map((m) => (
                    <option key={m.path}>{m.path}</option>
                  ))}
                </select>
              </label>
              {mount && engine && <RolePicker key={mount} client={client} mount={mount} engine={engine} value={roleSel} onChange={setRoleSel} />}
              {mount && !engine && <PathPicker key={mount} client={client} mount={mount} value={secretPath} onChange={setSecretPath} />}
              {engine ? <DynamicAccessPicker value={access} onChange={setAccess} /> : <CapabilityPicker value={caps} onChange={setCaps} />}
              <p className="hint">
                {engine
                  ? 'Granting a role that already has a grant replaces its access. Unticked access is removed.'
                  : 'Granting a path that already has a grant replaces its capabilities. “list” applies to the secret’s metadata path.'}
              </p>
              {(formError || grant.error) && <p role="alert">{formError ?? grant.error?.message}</p>}
              <button type="submit" disabled={grant.isPending || !mount}>
                Grant
              </button>
            </form>
          )}
        </div>
      )}
    </section>
  )
}
