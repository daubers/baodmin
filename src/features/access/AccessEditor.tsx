import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import type { BaoClient } from '../../api/bao'
import { getGrantState, grantAccess, revokeAccess, type Target } from '../../api/grants'
import { listKvMounts, readPolicyHcl } from '../../api/secrets'
import { KV_CAPABILITIES, kvGrantRules, validateGrantPath, type KvCapability } from '../../model/managed'
import { PathPicker } from './PathPicker'

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
  const qc = useQueryClient()
  const stateKey = ['grant-state', target.kind, target.name]
  const state = useQuery({ queryKey: stateKey, queryFn: () => getGrantState(client, target) })
  const mounts = useQuery({ queryKey: ['kv-mounts'], queryFn: () => listKvMounts(client) })

  const [mountChoice, setMount] = useState<string | null>(null)
  const [secretPath, setSecretPath] = useState('')
  const [caps, setCaps] = useState<KvCapability[]>(['read'])
  const [showRaw, setShowRaw] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const mount = mountChoice ?? mounts.data?.[0]?.path ?? ''

  const done = () =>
    Promise.all(
      [stateKey, ['users'], ['entities'], ['groups'], ['access-inputs'], ['policies']].map((queryKey) =>
        qc.invalidateQueries({ queryKey }),
      ),
    )

  const grant = useMutation({
    mutationFn: () => grantAccess(client, target, kvGrantRules(mount, secretPath, caps)),
    onSuccess: () => {
      setSecretPath('')
      return done()
    },
  })
  const revoke = useMutation({ mutationFn: (path: string) => revokeAccess(client, target, [path]), onSuccess: done })

  function submit(e: FormEvent) {
    e.preventDefault()
    const err = validateGrantPath(secretPath) ?? (caps.length === 0 ? 'Select at least one capability.' : null)
    setFormError(err)
    if (!err) grant.mutate()
  }

  const s = state.data
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
            {s.managed?.grants.length ? (
              <table aria-label="Granted by EnvBao">
                <thead>
                  <tr>
                    <th>Path</th>
                    <th>Capabilities</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {s.managed.grants.map((g) => (
                    <tr key={g.path}>
                      <td>
                        <code>{g.path}</code>
                      </td>
                      <td>{g.capabilities.join(', ')}</td>
                      <td>
                        <button
                          type="button"
                          aria-label={`Revoke ${g.path}`}
                          disabled={!editable}
                          onClick={() => window.confirm(`Revoke ${g.capabilities.join(', ')} on ${g.path}?`) && revoke.mutate(g.path)}
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
                  onChange={(e) => {
                    setMount(e.target.value)
                    setSecretPath('')
                  }}
                >
                  {mounts.data?.map((m) => (
                    <option key={m.path}>{m.path}</option>
                  ))}
                </select>
              </label>
              {mount && <PathPicker key={mount} client={client} mount={mount} value={secretPath} onChange={setSecretPath} />}
              <fieldset className="caps">
                <legend>Capabilities</legend>
                {KV_CAPABILITIES.map((c) => (
                  <label key={c} className="check">
                    <input
                      type="checkbox"
                      checked={caps.includes(c)}
                      onChange={(e) => setCaps(e.target.checked ? [...caps, c] : caps.filter((x) => x !== c))}
                    />{' '}
                    {c}
                  </label>
                ))}
              </fieldset>
              <p className="hint">
                Granting a path that already has a grant replaces its capabilities. “list” applies to the secret’s metadata path.
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
