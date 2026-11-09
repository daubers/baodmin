import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { BaoClient } from '../bao'
import { readConfig, runAction, writeConfig, deleteConfig } from './config'
import { generateCreds } from './creds'
import { revokeLease } from './leases'
import { listMounts } from '../secrets'
import { ENGINES } from './registry'
import { deleteRole, draftFromRole, emptyDraft, listRoles, payloadFromDraft, readRole, writeRole } from './roles'

const client = new BaoClient(process.env.BAO_ADDR ?? 'http://127.0.0.1:8200', process.env.BAO_TOKEN ?? 'root')
const sfx = Math.random().toString(36).slice(2, 8)
const mount = `it-ssh-${sfx}/`
const kind = ENGINES.ssh.roleKinds[0]
const awsMount = `it-aws-${sfx}/`
// Not every OpenBao build bundles the AWS engine (some ship it as an external plugin).
let awsAvailable = false
// A throwaway public key made only for this test; there is no matching private key anywhere.
const PUBLIC_KEY = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIDI/MhHH9Rd3dBZwAa4gQOkxfuw0ogMWlO2G4rlINbfv it'

beforeAll(async () => {
  await client.request('POST', `sys/mounts/${mount.slice(0, -1)}`, { type: 'ssh' })
  awsAvailable = await client
    .request('POST', `sys/mounts/${awsMount.slice(0, -1)}`, { type: 'aws' })
    .then(() => true)
    .catch(() => false)
})

afterAll(async () => {
  await client.request('DELETE', `sys/mounts/${mount.slice(0, -1)}`).catch(() => {})
  await client.request('DELETE', `sys/mounts/${awsMount.slice(0, -1)}`).catch(() => {})
})

describe('dynamic engine roles (ssh)', () => {
  test('the new mount is listed with its type', async () => {
    const m = (await listMounts(client)).find((x) => x.path === mount)
    expect(m?.type).toBe('ssh')
  })

  test('creates, lists, edits and deletes a role through the form model', async () => {
    expect(await listRoles(client, mount, kind)).toEqual([])

    const draft = emptyDraft(kind)
    draft.values.key_type = 'ca'
    draft.values.allowed_users = 'alice,bob'
    draft.values.ttl = '30m'
    draft.values.allow_user_certificates = true
    await writeRole(client, mount, kind, 'ops', payloadFromDraft(kind, draft))
    expect(await listRoles(client, mount, kind)).toEqual(['ops'])

    const read = draftFromRole(kind, 'ops', await readRole(client, mount, kind, 'ops'))
    expect(read.values).toMatchObject({ key_type: 'ca', allowed_users: 'alice,bob', ttl: '1800s', allow_user_certificates: true })

    // an edit writes the whole role back, so values it did not touch must survive
    read.values.max_ttl = '2h'
    await writeRole(client, mount, kind, 'ops', payloadFromDraft(kind, read))
    const again = draftFromRole(kind, 'ops', await readRole(client, mount, kind, 'ops'))
    expect(again.values).toMatchObject({ allowed_users: 'alice,bob', ttl: '1800s', max_ttl: '7200s' })

    await deleteRole(client, mount, kind, 'ops')
    expect(await listRoles(client, mount, kind)).toEqual([])
  })
})

describe('dynamic engine config and credentials', () => {
  const ca = ENGINES.ssh.configs[0]

  test('an unconfigured CA reads as null, then generate, sign and delete', async () => {
    expect(await readConfig(client, mount, ca)).toBeNull()

    await runAction(client, mount, ca.actions![0])
    const cfg = await readConfig(client, mount, ca)
    expect(cfg?.public_key).toMatch(/^ssh-rsa /)

    const role = emptyDraft(kind)
    role.values.allow_user_certificates = true
    role.values.allowed_users = '*'
    role.values.default_user = 'alice'
    role.values.ttl = '10m'
    await writeRole(client, mount, kind, 'signer', payloadFromDraft(kind, role))

    const sign = kind.creds[0]
    const out = await generateCreds(client, mount, sign, 'signer', { public_key: PUBLIC_KEY })
    expect(String(out.data.signed_key)).toMatch(/^ssh-ed25519-cert-v01@openssh.com /)

    await deleteConfig(client, mount, ca)
    expect(await readConfig(client, mount, ca)).toBeNull()
  })

  test('OTP credentials come with a lease that can be revoked', async () => {
    const role = emptyDraft(kind)
    role.values.key_type = 'otp'
    role.values.default_user = 'alice'
    role.values.cidr_list = '10.0.0.0/8'
    await writeRole(client, mount, kind, 'otp', payloadFromDraft(kind, role))

    const out = await generateCreds(client, mount, kind.creds[1], 'otp', { ip: '10.1.2.3' })
    expect(out.leaseId).toContain('/creds/otp/')
    expect(out.data.key).toBeTruthy()
    await revokeLease(client, out.leaseId)
  })

  test('single-endpoint config round-trips (aws lease)', async (ctx) => {
    if (!awsAvailable) ctx.skip()
    const lease = ENGINES.aws.configs[1]
    await writeConfig(client, awsMount, lease, { lease: '30m', lease_max: '2h' })
    expect(await readConfig(client, awsMount, lease)).toMatchObject({ lease: '30m0s', lease_max: '2h0m0s' })
  })
})
