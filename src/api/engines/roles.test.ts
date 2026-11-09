import { expect, test, vi } from 'vitest'
import { BaoClient } from '../bao'
import { ENGINES, engineFor, mountKind } from './registry'
import { deleteRole, draftFromRole, emptyDraft, listRoles, payloadFromDraft, readRole, writeRole } from './roles'

const dbRole = ENGINES.database.roleKinds[0]
const awsRole = ENGINES.aws.roleKinds[0]
const sshRole = ENGINES.ssh.roleKinds[0]

test('classifies mounts', () => {
  expect(mountKind({ path: 'secret/', type: 'kv', version: '2' })).toBe('kv')
  expect(mountKind({ path: 'old/', type: 'kv', version: '1' })).toBeNull()
  expect(mountKind({ path: 'cubbyhole/', type: 'cubbyhole' })).toBeNull()
  expect(mountKind({ path: 'database/', type: 'database' })).toBe('dynamic')
  expect(mountKind({ path: 'pki/', type: 'pki' })).toBe('dynamic')
})

test('unknown engines fall back to a raw JSON role editor', () => {
  const e = engineFor('pki')
  expect(e.label).toBe('pki')
  expect(e.roleKinds[0].fields).toEqual([])
})

test('database role round-trips through the form, keeping unknown fields', () => {
  const data = {
    db_name: 'pg',
    creation_statements: ['CREATE ROLE "{{name}}" LOGIN;', 'GRANT SELECT ON ALL TABLES IN SCHEMA public TO "{{name}}";'],
    default_ttl: 3600,
    max_ttl: 0,
    credential_type: 'password',
  }
  const draft = draftFromRole(dbRole, 'ro', data)
  expect(draft.values.default_ttl).toBe('3600s')
  expect(draft.values.max_ttl).toBe('')
  expect(draft.extras).toEqual({ credential_type: 'password' })

  draft.values.max_ttl = '24h'
  expect(payloadFromDraft(dbRole, draft)).toEqual({
    db_name: 'pg',
    creation_statements: data.creation_statements,
    revocation_statements: [],
    renew_statements: [],
    rollback_statements: [],
    default_ttl: '3600s',
    max_ttl: '24h',
    credential_type: 'password',
  })
})

test('statements split on blank lines, lists on commas or newlines', () => {
  const d = emptyDraft(dbRole)
  d.values.db_name = 'pg'
  d.values.creation_statements = 'CREATE ROLE a,\n  LOGIN;\n\nGRANT x;'
  expect(payloadFromDraft(dbRole, d).creation_statements).toEqual(['CREATE ROLE a,\n  LOGIN;', 'GRANT x;'])

  const a = emptyDraft(awsRole)
  a.values.policy_arns = 'arn:1, arn:2\narn:3'
  expect(payloadFromDraft(awsRole, a).policy_arns).toEqual(['arn:1', 'arn:2', 'arn:3'])
})

test('required fields are enforced', () => {
  expect(() => payloadFromDraft(dbRole, emptyDraft(dbRole))).toThrow('Database config name is required.')
  const d = emptyDraft(dbRole)
  d.values.db_name = 'pg'
  expect(() => payloadFromDraft(dbRole, d)).toThrow('Creation statements is required.')
})

test('select defaults to the first option and booleans are sent as booleans', () => {
  const d = emptyDraft(sshRole)
  expect(d.values.key_type).toBe('ca')
  d.values.allow_user_certificates = true
  const body = payloadFromDraft(sshRole, d)
  expect(body).toMatchObject({ key_type: 'ca', allow_user_certificates: true, allow_host_certificates: false })
  expect(body).not.toHaveProperty('ttl')
})

test('generic roles are raw JSON and must be objects', () => {
  const kind = engineFor('pki').roleKinds[0]
  const d = emptyDraft(kind)
  d.json = '{"allowed_domains":"example.com"}'
  expect(payloadFromDraft(kind, d)).toEqual({ allowed_domains: 'example.com' })
  d.json = '{nope'
  expect(() => payloadFromDraft(kind, d)).toThrow('not valid JSON')
  d.json = '[]'
  expect(() => payloadFromDraft(kind, d)).toThrow('must be a JSON object')
})

test('role API calls use the mount, kind path and an encoded name', async () => {
  const c = new BaoClient('http://b', 't')
  const req = vi.spyOn(c, 'request').mockResolvedValue({ data: { db_name: 'pg' } })
  vi.spyOn(c, 'list').mockResolvedValue(['b', 'a'])

  expect(await listRoles(c, 'database/', dbRole)).toEqual(['a', 'b'])
  expect(c.list).toHaveBeenCalledWith('database/roles')
  expect(await readRole(c, 'database/', dbRole, 'my role')).toEqual({ db_name: 'pg' })
  expect(req).toHaveBeenCalledWith('GET', 'database/roles/my%20role')
  await writeRole(c, 'database/', dbRole, 'ro', { db_name: 'pg' })
  expect(req).toHaveBeenCalledWith('POST', 'database/roles/ro', { db_name: 'pg' })
  await deleteRole(c, 'database/', ENGINES.database.roleKinds[1], 'svc')
  expect(req).toHaveBeenCalledWith('DELETE', 'database/static-roles/svc')
})
