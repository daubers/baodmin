import { describe, expect, test } from 'vitest'
import { buildAccessGraph, type Identity } from './graph'
import { filterGraph, noFilter } from './graphFilter'
import { COLUMN_X, layoutColumns } from './layout'

const identities: Identity[] = [
  { kind: 'user', name: 'alice', policies: ['default', 'app'] },
  { kind: 'user', name: 'bob', policies: ['default', 'db'] },
  { kind: 'group', name: 'ops', policies: ['db'] },
]
const policies = [
  { name: 'default', hcl: 'path "auth/token/lookup-self" { capabilities = ["read"] }' },
  { name: 'app', hcl: 'path "secret/data/app/*" { capabilities = ["read"] }' },
  { name: 'db', hcl: 'path "secret/data/db" { capabilities = ["read", "update"] }\npath "secret/data/app/*" { capabilities = ["list"] }' },
  { name: 'orphan', hcl: 'path "secret/data/lonely" { capabilities = ["read"] }' },
]
const graph = buildAccessGraph(identities, policies)
const labels = (g: typeof graph, type: string) => g.nodes.filter((n) => n.type === type).map((n) => n.label).sort()

describe('layoutColumns', () => {
  const pos = layoutColumns(graph)

  test('places every node in its type column, including unattached policies', () => {
    for (const n of graph.nodes) expect(pos.get(n.id)!.x).toBe(COLUMN_X[n.type])
    expect(pos.get('policy:orphan')!.x).toBe(COLUMN_X.policy)
  })

  test('gives nodes in a column distinct rows', () => {
    const ys = graph.nodes.filter((n) => n.type === 'policy').map((n) => pos.get(n.id)!.y)
    expect(new Set(ys).size).toBe(ys.length)
  })

  test('handles an empty graph', () => expect(layoutColumns({ nodes: [], edges: [] }).size).toBe(0))
})

describe('filterGraph', () => {
  test('no filter returns everything', () => expect(filterGraph(graph, noFilter)).toEqual(graph))

  test('identity filter keeps what the identity reaches', () => {
    const g = filterGraph(graph, { ...noFilter, identity: 'ALI' })
    expect(labels(g, 'identity')).toEqual(['alice'])
    expect(labels(g, 'policy')).toEqual(['app', 'default'])
    expect(labels(g, 'path')).toEqual(['auth/token/lookup-self', 'secret/data/app/*'])
  })

  test('path filter keeps everything that reaches the path', () => {
    const g = filterGraph(graph, { ...noFilter, path: 'secret/data/db' })
    expect(labels(g, 'identity')).toEqual(['bob', 'ops'])
    expect(labels(g, 'policy')).toEqual(['db'])
    // the policy's other rule is not part of what we asked about only if unreachable; here it is the same policy
    expect(labels(g, 'path')).toContain('secret/data/db')
  })

  test('both filters narrow to the intersection', () => {
    const g = filterGraph(graph, { ...noFilter, identity: 'bob', path: 'app' })
    expect(labels(g, 'identity')).toEqual(['bob'])
    expect(labels(g, 'path')).toEqual(['secret/data/app/*'])
    expect(labels(g, 'policy')).toEqual(['db'])
  })

  test('no match yields an empty graph', () => {
    expect(filterGraph(graph, { ...noFilter, identity: 'nobody' }).nodes).toEqual([])
  })

  test('hiding a policy drops paths only it reached', () => {
    const g = filterGraph(graph, { ...noFilter, hidePolicies: ['default'] })
    expect(labels(g, 'policy')).not.toContain('default')
    expect(labels(g, 'path')).not.toContain('auth/token/lookup-self')
    expect(g.edges.every((e) => g.nodes.some((n) => n.id === e.source) && g.nodes.some((n) => n.id === e.target))).toBe(true)
  })

  test('hiding a policy keeps paths other policies still reach', () => {
    const g = filterGraph(graph, { ...noFilter, hidePolicies: ['app'] })
    expect(labels(g, 'path')).toContain('secret/data/app/*') // still reached by db
  })
})
