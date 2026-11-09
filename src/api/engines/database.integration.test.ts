import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { pgTarget } from '../../test/postgres'
import { BaoClient } from '../bao'
import { deleteConfig, listConfigs, readConfig, runAction, writeConfig } from './config'
import { generateCreds } from './creds'
import { listLeases, lookupLease, revokeLease } from './leases'
import { ENGINES } from './registry'
import { deleteRole, draftFromRole, emptyDraft, listRoles, payloadFromDraft, readRole, writeRole } from './roles'

// Runs the UI's own form model against a real database engine and Postgres. Needs BAO_PG_URL (see src/test/postgres.ts).
const pg = pgTarget()
const client = new BaoClient(process.env.BAO_ADDR ?? 'http://127.0.0.1:8200', process.env.BAO_TOKEN ?? 'root')
const sfx = Math.random().toString(36).slice(2, 8)
const mount = `it-db-${sfx}/`
const conn = ENGINES.database.configs[0]
const kind = ENGINES.database.roleKinds[0]

describe.skipIf(!pg)('database engine against Postgres', () => {
  beforeAll(async () => {
    await client.request('POST', `sys/mounts/${mount.slice(0, -1)}`, { type: 'database' })
  })
  afterAll(async () => {
    await client.request('DELETE', `sys/mounts/${mount.slice(0, -1)}`).catch(() => {})
  })

  test('creates a connection through the form model; the password is never read back', async () => {
    const draft = emptyDraft(conn)
    draft.name = 'app'
    Object.assign(draft.values, pg!.values)
    await writeConfig(client, mount, conn, payloadFromDraft(conn, draft), 'app')

    expect(await listConfigs(client, mount, conn)).toEqual(['app'])
    const read = await readConfig(client, mount, conn, 'app')
    expect(read).toMatchObject({ plugin_name: 'postgresql-database-plugin', username: pg!.values.username })
    expect(String(read!.connection_url)).toContain('{{username}}')
    expect(JSON.stringify(read)).not.toContain(String(pg!.values.password))

    // editing with the password left blank must keep the stored one, or the next credential request would fail
    const edit = draftFromRole(conn, 'app', read!)
    expect(edit.values.password).toBe('')
    edit.values.allowed_roles = 'ro'
    await writeConfig(client, mount, conn, payloadFromDraft(conn, edit), 'app')
    expect((await readConfig(client, mount, conn, 'app'))!.allowed_roles).toEqual(['ro'])
    await runAction(client, mount, conn.actions![1], 'app') // reset
  })

  test('creates a role with multi-statement SQL, generates credentials and revokes the lease', async () => {
    const draft = emptyDraft(kind)
    draft.name = 'ro'
    draft.values.db_name = 'app'
    draft.values.creation_statements = pg!.creationStatements
    draft.values.default_ttl = '5m'
    await writeRole(client, mount, kind, 'ro', payloadFromDraft(kind, draft))
    expect(await listRoles(client, mount, kind)).toEqual(['ro'])

    const back = draftFromRole(kind, 'ro', await readRole(client, mount, kind, 'ro'))
    expect(back.values.default_ttl).toBe('300s')
    expect(payloadFromDraft(kind, back).creation_statements).toHaveLength(2)

    const creds = await generateCreds(client, mount, kind.creds[0], 'ro', {})
    expect(String(creds.data.username)).toMatch(/^v-/)
    expect(String(creds.data.password).length).toBeGreaterThan(8)
    expect(creds.leaseId).toContain(`${mount}creds/ro/`)
    expect((await lookupLease(client, creds.leaseId)).renewable).toBe(true)
    expect((await listLeases(client, `${mount}creds/ro/`)).map((e) => e.path)).toContain(creds.leaseId)

    await revokeLease(client, creds.leaseId)
    expect(await listLeases(client, `${mount}creds/ro/`)).toEqual([])
  })

  test('a role whose SQL is wrong reports the database error', async () => {
    const bad = emptyDraft(kind)
    bad.values.db_name = 'app'
    bad.values.creation_statements = 'CREATE NONSENSE "{{name}}";'
    await writeRole(client, mount, kind, 'bad', payloadFromDraft(kind, bad))
    await expect(generateCreds(client, mount, kind.creds[0], 'bad', {})).rejects.toThrow()
    await deleteRole(client, mount, kind, 'bad')
    await deleteRole(client, mount, kind, 'ro')
    await deleteConfig(client, mount, conn, 'app')
    expect(await listRoles(client, mount, kind)).toEqual([])
  })
})
