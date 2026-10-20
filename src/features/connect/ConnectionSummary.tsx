import { useQuery } from '@tanstack/react-query'
import type { BaoClient, TokenInfo } from '../../api/bao'

function formatRemaining(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000))
  if (minutes < 1) return 'less than a minute'
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  const mins = minutes % 60
  if (days) return `${days}d ${hours}h`
  if (hours) return `${hours}h ${mins}m`
  return `${mins}m`
}

interface Props {
  client: BaoClient
  tokenInfo: TokenInfo
  onDisconnect: () => void
}

/** What you're connected to and as whom. Shown instead of the connect form while a session is active. */
export function ConnectionSummary({ client, tokenInfo, onDisconnect }: Props) {
  const health = useQuery({ queryKey: ['health', client.baseUrl], queryFn: () => client.health() })
  // The session's tokenInfo is a snapshot from sign-in, so look the token up again for a current TTL.
  const self = useQuery({ queryKey: ['token-self', client.baseUrl], queryFn: () => client.lookupSelf(), staleTime: 0 })

  const info = self.data ?? tokenInfo
  const remaining = `in ${formatRemaining(info.ttl * 1000)}`
  const expires = info.ttl <= 0 ? 'Never' : self.data ? `${remaining} (${new Date(self.dataUpdatedAt + info.ttl * 1000).toLocaleString()})` : remaining
  const h = health.data

  return (
    <div className="connection">
      <div className="connection-head" role="status">
        <p className="connection-state">
          <span className="dot" aria-hidden="true" />
          Connected to <code>{client.baseUrl}</code> as <strong>{info.display_name || 'token'}</strong>
        </p>
        <button type="button" onClick={onDisconnect}>
          Disconnect
        </button>
      </div>

      <div className="connection-grid">
        <section aria-labelledby="conn-server">
          <h2 id="conn-server">Server</h2>
          {health.isPending && <p className="hint">Checking server…</p>}
          {health.error && <p role="alert">{health.error.message}</p>}
          {h && (
            <dl>
              <dt>Version</dt>
              <dd>OpenBao {h.version}</dd>
              <dt>Status</dt>
              <dd>{!h.initialized ? 'Not initialised' : h.sealed ? 'Sealed' : 'Unsealed'}</dd>
              <dt>Role</dt>
              <dd>{h.standby ? 'Standby node' : 'Active node'}</dd>
              {h.cluster_name && (
                <>
                  <dt>Cluster</dt>
                  <dd>{h.cluster_name}</dd>
                </>
              )}
              {h.server_time_utc != null && (
                <>
                  <dt>Server time</dt>
                  <dd>{new Date(h.server_time_utc * 1000).toLocaleString(undefined, { timeZone: 'UTC', dateStyle: 'medium', timeStyle: 'medium' })} UTC</dd>
                </>
              )}
            </dl>
          )}
        </section>

        <section aria-labelledby="conn-session">
          <h2 id="conn-session">Your session</h2>
          <dl>
            <dt>Signed in as</dt>
            <dd>{info.display_name || 'token'}</dd>
            <dt>Policies</dt>
            <dd>
              {info.policies.length ? (
                <ul className="chips">
                  {info.policies.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              ) : (
                'None'
              )}
            </dd>
            <dt>Token expires</dt>
            <dd>{expires}</dd>
            <dt>Renewable</dt>
            <dd>{info.renewable ? 'Yes' : 'No'}</dd>
          </dl>
          <p className="hint">The token is held in memory only. Reloading the page signs you out.</p>
        </section>
      </div>
    </div>
  )
}
