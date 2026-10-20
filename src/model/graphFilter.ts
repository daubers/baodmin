import type { AccessGraph } from './graph'

export interface GraphFilter {
  /** Case-insensitive substring of an identity name. */
  identity: string
  /** Case-insensitive substring of a path. */
  path: string
  /** Policy names to hide (and the paths only they reach). */
  hidePolicies: string[]
}

export const noFilter: GraphFilter = { identity: '', path: '', hidePolicies: [] }

const matches = (label: string, q: string) => label.toLowerCase().includes(q.trim().toLowerCase())

function reach(graph: AccessGraph, seeds: Set<string>, dir: 'down' | 'up'): Set<string> {
  const seen = new Set(seeds)
  const queue = [...seeds]
  while (queue.length) {
    const id = queue.pop()!
    for (const e of graph.edges) {
      const [from, to] = dir === 'down' ? [e.source, e.target] : [e.target, e.source]
      if (from === id && !seen.has(to)) {
        seen.add(to)
        queue.push(to)
      }
    }
  }
  return seen
}

/**
 * Identity filter keeps matching identities and everything they reach; path filter keeps matching
 * paths and everything that reaches them. With both, only what satisfies both remains.
 */
export function filterGraph(graph: AccessGraph, f: GraphFilter): AccessGraph {
  let nodes = graph.nodes.filter((n) => !(n.type === 'policy' && f.hidePolicies.includes(n.label)))
  let edges = graph.edges.filter((e) => nodes.some((n) => n.id === e.source) && nodes.some((n) => n.id === e.target))
  let g: AccessGraph = { nodes, edges }

  // Hiding a policy can leave paths nothing reaches any more.
  const reached = new Set(g.edges.map((e) => e.target))
  g = { ...g, nodes: g.nodes.filter((n) => n.type !== 'path' || reached.has(n.id)) }

  const sets: Set<string>[] = []
  if (f.identity.trim()) {
    const seeds = new Set(g.nodes.filter((n) => n.type === 'identity' && matches(n.label, f.identity)).map((n) => n.id))
    sets.push(reach(g, seeds, 'down'))
  }
  if (f.path.trim()) {
    const seeds = new Set(g.nodes.filter((n) => n.type === 'path' && matches(n.label, f.path)).map((n) => n.id))
    sets.push(reach(g, seeds, 'up'))
  }
  if (sets.length) {
    const keep = sets.reduce((a, b) => new Set([...a].filter((id) => b.has(id))))
    nodes = g.nodes.filter((n) => keep.has(n.id))
    edges = g.edges.filter((e) => keep.has(e.source) && keep.has(e.target))
    g = { nodes, edges }
  }
  return g
}
