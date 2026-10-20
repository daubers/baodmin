import { Handle, Position, type NodeProps } from '@xyflow/react'

/** One box in the access graph: identities show their kind, so "alice" the user and "alice" the entity differ. */
export function GraphNodeCard({ data }: NodeProps) {
  const { label, kind } = data as { label: string; kind?: string }
  return (
    <div className="gnode-card">
      <Handle type="target" position={Position.Left} isConnectable={false} />
      {kind && <span className="gnode-kind">{kind}</span>}
      <span className="gnode-label">{label}</span>
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  )
}
