import { expect, test, vi } from 'vitest'
import { BaoClient } from './bao'
import { MOUNT_TYPES, mountTypeFor } from './engines/registry'
import * as leases from './engines/leases'
import * as roles from './engines/roles'
import { createMount, deleteMount, mountImpact, PartialMountError, readKvConfig, tuneMount } from './mounts'
import * as secrets from './secrets'

const kv = MOUNT_TYPES.find((t) => t.type === 'kv')!
const ssh = MOUNT_TYPES.find((t) => t.type === 'ssh')!
const client = () => new BaoClient('http://b', 't')

test('knows which engines it can mount', () => {
  expect(MOUNT_TYPES.map((t) => t.type)).toEqual(['kv', 'database', 'aws', 'ssh'])
  expect(mountTypeFor({ type: 'ssh' })).toBe(ssh)
  expect(mountTypeFor({ type: 'pki' })).toBeNull()
})

test('creates a dynamic mount with its lease TTLs, leaving them out when blank', async () => {
  const c = client()
  const req = vi.spyOn(c, 'request').mockResolvedValue(undefined)
  await createMount(c, 'my-ssh', ssh, { description: 'hosts', default_lease_ttl: '1h', max_lease_ttl: '8h' })
  expect(req).toHaveBeenCalledWith('POST', 'sys/mounts/my-ssh', {
    type: 'ssh',
    description: 'hosts',
    config: { default_lease_ttl: '1h', max_lease_ttl: '8h' },
  })
  await createMount(c, 'plain/', ssh, {})
  expect(req).toHaveBeenLastCalledWith('POST', 'sys/mounts/plain', { type: 'ssh', description: '' })
})

test('creating KV v2 mounts version 2, then saves the KV settings on the mount', async () => {
  const c = client()
  const req = vi.spyOn(c, 'request').mockResolvedValue(undefined)
  await createMount(c, 'team/store', kv, { description: 'd', max_versions: '5', cas_required: true, delete_version_after: '720h' })
  expect(req).toHaveBeenNthCalledWith(1, 'POST', 'sys/mounts/team/store', { type: 'kv', description: 'd', options: { version: '2' } })
  expect(req).toHaveBeenNthCalledWith(2, 'POST', 'team/store/config', { max_versions: 5, cas_required: true, delete_version_after: '720h' })
})

test('if saving KV settings fails the error says the mount exists', async () => {
  const c = client()
  vi.spyOn(c, 'request').mockImplementation(async (_m, path) => {
    if (path.endsWith('/config')) throw new Error('permission denied')
  })
  const err = await createMount(c, 'store', kv, { cas_required: true }).catch((e: unknown) => e)
  expect(err).toBeInstanceOf(PartialMountError)
  expect((err as Error).message).toBe('store/ was mounted, but saving its KV settings failed: permission denied')
})

test('a failed mount does not try the KV settings', async () => {
  const c = client()
  const req = vi.spyOn(c, 'request').mockRejectedValue(new Error('path is already in use'))
  await expect(createMount(c, 'store', kv, { cas_required: true })).rejects.toThrow('already in use')
  expect(req).toHaveBeenCalledTimes(1)
})

test('tuning sends 0 for a blank TTL so it resets to the system default', async () => {
  const c = client()
  const req = vi.spyOn(c, 'request').mockResolvedValue(undefined)
  await tuneMount(c, 'database/', MOUNT_TYPES[1], { description: 'x', default_lease_ttl: '2h' })
  expect(req).toHaveBeenCalledWith('POST', 'sys/mounts/database/tune', { description: 'x', default_lease_ttl: '2h', max_lease_ttl: '0' })
})

test('tuning KV updates the description and the KV settings, with no TTLs', async () => {
  const c = client()
  const req = vi.spyOn(c, 'request').mockResolvedValue(undefined)
  await tuneMount(c, 'secret/', kv, { description: 'kv', max_versions: '10', cas_required: false })
  expect(req).toHaveBeenNthCalledWith(1, 'POST', 'sys/mounts/secret/tune', { description: 'kv' })
  expect(req).toHaveBeenNthCalledWith(2, 'POST', 'secret/config', { max_versions: 10, cas_required: false })
})

test('delete and KV config read use the mount path', async () => {
  const c = client()
  const req = vi.spyOn(c, 'request').mockResolvedValue({ data: { max_versions: 3 } })
  await deleteMount(c, 'team/store/')
  expect(req).toHaveBeenCalledWith('DELETE', 'sys/mounts/team/store')
  expect(await readKvConfig(c, 'team/store')).toEqual({ max_versions: 3 })
  expect(req).toHaveBeenLastCalledWith('GET', 'team/store/config')
})

test('impact of deleting a KV mount counts top-level entries', async () => {
  vi.spyOn(secrets, 'listSecrets').mockResolvedValue([
    { name: 'a/', path: 'a/', isFolder: true },
    { name: 'b', path: 'b', isFolder: false },
  ])
  expect(await mountImpact(client(), 'secret/', 'kv')).toEqual({ kind: 'kv', topLevelEntries: 2, unknown: [] })
})

test('impact of deleting a dynamic mount counts roles and notes leases', async () => {
  vi.spyOn(roles, 'listRoles').mockImplementation(async (_c, _m, kind) => (kind.id === 'roles' ? ['ro', 'rw'] : ['svc']))
  vi.spyOn(leases, 'listLeases').mockResolvedValue([{ name: 'creds/', path: 'database/creds/', isFolder: true }])
  expect(await mountImpact(client(), 'database/', 'database')).toEqual({ kind: 'dynamic', roles: 3, hasLeases: true, unknown: [] })
})

test('impact reports what it was not allowed to count', async () => {
  vi.spyOn(roles, 'listRoles').mockResolvedValue(['ro'])
  vi.spyOn(leases, 'listLeases').mockRejectedValue(new Error('permission denied'))
  expect(await mountImpact(client(), 'ssh/', 'ssh')).toEqual({ kind: 'dynamic', roles: 1, hasLeases: undefined, unknown: ['leases'] })
  vi.spyOn(secrets, 'listSecrets').mockRejectedValue(new Error('permission denied'))
  expect(await mountImpact(client(), 'secret/', 'kv')).toEqual({ kind: 'kv', topLevelEntries: undefined, unknown: ['secrets'] })
})
