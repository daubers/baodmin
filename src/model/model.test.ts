import { describe, expect, test } from 'vitest'
import { accessForPath, buildAccessGraph, type Identity } from './graph'
import { parseHcl } from './hcl'
import { effectiveCapabilities, parsePolicy, pathMatches } from './policy'

describe('parseHcl', () => {
  test('parses comments, blocks and values', () => {
    const body = parseHcl(`
      # comment
      // another
      /* block
         comment */
      path "a/b" {
        capabilities = ["read", "list"]
        flag = true
        n = 3
      }
    `)
    expect(body.blocks).toHaveLength(1)
    expect(body.blocks[0].labels).toEqual(['a/b'])
    expect(body.blocks[0].body.attributes).toEqual({ capabilities: ['read', 'list'], flag: true, n: 3 })
  })

  test('reports line numbers for syntax errors', () => {
    expect(() => parseHcl('path "a" {\n capabilities = [\n')).toThrow(/line/)
  })

  test('handles nested objects and escapes', () => {
    const body = parseHcl('path "x" { allowed_parameters = { "k" = ["a\\"b"] } }')
    expect(body.blocks[0].body.attributes.allowed_parameters).toEqual({ k: ['a"b'] })
  })
})

describe('parsePolicy', () => {
  test('extracts path rules', () => {
    const p = parsePolicy(`
      path "secret/data/app/*" { capabilities = ["read", "list"] }
      path "secret/data/db" { capabilities = ["create", "update", "read"] }
    `)
    expect(p.warnings).toEqual([])
    expect(p.rules.map((r) => [r.path, r.capabilities])).toEqual([
      ['secret/data/app/*', ['read', 'list']],
      ['secret/data/db', ['create', 'update', 'read']],
    ])
  })

  test('returns a warning instead of throwing on bad syntax', () => {
    const p = parsePolicy('path "x" {')
    expect(p.rules).toEqual([])
    expect(p.warnings[0]).toMatch(/Could not parse/)
  })

  test('flags constraints, unknown capabilities, templating and unknown blocks', () => {
    const p = parsePolicy(`
      path "secret/data/{{identity.entity.name}}/*" { capabilities = ["read", "bogus"] }
      path "x" {
        capabilities = ["update"]
        allowed_parameters = { "foo" = [] }
      }
      other "y" {}
    `)
    expect(p.rules[0].warnings).toEqual(['Unknown capability "bogus"', 'Templated path is approximated'])
    expect(p.rules[1].warnings[0]).toMatch(/allowed_parameters/)
    expect(p.warnings).toEqual(['Ignored unsupported block "other"'])
  })

  test('dedupes capabilities', () => {
    expect(parsePolicy('path "a" { capabilities = ["read", "read"] }').rules[0].capabilities).toEqual(['read'])
  })
})

describe('pathMatches', () => {
  test.each([
    ['secret/data/a', 'secret/data/a', true],
    ['secret/data/a', 'secret/data/b', false],
    ['secret/data/*', 'secret/data/a', true],
    ['secret/data/*', 'secret/data/a/b/c', true],
    ['secret/data/*', 'secret/data', false],
    ['secret/data/app*', 'secret/data/application', true],
    ['secret/data/app*', 'secret/data/other', false],
    ['secret/+/a', 'secret/x/a', true],
    ['secret/+/a', 'secret/x/y/a', false],
    ['secret/+/*', 'secret/x/y/z', true],
    ['*', 'anything/at/all', true],
    ['secret/data/{{identity.entity.name}}/*', 'secret/data/alice/k', true],
  ])('%s vs %s -> %s', (rule, target, expected) => {
    expect(pathMatches(rule, target)).toBe(expected)
  })
})

describe('effectiveCapabilities', () => {
  test('unions matching rules and deny wins', () => {
    const rules = parsePolicy(`
      path "s/*" { capabilities = ["read", "list"] }
      path "s/a" { capabilities = ["update"] }
      path "s/secret" { capabilities = ["deny"] }
    `).rules
    expect(effectiveCapabilities(rules, 's/a').sort()).toEqual(['list', 'read', 'update'])
    expect(effectiveCapabilities(rules, 's/secret')).toEqual(['deny'])
    expect(effectiveCapabilities(rules, 'other')).toEqual([])
  })
})

