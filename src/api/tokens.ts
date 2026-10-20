import type { BaoClient } from './bao'

export interface TokenSummary {
  accessor: string
  display_name: string
  policies: string[]
  /** Remaining TTL in seconds; 0 means no expiry (e.g. root). */
  ttl: number
  renewable: boolean
  orphan: boolean
  creation_time: string
  expire_time: string | null
}

export interface CreateTokenInput {
  displayName: string
  policies: string[]
  ttl?: string
  renewable: boolean
  /** Detach from the creating token so it outlives it. Needs sudo. */
  orphan: boolean
}

export interface CreatedToken {
  token: string
  accessor: string
  policies: string[]
}

export async function lookupAccessor(c: BaoClient, accessor: string): Promise<TokenSummary> {
  const res = await c.request<{ data: TokenSummary }>('POST', 'auth/token/lookup-accessor', { accessor })
  return res.data
}

/** A token can expire between listing and lookup, so individual failures are skipped. */
export async function listTokens(c: BaoClient): Promise<TokenSummary[]> {
  const accessors = await c.list('auth/token/accessors')
  const found = await Promise.all(accessors.map((a) => lookupAccessor(c, a).catch(() => null)))
  return found.filter((t): t is TokenSummary => t !== null)
}

export async function createToken(c: BaoClient, input: CreateTokenInput): Promise<CreatedToken> {
  const res = await c.request<{ auth: { client_token: string; accessor: string; policies: string[] } }>(
    'POST',
    'auth/token/create',
    {
      display_name: input.displayName || undefined,
      policies: input.policies,
      ttl: input.ttl || undefined,
      renewable: input.renewable,
      no_parent: input.orphan || undefined,
    },
  )
  return { token: res.auth.client_token, accessor: res.auth.accessor, policies: res.auth.policies }
}

export async function revokeToken(c: BaoClient, accessor: string): Promise<void> {
  await c.request('POST', 'auth/token/revoke-accessor', { accessor })
}
