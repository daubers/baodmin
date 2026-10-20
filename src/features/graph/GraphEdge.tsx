import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from '@xyflow/react'

export interface GrantEdgeData {
  label: string
  /** Vertical nudge so labels on edges into the same node don't sit on top of each other. */
  offset: number
  onSelect: () => void
}

/**
 * A policy -> path edge. The capability label sits just before the target node, where edges have
 * fanned out to different rows, instead of at the midpoint where edges from one policy bunch up.
 */
export function GrantEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, selected, data }: EdgeProps) {
  const { label, offset, onSelect } = data as unknown as GrantEdgeData
  const [path] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition })
  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} />
      <EdgeLabelRenderer>
        <button
          type="button"
          className={`nodrag nopan edge-label${selected ? ' edge-label-selected' : ''}`}
          style={{ transform: `translate(-100%, -50%) translate(${targetX - 18}px, ${targetY + offset}px)` }}
          onClick={onSelect}
        >
          {label}
        </button>
      </EdgeLabelRenderer>
    </>
  )
}
