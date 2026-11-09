import { expect, test, vi } from 'vitest'
import { BaoClient } from '../bao'
import { listLeases, lookupLease, renewLease, revokeLease, revokePrefix } from './leases'

const c = () => new BaoClient('http://b', 't')

test('lists folders before lease ids, joining them onto the prefix', async () => {
  const client = c()
  const list = vi.spyOn(client, 'list').mockResolvedValue(['zz9', 'ro/', 'aa1'])
  expect(await listLeases(client, 'database/creds/')).toEqual([
    { name: 'ro/', path: 'database/creds/ro/', isFolder: true },
    { name: 'aa1', path: 'database/creds/aa1', isFolder: false },
    { name: 'zz9', path: 'database/creds/zz9', isFolder: false },
  ])
  expect(list).toHaveBeenCalledWith('sys/leases/lookup/database/creds/')
})

test('looks up a lease and maps its fields', async () => {
  const client = c()
  const req = vi.spyOn(client, 'request').mockResolvedValue({
    data: { id: 'database/creds/ro/abc', issue_time: '2026-01-01T00:00:00Z', expire_time: null, last_renewal: null, renewable: true, ttl: 120 },
  })
  expect(await lookupLease(client, 'database/creds/ro/abc')).toEqual({
    id: 'database/creds/ro/abc',
    issueTime: '2026-01-01T00:00:00Z',
    expireTime: null,
    lastRenewal: null,
    renewable: true,
    ttl: 120,
  })
  expect(req).toHaveBeenCalledWith('PUT', 'sys/leases/lookup', { lease_id: 'database/creds/ro/abc' })
})

test('renew sends an increment only when given and returns the granted duration', async () => {
  const client = c()
  const req = vi.spyOn(client, 'request').mockResolvedValue({ lease_duration: 300 })
  expect(await renewLease(client, 'a/b')).toBe(300)
  expect(req).toHaveBeenLastCalledWith('PUT', 'sys/leases/renew', { lease_id: 'a/b' })
  await renewLease(client, 'a/b', '1h')
  expect(req).toHaveBeenLastCalledWith('PUT', 'sys/leases/renew', { lease_id: 'a/b', increment: '1h' })
})

test('revoke and revoke-prefix', async () => {
  const client = c()
  const req = vi.spyOn(client, 'request').mockResolvedValue(undefined)
  await revokeLease(client, 'database/creds/ro/xyz')
  expect(req).toHaveBeenLastCalledWith('PUT', 'sys/leases/revoke', { lease_id: 'database/creds/ro/xyz' })
  await revokePrefix(client, 'database/creds/ro/')
  expect(req).toHaveBeenLastCalledWith('PUT', 'sys/leases/revoke-prefix/database/creds/ro', {})
})
