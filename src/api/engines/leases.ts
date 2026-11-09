import type { BaoClient } from '../bao'

/** Revokes one lease, which also deletes the credentials it issued (database user, AWS key, ...). */
export async function revokeLease(c: BaoClient, leaseId: string): Promise<void> {
  await c.request('PUT', 'sys/leases/revoke', { lease_id: leaseId })
}
