import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { BaoClient } from '../../api/bao'
import { revokeAccess } from '../../api/grants'
import type { AccessGraph, GraphEdge, GraphNode, PolicyInput } from '../../model/graph'
import { parseManagedPolicy, type GrantTarget } from '../../model/managed'

export type Selection = { kind: 'node'; id: string } | { kind: 'edge'; id: string }

interface Props {
  client: BaoClient
  full: AccessGraph
  policies: PolicyInput[]
  selection: Selection | null
  onRevoked: () => void
}

const nodeById = (g: AccessGraph, id: string) => g.nodes.find((n) => n.id === id)
const label = (n: GraphNode | undefined) => n?.label ?? '?'

function NodeDetails({ node, full, policies }: { node: GraphNode; full: AccessGraph; policies: PolicyInput[] }) {
  const out = full.edges.filter((e) => e.source === node.id)
  const into = full.edges.filter((e) => e.target === node.id)
  const caps = (e: GraphEdge) => (e.capabilities?.length ? ` (${e.capabilities.join(', ')})` : '')

  if (node.type === 'identity') {
    return (
      <>
        <h2>{node.label}</h2>
        <p>{node.kind}</p>
        <h3>Policies</h3>
        <ul>{out.map((e) => <li key={e.id}>{label(nodeById(full, e.target))}</li>)}</ul>
      </>
    )
  }
  if (node.type === 'policy') {
    const hcl = policies.find((p) => p.name === node.label)?.hcl
    return (
      <>
        <h2>{node.label}</h2>
        <p>
          {node.missing ? 'Attached but does not exist.' : node.managed ? 'Managed by EnvBao.' : 'Not managed by EnvBao (read-only).'}
        </p>
        {node.warnings.length > 0 && (
          <ul>
            {node.warnings.map((w) => (
              <li key={w}>⚠ {w}</li>
            ))}
          </ul>
        )}
        <h3>Used by</h3>
        <ul>{into.map((e) => <li key={e.id}>{label(nodeById(full, e.source))}</li>)}</ul>
        <h3>Grants</h3>
        <ul>
          {out.map((e) => (
            <li key={e.id}>
              <code>{label(nodeById(full, e.target))}</code>
              {caps(e)}
            </li>
          ))}
        </ul>
        {hcl && <pre>{hcl}</pre>}
      </>
    )
  }
  // path: who reaches it, via which policy
  return (
    <>
      <h2>
        <code>{node.label}</code>
      </h2>
      <h3>Reached through</h3>
      <ul>
        {into.map((e) => {
          const users = full.edges.filter((x) => x.target === e.source).map((x) => label(nodeById(full, x.source)))
          return (
            <li key={e.id}>
              {label(nodeById(full, e.source))}
              {caps(e)}: {users.join(', ') || 'no identity'}
            </li>
          )
        })}
      </ul>
    </>
  )
}

function EdgeDetails({ client, edge, full, policies, onRevoked }: { client: BaoClient; edge: GraphEdge; full: AccessGraph } & Pick<Props, 'policies' | 'onRevoked'>) {
  const qc = useQueryClient()
  const from = nodeById(full, edge.source)
  const to = nodeById(full, edge.target)
  const isGrant = from?.type === 'policy' && to?.type === 'path'

  const hcl = isGrant ? policies.find((p) => p.name === from.label)?.hcl : null
  const managed = hcl ? parseManagedPolicy(hcl) : null
  const ownerMatch = managed?.owner ? /^(user|entity|group):(.+)$/.exec(managed.owner) : null

  const revoke = useMutation({
    mutationFn: () => revokeAccess(client, { kind: ownerMatch![1] as GrantTarget, name: ownerMatch![2] }, [to!.label]),
    onSuccess: async () => {
      await Promise.all(['access-inputs', 'grant-state', 'users', 'entities', 'groups'].map((k) => qc.invalidateQueries({ queryKey: [k] })))
      onRevoked()
    },
  })

  return (
    <>
      <h2>
        {label(from)} → {label(to)}
      </h2>
      {edge.capabilities && <p>Capabilities: {edge.capabilities.join(', ')}</p>}
      {edge.warnings?.map((w) => <p key={w}>⚠ {w}</p>)}
      {isGrant && (
        <>
          {managed?.editable && ownerMatch ? (
            <button
              type="button"
              onClick={() =>
                window.confirm(`Revoke access to ${to!.label} from ${ownerMatch[1]} "${ownerMatch[2]}"? Other policies are unaffected.`) &&
                revoke.mutate()
              }
              disabled={revoke.isPending}
            >
              Revoke
            </button>
          ) : (
            <p className="hint">This grant is in a policy EnvBao does not manage (or that was edited outside EnvBao), so it can’t be revoked here.</p>
          )}
          {revoke.error && <p role="alert">{revoke.error.message}</p>}
        </>
      )}
    </>
  )
}

export function Details({ client, full, policies, selection, onRevoked }: Props) {
  let body = <p className="hint">Click a node or an edge for details.</p>
  if (selection?.kind === 'node') {
    const node = nodeById(full, selection.id)
    if (node) body = <NodeDetails node={node} full={full} policies={policies} />
  } else if (selection?.kind === 'edge') {
    const edge = full.edges.find((e) => e.id === selection.id)
    if (edge) body = <EdgeDetails client={client} edge={edge} full={full} policies={policies} onRevoked={onRevoked} />
  }
  return (
    <aside className="graph-details" aria-label="Details">
      {body}
    </aside>
  )
}
