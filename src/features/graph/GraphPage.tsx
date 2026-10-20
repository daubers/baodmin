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

function toFlow(graph: AccessGraph, selected: Selection | null): { nodes: Node[]; edges: Edge[] } {
  const pos = layoutColumns(graph)
  const nodes: Node[] = graph.nodes.map((n) => ({
    id: n.id,
    position: pos.get(n.id)!,
    data: { label: n.label },
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
  const edges: Edge[] = graph.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    label: e.capabilities?.join(', '),
    markerEnd: { type: MarkerType.ArrowClosed },
    selected: selected?.kind === 'edge' && selected.id === e.id,
  }))
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
  const flow = useMemo(() => (shown ? toFlow(shown, selected) : null), [shown, selected])

  if (inputs.isPending) return <p>Loading…</p>
  if (inputs.error) return <p role="alert">{inputs.error.message}</p>
  if (!full || !shown || !flow) return null

  return (
    <>
      <div className="graph-toolbar">
        <label>
          Identity
          <input value={identity} onChange={(e) => setIdentity(e.target.value)} placeholder="filter identities" />
        </label>
        <label>
          Path
          <input value={path} onChange={(e) => setPath(e.target.value)} placeholder="filter paths" />
        </label>
        <label className="check">
          <input type="checkbox" checked={hideDefault} onChange={(e) => setHideDefault(e.target.checked)} /> Hide the default policy
        </label>
        <button type="button" onClick={() => qc.invalidateQueries({ queryKey: ['access-inputs'] })} disabled={inputs.isFetching}>
          {inputs.isFetching ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>
      {inputs.data.notes.map((n) => (
        <p key={n} role="alert">
          Incomplete: could not read {n}
        </p>
      ))}
      <div className="graph-legend" aria-hidden="true">
        <span>Identities → Policies → Paths</span>
        <span>Identity→policy edges include policies inherited via entities and groups.</span>
      </div>
      {shown.nodes.length === 0 ? (
        <p>Nothing matches.</p>
      ) : (
        <div className="graph-layout">
          <div className="graph-canvas" data-testid="graph-canvas">
            <ReactFlow
              nodes={flow.nodes}
              edges={flow.edges}
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
