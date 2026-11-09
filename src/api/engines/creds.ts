import type { BaoClient } from '../bao'
import type { CredKind } from './registry'
import type { RoleData } from './roles'

/** Credentials as issued. These are secrets: show them once and never put them in a query cache. */
export interface Credentials {
  /** Empty for credentials without a lease (database static roles). */
  leaseId: string
  /** Seconds; 0 when the credentials have no expiry. */
  leaseDuration: number
  renewable: boolean
  data: Record<string, unknown>
  warnings: string[]
}

interface CredResponse {
  lease_id?: string
  lease_duration?: number
  renewable?: boolean
  data?: Record<string, unknown>
  warnings?: string[] | null
}

export async function generateCreds(c: BaoClient, mount: string, kind: CredKind, role: string, body: RoleData): Promise<Credentials> {
  const path = `${mount}${kind.path(role)}`
  const res = await c.request<CredResponse>(kind.method, path, kind.method === 'POST' ? body : undefined)
  return {
    leaseId: res.lease_id ?? '',
    leaseDuration: res.lease_duration ?? 0,
    renewable: res.renewable ?? false,
    data: res.data ?? {},
    warnings: res.warnings ?? [],
  }
}
