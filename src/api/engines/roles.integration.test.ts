import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { BaoClient } from '../bao'
import { listMounts } from '../secrets'
import { ENGINES } from './registry'
import { deleteRole, draftFromRole, emptyDraft, listRoles, payloadFromDraft, readRole, writeRole } from './roles'

const client = new BaoClient(process.env.BAO_ADDR ?? 'http://127.0.0.1:8200', process.env.BAO_TOKEN ?? 'root')
const sfx = Math.random().toString(36).slice(2, 8)
const mount = `it-ssh-${sfx}/`
const kind = ENGINES.ssh.roleKinds[0]

beforeAll(async () => {
  await client.request('POST', `sys/mounts/${mount.slice(0, -1)}`, { type: 'ssh' })
})

afterAll(async () => {
  await client.request('DELETE', `sys/mounts/${mount.slice(0, -1)}`).catch(() => {})
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
