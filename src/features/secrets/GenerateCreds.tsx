import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import type { BaoClient } from '../../api/bao'
import { generateCreds, type Credentials } from '../../api/engines/creds'
import { revokeLease } from '../../api/engines/leases'
import type { CredKind } from '../../api/engines/registry'
import { emptyDraft, payloadFromDraft, type RoleDraft } from '../../api/engines/roles'
import { RoleEditor } from './RoleEditor'

const show = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v, null, 2))

function CopyButton({ text, label }: { text: string; label: string }) {
  return (
    <button type="button" aria-label={`Copy ${label}`} onClick={() => void navigator.clipboard?.writeText(text).catch(() => {})}>
      Copy
    </button>
  )
}

/**
 * Asks OpenBao for credentials and shows them exactly once. The result lives only in this component's mutation
 * (gcTime 0, reset on dismiss): it is never a query, so it is never cached, persisted or put in the URL.
 */
export function GenerateCreds({
  client,
  mount,
  role,
  kinds,
  onClose,
}: {
  client: BaoClient
  mount: string
  role: string
  kinds: CredKind[]
  onClose: () => void
}) {
  const [kindId, setKindId] = useState(kinds[0].id)
  const kind = kinds.find((k) => k.id === kindId) ?? kinds[0]
  const [draft, setDraft] = useState<RoleDraft>(() => emptyDraft({ fields: kind.inputs }))
  const [formError, setFormError] = useState<string | null>(null)

  const generate = useMutation({
    gcTime: 0,
    mutationFn: (body: Record<string, unknown>) => generateCreds(client, mount, kind, role, body),
  })
  const revoke = useMutation({ gcTime: 0, mutationFn: (leaseId: string) => revokeLease(client, leaseId) })

  const close = () => {
    generate.reset()
    revoke.reset()
    onClose()
  }

  if (generate.data) return <Issued creds={generate.data} role={role} revoke={revoke} onRevoke={() => revoke.mutate(generate.data.leaseId)} onDone={close} />

  return (
    <div className="creds">
      {kinds.length > 1 && (
        <label>
          Action
          <select
            value={kind.id}
            onChange={(e) => {
              const next = kinds.find((k) => k.id === e.target.value) ?? kinds[0]
              setKindId(next.id)
              setDraft(emptyDraft({ fields: next.inputs }))
              setFormError(null)
            }}
          >
            {kinds.map((k) => (
              <option key={k.id} value={k.id}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
      )}
      <RoleEditor
        key={kind.id}
        kind={{ fields: kind.inputs }}
        noun={`${kind.label.toLowerCase()} for ${role}`}
        showName={false}
        submitLabel="Generate"
        draft={draft}
        pending={generate.isPending}
        error={formError ?? generate.error?.message ?? null}
        onChange={setDraft}
        onSubmit={() => {
          setFormError(null)
          try {
            generate.mutate(payloadFromDraft({ fields: kind.inputs }, draft))
          } catch (e) {
            setFormError((e as Error).message)
          }
        }}
        onCancel={close}
      />
    </div>
  )
}

function Issued({
  creds,
  role,
  revoke,
  onRevoke,
  onDone,
}: {
  creds: Credentials
  role: string
  revoke: { isPending: boolean; isSuccess: boolean; error: Error | null }
  onRevoke: () => void
  onDone: () => void
}) {
  return (
    <section role="dialog" aria-label={`Credentials for ${role}`} className="creds-issued">
      <h3>Credentials for {role}</h3>
      <p className="hint">Copy these now. They are not stored and cannot be shown again.</p>
      <dl>
        {Object.entries(creds.data).map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>
              <code>{show(v)}</code> <CopyButton text={show(v)} label={k} />
            </dd>
          </div>
        ))}
      </dl>
      {creds.leaseId ? (
        <p>
          Lease <code>{creds.leaseId}</code>
          {creds.leaseDuration > 0 && ` · valid for ${creds.leaseDuration}s`}
        </p>
      ) : (
        <p className="hint">No lease: these credentials are not revoked when they expire.</p>
      )}
      {creds.warnings.map((w) => (
        <p key={w} className="hint">
          {w}
        </p>
      ))}
      {revoke.error && <p role="alert">{revoke.error.message}</p>}
      {revoke.isSuccess && <p role="status">Lease revoked.</p>}
      <div className="form-actions">
        {creds.leaseId && !revoke.isSuccess && (
          <button type="button" onClick={onRevoke} disabled={revoke.isPending}>
            Revoke now
          </button>
        )}
        <button type="button" onClick={onDone}>
          Done
        </button>
      </div>
    </section>
  )
}
