import { describe, expect, test } from 'vitest'
import {
  kvGrantRules,
  managedPolicyName,
  parseManagedPolicy,
  removeGrant,
  renderManagedPolicy,
  upsertGrant,
  validateGrantPath,
} from './managed'
import { parsePolicy } from './policy'

describe('managedPolicyName', () => {
  test.each([
    ['user', 'alice', 'envbao-user-alice'],
    ['group', 'Dev Team', 'envbao-group-dev-team'],
    ['entity', 'a@b.c', 'envbao-entity-a-b.c'],
  ] as const)('%s %s', (kind, name, expected) => expect(managedPolicyName(kind, name)).toBe(expected))
})

describe('validateGrantPath', () => {
  test.each(['', ' a', '/a', 'a"b', 'a\\b', 'a*/b'])('rejects %j', (p) => expect(validateGrantPath(p)).not.toBeNull())
  test.each(['secret/data/app', 'secret/data/app/*', 'secret/data/+/x', 'secret/data/app*'])('accepts %s', (p) =>
    expect(validateGrantPath(p)).toBeNull(),
  )
})

describe('render / parse round trip', () => {
  const grants = [
    { path: 'secret/data/b/*', capabilities: ['update', 'read'] as const },
    { path: 'secret/data/a', capabilities: ['read'] as const },
  ].map((g) => ({ path: g.path, capabilities: [...g.capabilities] }))

  test('rendered policy is valid HCL for the policy parser, sorted, with canonical capability order', () => {
    const hcl = renderManagedPolicy('user', 'alice', grants)
    expect(parsePolicy(hcl).warnings).toEqual([])
    expect(parsePolicy(hcl).rules.map((r) => r.path)).toEqual(['secret/data/a', 'secret/data/b/*'])
    expect(hcl).toContain('capabilities = ["read", "update"]')
  })

  test('parse recovers owner and grants and is editable', () => {
    const m = parseManagedPolicy(renderManagedPolicy('group', 'devs', grants))
    expect(m.owner).toBe('group:devs')
    expect(m.editable).toBe(true)
    expect(m.grants.map((g) => g.path)).toEqual(['secret/data/a', 'secret/data/b/*'])
  })

  test('an empty policy is still valid and editable', () => {
    expect(parseManagedPolicy(renderManagedPolicy('user', 'x', [])).editable).toBe(true)
  })

  test('hand-edited constraints make it non-editable', () => {
    const hcl = `# envbao-owner: user:alice\npath "a" {\n capabilities = ["read"]\n allowed_parameters = { "x" = [] }\n}`
    const m = parseManagedPolicy(hcl)
    expect(m.editable).toBe(false)
    expect(m.reasons.join()).toMatch(/allowed_parameters/)
  })

  test('policies without our marker are not editable', () => {
    const m = parseManagedPolicy('path "a" { capabilities = ["read"] }')
    expect(m.owner).toBeNull()
    expect(m.editable).toBe(false)
  })

  test('duplicate paths are not editable', () => {
    const hcl = `# envbao-owner: user:a\npath "a" { capabilities = ["read"] }\npath "a" { capabilities = ["list"] }`
    expect(parseManagedPolicy(hcl).editable).toBe(false)
  })

  test('unparseable policy is not editable', () => {
    expect(parseManagedPolicy('# envbao-owner: user:a\npath "a" {').editable).toBe(false)
  })
})

describe('upsertGrant / removeGrant', () => {
  const g = [{ path: 'a', capabilities: ['read' as const] }]
  test('replaces capabilities for an existing path', () => {
    expect(upsertGrant(g, { path: 'a', capabilities: ['update'] })).toEqual([{ path: 'a', capabilities: ['update'] }])
  })
  test('adds new paths', () => expect(upsertGrant(g, { path: 'b', capabilities: ['read'] })).toHaveLength(2))
  test('empty capabilities remove the path', () => expect(upsertGrant(g, { path: 'a', capabilities: [] })).toEqual([]))
  test('removeGrant', () => expect(removeGrant(g, 'a')).toEqual([]))
})

describe('kvGrantRules', () => {
  test('splits data operations and list into data/ and metadata/ rules', () => {
    expect(kvGrantRules('secret/', 'app/*', ['read', 'update', 'list'])).toEqual([
      { path: 'secret/data/app/*', capabilities: ['read', 'update'] },
      { path: 'secret/metadata/app/*', capabilities: ['list'] },
    ])
  })
  test('no list means an empty metadata rule (to be dropped by upsert)', () => {
    expect(kvGrantRules('secret', 'x', ['read'])[1]).toEqual({ path: 'secret/metadata/x', capabilities: [] })
  })
})
