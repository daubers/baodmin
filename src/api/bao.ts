export type BaoErrorKind = 'network' | 'auth' | 'forbidden' | 'not-found' | 'server' | 'bad-response'

export class BaoError extends Error {
  readonly kind: BaoErrorKind
  readonly status?: number
  readonly errors: string[]

  constructor(kind: BaoErrorKind, message: string, status?: number, errors: string[] = []) {
    super(message)
    this.name = 'BaoError'
    this.kind = kind
    this.status = status
    this.errors = errors
  }
}

export interface BaoHealth {
  initialized: boolean
  sealed: boolean
  standby: boolean
  version: string
  cluster_name?: string
}

export interface TokenInfo {
  id?: string
  accessor: string
  display_name: string
  policies: string[]
  ttl: number
  renewable: boolean
}

export interface LoginResult {
  token: string
  policies: string[]
  leaseDuration: number
}

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE'

const CORS_HINT =
  'Could not reach OpenBao. Check the URL, that the server is running, and that CORS allows this origin ' +
  '(bao write sys/config/cors enabled=true allowed_origins=<this origin>).'

export function normaliseBaseUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(trimmed)) throw new BaoError('network', 'URL must start with http:// or https://')
  return trimmed
}

function kindForStatus(status: number): BaoErrorKind {
  if (status === 401) return 'auth'
  if (status === 403) return 'forbidden'
  if (status === 404) return 'not-found'
  return 'server'
}

export class BaoClient {
  readonly baseUrl: string
  private token: string | undefined

  constructor(baseUrl: string, token?: string) {
    this.baseUrl = normaliseBaseUrl(baseUrl)
    this.token = token
  }

  withToken(token: string): BaoClient {
    return new BaoClient(this.baseUrl, token)
  }

  async request<T = unknown>(method: Method, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {}
    if (this.token) headers['X-Vault-Token'] = this.token
    if (body !== undefined) headers['Content-Type'] = 'application/json'

    let res: Response
    try {
      res = await fetch(`${this.baseUrl}/v1/${path.replace(/^\/+/, '')}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    } catch {
      throw new BaoError('network', CORS_HINT)
    }

    if (res.status === 204) return undefined as T

    let json: unknown
    try {
      json = await res.json()
    } catch {
      if (res.ok) throw new BaoError('bad-response', 'OpenBao returned a non-JSON response. Is the URL correct?', res.status)
      throw new BaoError(kindForStatus(res.status), `OpenBao returned HTTP ${res.status}`, res.status)
    }

    if (!res.ok) {
      const errors = (json as { errors?: string[] }).errors ?? []
      const message =
        res.status === 401 || res.status === 403
          ? errors.join('; ') || 'Permission denied'
          : errors.join('; ') || `OpenBao returned HTTP ${res.status}`
      throw new BaoError(kindForStatus(res.status), message, res.status, errors)
    }
    return json as T
  }

  async list(path: string): Promise<string[]> {
    try {
      const res = await this.request<{ data: { keys: string[] } }>('GET', `${path.replace(/\/+$/, '')}/?list=true`)
      return res.data.keys
    } catch (e) {
      if (e instanceof BaoError && e.kind === 'not-found') return []
      throw e
    }
  }

  /** Unauthenticated; sealed/standby/uninitialised states still return a body. */
  async health(): Promise<BaoHealth> {
    return this.request<BaoHealth>('GET', 'sys/health?standbyok=true&sealedcode=200&uninitcode=200&perfstandbyok=true')
  }

  async lookupSelf(): Promise<TokenInfo> {
    const res = await this.request<{ data: TokenInfo }>('GET', 'auth/token/lookup-self')
    return res.data
  }

  async loginUserpass(username: string, password: string): Promise<LoginResult> {
    const res = await this.request<{ auth: { client_token: string; policies: string[]; lease_duration: number } }>(
      'POST',
      `auth/userpass/login/${encodeURIComponent(username)}`,
      { password },
    )
    return { token: res.auth.client_token, policies: res.auth.policies, leaseDuration: res.auth.lease_duration }
  }
}
