import type { BaoClient } from '../bao'

const enc = (path: string) => path.split('/').map(encodeURIComponent).join('/')

export interface LeaseEntry {
  name: string
  /** Full lease id, or for folders the prefix (trailing slash) to browse next. */
  path: string
  isFolder: boolean
}

export interface LeaseInfo {
  id: string
  /** ISO timestamps; expireTime is null for leases that never expire. */
  issueTime: string
  expireTime: string | null
  lastRenewal: string | null
  renewable: boolean
  /** Seconds remaining. */
  ttl: number
}

/**
 * Lists leases under a prefix such as "database/creds/" (the mount plus a path). Folders end with "/" and the rest are
 * lease ids. Needs sudo on sys/leases/lookup, which most tokens lack.
 */
export async function listLeases(c: BaoClient, prefix: string): Promise<LeaseEntry[]> {
  const keys = await c.list(`sys/leases/lookup/${enc(prefix)}`)
  return keys
    .map((k) => ({ name: k, path: prefix + k, isFolder: k.endsWith('/') }))
    .sort((a, b) => Number(b.isFolder) - Number(a.isFolder) || a.name.localeCompare(b.name))
}

export async function lookupLease(c: BaoClient, leaseId: string): Promise<LeaseInfo> {
  const res = await c.request<{
    data: { id: string; issue_time: string; expire_time: string | null; last_renewal: string | null; renewable: boolean; ttl: number }
  }>('PUT', 'sys/leases/lookup', { lease_id: leaseId })
  const d = res.data
  return { id: d.id, issueTime: d.issue_time, expireTime: d.expire_time, lastRenewal: d.last_renewal, renewable: d.renewable, ttl: d.ttl }
}

/** Extends a lease by `increment` (e.g. "1h"); OpenBao may grant less. Returns the new lease duration in seconds. */
export async function renewLease(c: BaoClient, leaseId: string, increment?: string): Promise<number> {
  const res = await c.request<{ lease_duration: number }>('PUT', 'sys/leases/renew', {
    lease_id: leaseId,
    ...(increment ? { increment } : {}),
  })
  return res.lease_duration
}

/** Revokes one lease, which also deletes the credentials it issued (database user, AWS key, ...). */
export async function revokeLease(c: BaoClient, leaseId: string): Promise<void> {
  await c.request('PUT', 'sys/leases/revoke', { lease_id: leaseId })
}

/** Revokes every lease under a prefix, e.g. all credentials issued from one role. Needs sudo. */
export async function revokePrefix(c: BaoClient, prefix: string): Promise<void> {
  await c.request('PUT', `sys/leases/revoke-prefix/${enc(prefix.replace(/\/+$/, ''))}`, {})
}
