import type { AccessGraph, GraphNode } from './graph'

export const COLUMN_X = { identity: 0, policy: 380, path: 780 } as const
export const ROW_HEIGHT = 72

export interface Position {
  x: number
  y: number
}

/**
 * Strict three-column layout (identities | policies | paths). Rows within each column are
 * ordered by repeated barycenter sweeps to keep edge crossings low.
 */
export function layoutColumns(graph: AccessGraph): Map<string, Position> {
  const cols: Record<GraphNode['type'], GraphNode[]> = { identity: [], policy: [], path: [] }
  for (const n of graph.nodes) cols[n.type].push(n)
  for (const list of Object.values(cols)) list.sort((a, b) => a.label.localeCompare(b.label))

  const neighbours = new Map<string, string[]>()
  const link = (a: string, b: string) => neighbours.set(a, [...(neighbours.get(a) ?? []), b])
  for (const e of graph.edges) {
    link(e.source, e.target)
    link(e.target, e.source)
  }

  const index = new Map<string, number>()
  const reindex = () => Object.values(cols).forEach((list) => list.forEach((n, i) => index.set(n.id, i)))
  reindex()

  const sweep = (list: GraphNode[]) => {
    const key = new Map(
      list.map((n, i) => {
        const ns = neighbours.get(n.id) ?? []
        return [n.id, ns.length ? ns.reduce((sum, id) => sum + (index.get(id) ?? 0), 0) / ns.length : i] as const
      }),
    )
    // stable: ties keep the alphabetical order from before
    list.sort((a, b) => key.get(a.id)! - key.get(b.id)!)
  }
  for (let i = 0; i < 4; i++) {
    sweep(cols.policy)
    reindex()
    sweep(cols.identity)
    sweep(cols.path)
    reindex()
  }

  const pos = new Map<string, Position>()
  for (const type of ['identity', 'policy', 'path'] as const) {
    cols[type].forEach((n, i) => pos.set(n.id, { x: COLUMN_X[type], y: i * ROW_HEIGHT }))
  }
  return pos
}
