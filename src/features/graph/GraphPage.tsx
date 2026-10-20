import {
  Background,
  Controls,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type Node,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import type { BaoClient } from '../../api/bao'
import { buildAccessGraph, type AccessGraph } from '../../model/graph'
import { filterGraph } from '../../model/graphFilter'
import { layoutColumns } from '../../model/layout'
import { RequireConnection } from '../shared/RequireConnection'
import { useAccessInputs } from '../shared/useAccessInputs'
import { Details, type Selection } from './Details'
import { GrantEdge, type GrantEdgeData } from './GraphEdge'
import { GraphNodeCard } from './GraphNode'

// Defined once, outside the component, so React Flow doesn't re-register node types on every render.
const nodeTypes = { gnode: GraphNodeCard }
const edgeTypes = { grant: GrantEdge }

// A grant with everything is easier to read as one word than as seven.
const FULL = ['create', 'read', 'update', 'delete', 'list', 'sudo']
function capabilityLabel(caps: string[] | undefined): string | undefined {
  if (!caps?.length) return undefined
  return FULL.every((c) => caps.includes(c)) ? 'full access' : caps.join(', ')
}

function toFlow(graph: AccessGraph, selected: Selection | null, onEdgeSelect: (id: string) => void): { nodes: Node[]; edges: Edge[] } {
  const pos = layoutColumns(graph)
  const nodes: Node[] = graph.nodes.map((n) => ({
    id: n.id,
    position: pos.get(n.id)!,
    type: 'gnode',
    data: { label: n.label, kind: n.type === 'identity' ? n.kind : undefined },
    className: [
      'gnode',
      `gnode-${n.type}`,
      n.type === 'policy' && n.missing ? 'gnode-missing' : '',
      n.type === 'policy' && n.managed ? 'gnode-managed' : '',
      selected?.kind === 'node' && selected.id === n.id ? 'gnode-selected' : '',
    ].join(' '),
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
  }))
  // Edges into the same node get their labels stacked a little apart so they stay legible.
  const intoTarget = new Map<string, string[]>()
  for (const e of graph.edges) if (e.capabilities) intoTarget.set(e.target, [...(intoTarget.get(e.target) ?? []), e.id])
  const edges: Edge[] = graph.edges.map((e) => {
    const base = {
      id: e.id,
      source: e.source,
      target: e.target,
      markerEnd: { type: MarkerType.ArrowClosed },
      selected: selected?.kind === 'edge' && selected.id === e.id,
    }
    const label = capabilityLabel(e.capabilities)
    if (!label) return base
    const siblings = intoTarget.get(e.target) ?? []
    const data: GrantEdgeData = {
      label,
      offset: (siblings.indexOf(e.id) - (siblings.length - 1) / 2) * 24,
      onSelect: () => onEdgeSelect(e.id),
    }
    return { ...base, type: 'grant', data: data as unknown as Record<string, unknown> }
  })
  return { nodes, edges }
}

function GraphView({ client }: { client: BaoClient }) {
  const qc = useQueryClient()
  const inputs = useAccessInputs(client)
  const [identity, setIdentity] = useState('')
  const [path, setPath] = useState('')
  const [hideDefault, setHideDefault] = useState(true)
  const [selected, setSelected] = useState<Selection | null>(null)

  const full = useMemo(
    () => (inputs.data ? buildAccessGraph(inputs.data.identities, inputs.data.policies) : null),
    [inputs.data],
  )
  const shown = useMemo(
    () => (full ? filterGraph(full, { identity, path, hidePolicies: hideDefault ? ['default'] : [] }) : null),
    [full, identity, path, hideDefault],
  )
  const flow = useMemo(
    () => (shown ? toFlow(shown, selected, (id) => setSelected({ kind: 'edge', id })) : null),
    [shown, selected],
  )

  if (inputs.isPending) return <p>Loading…</p>
  if (inputs.error) return <p role="alert">{inputs.error.message}</p>
  if (!full || !shown || !flow) return null

  return (
    <>
      <div className="graph-bar">
        <div className="graph-toolbar">
          <label>
            Identity
            <input value={identity} onChange={(e) => setIdentity(e.target.value)} placeholder="Filter identities" />
          </label>
          <label>
            Path
            <input value={path} onChange={(e) => setPath(e.target.value)} placeholder="Filter paths" />
          </label>
          <label className="check">
            <input type="checkbox" checked={hideDefault} onChange={(e) => setHideDefault(e.target.checked)} /> Hide the default policy
          </label>
          <button type="button" onClick={() => qc.invalidateQueries({ queryKey: ['access-inputs'] })} disabled={inputs.isFetching}>
            {inputs.isFetching ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
        <ul className="graph-legend" aria-label="Key">
          <li>
            <span className="swatch swatch-identity" /> Identity
          </li>
          <li>
            <span className="swatch swatch-policy" /> Policy
          </li>
          <li>
            <span className="swatch swatch-path" /> Path
          </li>
          <li>
            <strong>Bold</strong> policy: managed by EnvBao
          </li>
          <li>Dashed: policy is attached but missing</li>
          <li className="grow">Identities include policies inherited through entities and groups.</li>
        </ul>
      </div>
      {inputs.data.notes.map((n) => (
        <p key={n} role="alert">
          Incomplete: could not read {n}
        </p>
      ))}
      {shown.nodes.length === 0 ? (
        <p>Nothing matches.</p>
      ) : (
        <div className="graph-layout">
          <div className="graph-canvas" data-testid="graph-canvas">
            <ReactFlow
              nodes={flow.nodes}
              edges={flow.edges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              fitView
              nodesDraggable={false}
              nodesConnectable={false}
              elementsSelectable
              colorMode="system"
              onNodeClick={(_, n) => setSelected({ kind: 'node', id: n.id })}
              onEdgeClick={(_, e) => setSelected({ kind: 'edge', id: e.id })}
              onPaneClick={() => setSelected(null)}
            >
              <Background />
              <Controls showInteractive={false} />
            </ReactFlow>
          </div>
          <Details client={client} full={full} policies={inputs.data.policies} selection={selected} onRevoked={() => setSelected(null)} />
        </div>
      )}
    </>
  )
}

export function GraphPage() {
  return (
    <section>
      <h1>Access Graph</h1>
      <RequireConnection>{(client) => <GraphView client={client} />}</RequireConnection>
    </section>
  )
}
