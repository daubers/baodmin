import { afterAll, describe, expect, test } from 'vitest'
import { BaoClient } from './bao'
import { generateCreds } from './engines/creds'
import { lookupLease } from './engines/leases'
import { MOUNT_TYPES } from './engines/registry'
import { emptyDraft, payloadFromDraft, writeRole } from './engines/roles'
import { createMount, deleteMount, mountImpact, PartialMountError, readKvConfig, tuneMount } from './mounts'
import { listMounts } from './secrets'
import { ENGINES } from './engines/registry'

// Mounts and unmounts real engines, so run against a throwaway server (see README).
const client = new BaoClient(process.env.BAO_ADDR ?? 'http://127.0.0.1:8200', process.env.BAO_TOKEN ?? 'root')
const sfx = Math.random().toString(36).slice(2, 8)
const kv = MOUNT_TYPES.find((t) => t.type === 'kv')!
const ssh = MOUNT_TYPES.find((t) => t.type === 'ssh')!
const made: string[] = []
const find = async (path: string) => (await listMounts(client)).find((m) => m.path === path)

afterAll(async () => {
  for (const p of made) await deleteMount(client, p).catch(() => {})
})

describe('mount management', () => {
  test('creates a KV v2 store with settings, and reads them back', async () => {
    const path = `it-kv-${sfx}`
    made.push(path)
    await createMount(client, path, kv, { description: 'scratch store', max_versions: '4', cas_required: true, delete_version_after: '48h' })

    const m = await find(`${path}/`)
    expect(m).toMatchObject({ type: 'kv', version: '2', description: 'scratch store' })
    expect(await readKvConfig(client, path)).toMatchObject({ max_versions: 4, cas_required: true, delete_version_after: '48h0m0s' })
  })

  test('tunes a mount: description, TTLs and KV settings', async () => {
    const path = `it-kv-${sfx}`
    await tuneMount(client, path, kv, { description: 'renamed', max_versions: '9', cas_required: false })
    expect(await find(`${path}/`)).toMatchObject({ description: 'renamed' })
    expect(await readKvConfig(client, path)).toMatchObject({ max_versions: 9, cas_required: false })
  })

  test('lease TTLs are stored as set, and a blank TTL resets to the system default (0)', async () => {
    const path = `it-ssh-${sfx}`
    made.push(path)
    await createMount(client, path, ssh, { description: 'hosts', default_lease_ttl: '1h', max_lease_ttl: '8h' })
    expect(await find(`${path}/`)).toMatchObject({ type: 'ssh', description: 'hosts', defaultLeaseTtl: 3600, maxLeaseTtl: 28800 })

    // saving the form back unchanged must not pin anything else
    await tuneMount(client, path, ssh, { description: 'hosts', default_lease_ttl: '3600s', max_lease_ttl: '28800s' })
    expect(await find(`${path}/`)).toMatchObject({ defaultLeaseTtl: 3600, maxLeaseTtl: 28800 })

    await tuneMount(client, path, ssh, { description: 'hosts' })
    expect(await find(`${path}/`)).toMatchObject({ defaultLeaseTtl: 0, maxLeaseTtl: 0 })
  })

  test('refuses a path that is already mounted, and creates nothing else', async () => {
    await expect(createMount(client, `it-ssh-${sfx}`, ssh, {})).rejects.toThrow(/already in use|existing mount/i)
  })

  test('KV settings that fail after the mount exists are reported as a partial create', async () => {
    // an unparseable duration is rejected by the KV engine itself, after sys/mounts has succeeded
    const path = `it-partial-${sfx}`
    made.push(path)
    const err = await createMount(client, path, kv, { delete_version_after: 'banana' }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PartialMountError)
    expect(await find(`${path}/`)).toBeDefined()
  })

  test('impact counts what is in a mount without reading values', async () => {
    const path = `it-kv-${sfx}`
    await client.request('POST', `${path}/data/a/b`, { data: { k: 'v' } })
    await client.request('POST', `${path}/data/top`, { data: { k: 'v' } })
    expect(await mountImpact(client, `${path}/`, 'kv')).toEqual({ kind: 'kv', topLevelEntries: 2, unknown: [] })
  })

  test('deleting a mount removes it and revokes the leases it issued', async () => {
    const path = `it-lease-${sfx}`
    made.push(path)
    await createMount(client, path, ssh, {})
    const role = ENGINES.ssh.roleKinds[0]
    const draft = emptyDraft(role)
    draft.values.key_type = 'otp'
    draft.values.default_user = 'alice'
    draft.values.cidr_list = '10.0.0.0/8'
    await writeRole(client, `${path}/`, role, 'otp', payloadFromDraft(role, draft))
    const creds = await generateCreds(client, `${path}/`, role.creds[1], 'otp', { ip: '10.1.1.1' })
    expect(await mountImpact(client, `${path}/`, 'ssh')).toEqual({ kind: 'dynamic', roles: 1, hasLeases: true, unknown: [] })
    expect((await lookupLease(client, creds.leaseId)).id).toBe(creds.leaseId)

    await deleteMount(client, path)
    expect(await find(`${path}/`)).toBeUndefined()
    await expect(lookupLease(client, creds.leaseId)).rejects.toThrow()
  })

  test('deleting removes the KV store and its data', async () => {
    const path = `it-kv-${sfx}`
    await deleteMount(client, path)
    expect(await find(`${path}/`)).toBeUndefined()
  })
})
