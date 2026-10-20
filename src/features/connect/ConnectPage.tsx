import { useState, type FormEvent } from 'react'
import { BaoClient, BaoError, type BaoHealth } from '../../api/bao'
import { useSession } from '../../api/useSession'

type Mode = 'token' | 'userpass'

export function ConnectPage() {
  const { client, tokenInfo, connect, disconnect } = useSession()
  const [url, setUrl] = useState(client?.baseUrl ?? 'http://127.0.0.1:8200')
  const [mode, setMode] = useState<Mode>('token')
  const [token, setToken] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [health, setHealth] = useState<BaoHealth | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setHealth(null)
    try {
      const anon = new BaoClient(url)
      const h = await anon.health()
      setHealth(h)
      if (!h.initialized) throw new BaoError('server', 'OpenBao is not initialised.')
      if (h.sealed) throw new BaoError('server', 'OpenBao is sealed. Unseal it before connecting.')
      const authed = mode === 'token' ? anon.withToken(token) : anon.withToken((await anon.loginUserpass(username, password)).token)
      connect(authed, await authed.lookupSelf())
      setToken('')
      setPassword('')
    } catch (err) {
      setError(
        err instanceof BaoError && err.kind === 'auth' && mode === 'token'
          ? 'Invalid token.'
          : err instanceof Error
            ? err.message
            : String(err),
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <section>
      <h1>Connect</h1>
      {client && tokenInfo && (
        <p role="status">
          Connected to {client.baseUrl} as {tokenInfo.display_name || 'token'} (policies: {tokenInfo.policies.join(', ')}){' '}
          <button type="button" onClick={disconnect}>
            Disconnect
          </button>
        </p>
      )}
      <form onSubmit={submit}>
        <label>
          OpenBao URL
          <input value={url} onChange={(e) => setUrl(e.target.value)} required />
        </label>
        <fieldset>
          <legend>Login method</legend>
          <label>
            <input type="radio" checked={mode === 'token'} onChange={() => setMode('token')} /> Token
          </label>
          <label>
            <input type="radio" checked={mode === 'userpass'} onChange={() => setMode('userpass')} /> Userpass
          </label>
        </fieldset>
        {mode === 'token' ? (
          <label>
            Token
            <input type="password" value={token} onChange={(e) => setToken(e.target.value)} required autoComplete="off" />
          </label>
        ) : (
          <>
            <label>
              Username
              <input value={username} onChange={(e) => setUsername(e.target.value)} required />
            </label>
            <label>
              Password
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </label>
          </>
        )}
        <button type="submit" disabled={busy}>
          {busy ? 'Connecting…' : 'Connect'}
        </button>
      </form>
      {health && (
        <p>
          Server: OpenBao {health.version}, {health.sealed ? 'sealed' : 'unsealed'}
          {health.standby ? ', standby' : ''}
        </p>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  )
}
