import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import type { BaoClient } from '../../api/bao'
import { createToken, listTokens, revokeToken, type CreatedToken } from '../../api/tokens'
import { useSession } from '../../api/useSession'
import { ListState } from '../shared/ListState'
import { PolicyPicker } from '../shared/PolicyPicker'
import { useConfirm } from '../shared/useConfirm'
import { PolicyChips } from '../shared/PolicyChips'

interface Draft {
  displayName: string
  policies: string[]
  ttl: string
  renewable: boolean
  orphan: boolean
}

const empty: Draft = { displayName: '', policies: [], ttl: '', renewable: true, orphan: false }

function formatTtl(seconds: number): string {
  if (!seconds) return 'no expiry'
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h`
  return `${Math.round(seconds / 86400)}d`
}

export function TokensTab({ client }: { client: BaoClient }) {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const { tokenInfo } = useSession()
  const tokens = useQuery({ queryKey: ['tokens'], queryFn: () => listTokens(client) })
  const [draft, setDraft] = useState<Draft | null>(null)
  // The token value is only ever held here, and cleared when dismissed.
  const [created, setCreated] = useState<CreatedToken | null>(null)
  const [copied, setCopied] = useState(false)

  const create = useMutation({
    mutationFn: (d: Draft) => createToken(client, d),
    onSuccess: (t) => {
      setDraft(null)
      setCreated(t)
      setCopied(false)
      return qc.invalidateQueries({ queryKey: ['tokens'] })
    },
  })
  const revoke = useMutation({
    mutationFn: (accessor: string) => revokeToken(client, accessor),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tokens'] }),
  })

  function submit(e: FormEvent) {
    e.preventDefault()
    if (draft) create.mutate(draft)
  }

  async function copy() {
    if (!created) return
    try {
      await navigator.clipboard.writeText(created.token)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  return (
    <section>
      {created && (
        <div role="status" className="secret-once">
          <p>
            <strong>Copy this token now. It will not be shown again.</strong>
          </p>
          <code className="token-value">{created.token}</code>
          <div className="form-actions">
            <button type="button" className="primary" onClick={copy}>
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button type="button" onClick={() => setCreated(null)}>
              Done
            </button>
          </div>
        </div>
      )}
      <ListState query={tokens} empty="No tokens." />
      {!!tokens.data?.length && (
      <table aria-label="Tokens">
        <thead>
          <tr>
            <th>Name</th>
            <th>Policies</th>
            <th>Expires</th>
            <th>Accessor</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {tokens.data?.map((t) => {
            const isSelf = t.accessor === tokenInfo?.accessor
            return (
              <tr key={t.accessor}>
                <td>
                  {t.display_name || '—'}
                  {isSelf ? ' (you)' : ''}
                </td>
                <td>
                  <PolicyChips policies={t.policies} />
                </td>
                <td>{formatTtl(t.ttl)}</td>
                <td>
                  <code>{t.accessor.slice(0, 8)}…</code>
                </td>
                <td>
                  <button
                    type="button"
                    aria-label={`Revoke ${t.display_name || t.accessor}`}
                    disabled={isSelf}
                    title={isSelf ? 'This is the token you are signed in with' : undefined}
                    onClick={async () => {
                      const ok = await confirm({
                        title: `Revoke token “${t.display_name || t.accessor}”?`,
                        message: 'Tokens created from it are revoked too.',
                        confirmLabel: 'Revoke',
                      })
                      if (ok) revoke.mutate(t.accessor)
                    }}
                  >
                    Revoke
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      )}
      {revoke.error && <p role="alert">{revoke.error.message}</p>}
      {!draft && (
        <button type="button" onClick={() => setDraft(empty)}>
          New token
        </button>
      )}
      {draft && (
        <form onSubmit={submit} aria-label="New token" className="wide">
          <h3>New token</h3>
          <label>
            Display name
            <input value={draft.displayName} onChange={(e) => setDraft({ ...draft, displayName: e.target.value })} />
          </label>
          <label>
            TTL
            <input value={draft.ttl} onChange={(e) => setDraft({ ...draft, ttl: e.target.value })} placeholder="e.g. 24h (blank = default)" />
          </label>
          <label className="check">
            <input type="checkbox" checked={draft.renewable} onChange={(e) => setDraft({ ...draft, renewable: e.target.checked })} /> Renewable
          </label>
          <label className="check">
            <input type="checkbox" checked={draft.orphan} onChange={(e) => setDraft({ ...draft, orphan: e.target.checked })} />
            <span>
              Orphan <span className="hint">(outlives the token you are signed in with; requires sudo)</span>
            </span>
          </label>
          <PolicyPicker client={client} value={draft.policies} onChange={(policies) => setDraft({ ...draft, policies })} />
          {draft.policies.length === 0 && (
            <p className="note-warn">
              No policies selected: OpenBao gives the new token the same policies as yours
              {tokenInfo?.policies.length ? ` (${tokenInfo.policies.join(', ')})` : ''}.
            </p>
          )}
          {create.error && <p role="alert">{create.error.message}</p>}
          <div className="form-actions">
            <button type="submit" disabled={create.isPending}>
              Create
            </button>
            <button type="button" onClick={() => setDraft(null)}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  )
}
