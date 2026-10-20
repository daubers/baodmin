import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import type { BaoClient } from '../../api/bao'
import { getGrantState, grantAccess, revokeAccess, type Target } from '../../api/grants'
import { listKvMounts, readPolicyHcl } from '../../api/secrets'
import { KV_CAPABILITIES, kvGrantRules, validateGrantPath, type KvCapability } from '../../model/managed'

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
      <h2>
        Access: {target.kind} “{target.name}”
      </h2>
      <button type="button" onClick={onClose}>
        Close
      </button>
      {state.error && <p role="alert">{state.error.message}</p>}
      {s && (
        <>
          <h3>Granted by EnvBao</h3>
          {s.managed && !s.managed.editable && (
            <p role="alert">
              This policy was changed outside EnvBao and is read-only here: {s.managed.reasons.join('; ')}
            </p>
          )}
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
            <p>No access granted through EnvBao yet.</p>
          )}
          {s.hcl && (
            <p>
              <button type="button" aria-expanded={showRaw} onClick={() => setShowRaw(!showRaw)}>
                {showRaw ? 'Hide' : 'Show'} policy HCL ({s.policyName})
              </button>
            </p>
          )}
          {showRaw && <pre>{s.hcl}</pre>}
          {revoke.error && <p role="alert">{revoke.error.message}</p>}

          {editable && (
            <form onSubmit={submit} aria-label="Grant access">
              <h3>Grant access</h3>
              <label>
                Secrets engine
                <select value={mount} onChange={(e) => setMount(e.target.value)}>
                  {mounts.data?.map((m) => (
                    <option key={m.path}>{m.path}</option>
                  ))}
                </select>
              </label>
              <label>
                Secret path
                <input value={secretPath} onChange={(e) => setSecretPath(e.target.value)} placeholder="app/db or app/*" />
              </label>
              <fieldset>
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
                A trailing * matches everything below.
              </p>
              {(formError || grant.error) && <p role="alert">{formError ?? grant.error?.message}</p>}
              <button type="submit" disabled={grant.isPending || !mount}>
                Grant
              </button>
            </form>
          )}

          <h3>Other policies (not managed by EnvBao, read-only)</h3>
          {s.otherPolicies.length ? (
            <ul>
              {s.otherPolicies.map((p) => (
                <PolicyView key={p} client={client} name={p} />
              ))}
            </ul>
          ) : (
            <p>None.</p>
          )}
        </>
      )}
    </section>
  )
}