describe('buildAccessGraph', () => {
  const alice: Identity = { kind: 'user', name: 'alice', policies: ['envbao-alice', 'default'] }
  const bob: Identity = { kind: 'token', name: 'ci', policies: ['envbao-alice', 'ghost'] }
  const policies = [
    { name: 'envbao-alice', hcl: 'path "secret/data/app/*" { capabilities = ["read"] }' },
    { name: 'default', hcl: 'path "auth/token/lookup-self" { capabilities = ["read"] }' },
    { name: 'legacy', hcl: 'path "secret/data/legacy" { capabilities = ["read"] }' },
  ]

  test('builds identity -> policy -> path nodes and edges', () => {
    const g = buildAccessGraph([alice], policies)
    expect(g.nodes.map((n) => n.id)).toEqual(
      expect.arrayContaining([
        'identity:user:alice',
        'policy:envbao-alice',
        'path:secret/data/app/*',
        'policy:default',
        'path:auth/token/lookup-self',
      ]),
    )
    expect(g.edges.find((e) => e.id === 'identity:user:alice->policy:envbao-alice')).toBeDefined()
    expect(g.edges.find((e) => e.id === 'policy:envbao-alice->path:secret/data/app/*')?.capabilities).toEqual(['read'])
  })

  test('shared policy yields a single node, with an edge per identity', () => {
    const g = buildAccessGraph([alice, bob], policies)
    expect(g.nodes.filter((n) => n.id === 'policy:envbao-alice')).toHaveLength(1)
    expect(g.edges.filter((e) => e.target === 'policy:envbao-alice')).toHaveLength(2)
  })

  test('marks managed vs unmanaged and missing policies', () => {
    const g = buildAccessGraph([alice, bob], policies)
    const get = (n: string) => g.nodes.find((x) => x.id === `policy:${n}`)
    expect(get('envbao-alice')).toMatchObject({ managed: true, missing: false })
    expect(get('legacy')).toMatchObject({ managed: false, missing: false })
    expect(get('ghost')).toMatchObject({ managed: false, missing: true })
  })

  test('includes policies not attached to any identity', () => {
    const g = buildAccessGraph([], policies)
    expect(g.nodes.some((n) => n.id === 'policy:legacy')).toBe(true)
    expect(g.edges.some((e) => e.source === 'policy:legacy')).toBe(true)
  })

  test('merges duplicate paths within one policy', () => {
    const g = buildAccessGraph(
      [],
      [{ name: 'p', hcl: 'path "a" { capabilities = ["read"] }\npath "a" { capabilities = ["list"] }' }],
    )
    expect(g.edges.find((e) => e.target === 'path:a')?.capabilities).toEqual(['read', 'list'])
  })

  test('surfaces rule warnings on the policy node', () => {
    const g = buildAccessGraph([], [{ name: 'p', hcl: 'path "a/{{x}}" { capabilities = ["read"] }' }])
    expect((g.nodes.find((n) => n.id === 'policy:p') as { warnings: string[] }).warnings[0]).toMatch(/Templated/)
  })

  test('root policy is unrestricted', () => {
    const g = buildAccessGraph([{ kind: 'token', name: 'r', policies: ['root'] }], [])
    expect(g.edges.find((e) => e.target === 'path:*')?.capabilities).toContain('sudo')
  })

  test('unparseable policy gives warnings and no paths', () => {
    const g = buildAccessGraph([], [{ name: 'bad', hcl: 'path {' }])
    expect(g.edges).toEqual([])
    expect((g.nodes[0] as { warnings: string[] }).warnings[0]).toMatch(/Could not parse/)
  })
})

describe('accessForPath', () => {
  const policies = [
    { name: 'rw', hcl: 'path "secret/data/app/*" { capabilities = ["read", "update"] }' },
    { name: 'ro', hcl: 'path "secret/data/app/db" { capabilities = ["read"] }' },
    { name: 'no', hcl: 'path "secret/data/app/db" { capabilities = ["deny"] }' },
  ]
  const ids: Identity[] = [
    { kind: 'user', name: 'a', policies: ['rw', 'ro'] },
    { kind: 'user', name: 'b', policies: ['rw', 'no'] },
    { kind: 'user', name: 'c', policies: ['ro'] },
  ]

  test('lists identities with access, honouring deny', () => {
    const res = accessForPath(ids, policies, 'secret/data/app/db', pathMatches)
    expect(res.map((r) => `${r.identity.name}:${r.policy}`)).toEqual(['a:rw', 'a:ro', 'c:ro'])
  })

  test('returns nothing for unrelated paths', () => {
    expect(accessForPath(ids, policies, 'secret/data/other', pathMatches)).toEqual([])
  })
})
