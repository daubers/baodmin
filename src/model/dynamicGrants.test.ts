import { expect, test } from 'vitest'
import { ENGINES } from '../api/engines/registry'
import { accessForPath } from './graph'
import { dynamicGrantRules, parseManagedPolicy, renderManagedPolicy } from './managed'
import { pathMatches } from './policy'

const dbRoles = ENGINES.database.roleKinds[0]
const dbStatic = ENGINES.database.roleKinds[1]
const aws = ENGINES.aws.roleKinds[0]
const ssh = ENGINES.ssh.roleKinds[0]

test('database: generate is read on creds, and is removed when not granted', () => {
  expect(dynamicGrantRules(dbRoles, 'database/', 'ro', ['generate'])).toEqual([
    { path: 'database/creds/ro', capabilities: ['read'] },
    { path: 'database/roles/ro', capabilities: [] },
  ])
  expect(dynamicGrantRules(dbStatic, 'database/', 'svc', ['generate'])[0]).toEqual({ path: 'database/static-creds/svc', capabilities: ['read'] })
})

test('manage grants role CRUD plus listing, and generate is revoked when unticked', () => {
  expect(dynamicGrantRules(dbRoles, 'database', 'ro', ['manage'])).toEqual([
    { path: 'database/creds/ro', capabilities: [] },
    { path: 'database/roles/ro', capabilities: ['create', 'read', 'update', 'delete'] },
    { path: 'database/roles', capabilities: ['list'] },
  ])
})

test('aws and ssh use the capabilities their requests need', () => {
  expect(dynamicGrantRules(aws, 'aws/', 'ci', ['generate'])[0]).toEqual({ path: 'aws/creds/ci', capabilities: ['read', 'update'] })
  const s = dynamicGrantRules(ssh, 'ssh/', 'ops', ['generate'])
  expect(s.slice(0, 2)).toEqual([
    { path: 'ssh/sign/ops', capabilities: ['update'] },
    { path: 'ssh/creds/ops', capabilities: ['update'] },
  ])
})

test('"*" grants every role of the kind', () => {
  expect(dynamicGrantRules(dbRoles, 'database/', '*', ['generate', 'manage'])).toEqual([
    { path: 'database/creds/*', capabilities: ['read'] },
    { path: 'database/roles/*', capabilities: ['create', 'read', 'update', 'delete'] },
    { path: 'database/roles', capabilities: ['list'] },
  ])
})

test('rules survive a managed-policy round trip and resolve in the access model', () => {
  const grants = dynamicGrantRules(dbRoles, 'database/', 'ro', ['generate']).filter((g) => g.capabilities.length)
  const hcl = renderManagedPolicy('user', 'alice', grants)
  const parsed = parseManagedPolicy(hcl)
  expect(parsed.editable).toBe(true)
  expect(parsed.grants).toEqual(grants)

  const entries = accessForPath(
    [{ kind: 'user', name: 'alice', policies: ['envbao-user-alice'] }],
    [{ name: 'envbao-user-alice', hcl }],
    'database/creds/ro',
    pathMatches,
  )
  expect(entries).toHaveLength(1)
  expect(entries[0].capabilities).toEqual(['read'])
  expect(accessForPath([{ kind: 'user', name: 'alice', policies: ['envbao-user-alice'] }], [{ name: 'envbao-user-alice', hcl }], 'database/creds/other', pathMatches)).toEqual([])
})
