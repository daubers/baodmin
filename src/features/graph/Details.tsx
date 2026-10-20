import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { BaoClient } from '../../api/bao'
import { revokeAccess } from '../../api/grants'
import type { AccessGraph, GraphEdge, GraphNode, PolicyInput } from '../../model/graph'
import { parseManagedPolicy, type GrantTarget } from '../../model/managed'
import { CapabilityChips } from '../shared/CapabilityChips'

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

/** An identity's name with its kind, so "alice" the user and "alice" the entity read differently. */
function Who({ node }: { node: GraphNode | undefined }) {
  return (
    <>
      <span>{label(node)}</span>
      {node?.type === 'identity' && <span className="tag">{node.kind}</span>}
    </>
  )
}

function Warnings({ items }: { items: string[] | undefined }) {
  return items?.map((w) => (
    <p key={w} className="note-warn">
      {w}
    </p>
  ))
}

function NodeDetails({ node, full, policies }: { node: GraphNode; full: AccessGraph; policies: PolicyInput[] }) {
  const out = full.edges.filter((e) => e.source === node.id)
  const into = full.edges.filter((e) => e.target === node.id)

  if (node.type === 'identity') {
    return (
      <>
        <header className="detail-head">
          <h2>{node.label}</h2>
          <span className="tag">{node.kind}</span>
        </header>
        <h3>Policies</h3>
        {out.length ? (
          <ul className="rows">
            {out.map((e) => (
              <li key={e.id}>
                <code>{label(nodeById(full, e.target))}</code>
              </li>
            ))}
          </ul>
        ) : (
          <p className="hint">No policies attached.</p>
        )}
      </>
    )
  }

  if (node.type === 'policy') {
    const hcl = policies.find((p) => p.name === node.label)?.hcl
    const status = node.missing ? 'Attached but does not exist' : node.managed ? 'Managed by EnvBao' : 'Not managed by EnvBao (read-only)'
    return (
      <>
        <header className="detail-head">
          <h2>{node.label}</h2>
        </header>
        <p className="hint">{status}.</p>
        <Warnings items={node.warnings} />
        <h3>Used by</h3>
        {into.length ? (
          <ul className="rows">
            {into.map((e) => (
              <li key={e.id}>
                <Who node={nodeById(full, e.source)} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="hint">Not attached to anything.</p>
        )}
        <h3>Grants</h3>
        {out.length ? (
          <ul className="rows">
            {out.map((e) => (
              <li key={e.id}>
                <code>{label(nodeById(full, e.target))}</code>
                {e.capabilities && <CapabilityChips capabilities={e.capabilities} />}
              </li>
            ))}
          </ul>
        ) : (
          <p className="hint">No grants.</p>
        )}
        {hcl && (
          <details>
            <summary>Policy HCL</summary>
            <pre>{hcl}</pre>
          </details>
        )}
      </>
    )
  }

  // path: who reaches it, via which policy
  return (
    <>
      <header className="detail-head">
        <h2>
          <code>{node.label}</code>
        </h2>
      </header>
      <h3>Reached through</h3>
      <ul className="rows">
        {into.map((e) => {
          const users = full.edges.filter((x) => x.target === e.source).map((x) => nodeById(full, x.source))
          return (
            <li key={e.id} className="stacked">
              <div className="row-main">
                <code>{label(nodeById(full, e.source))}</code>
                {e.capabilities && <CapabilityChips capabilities={e.capabilities} />}
              </div>
              {users.length ? (
                <ul className="people">
                  {users.map((u, i) => (
                    <li key={i}>
                      <Who node={u} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="hint">No identity uses this policy.</p>
              )}
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
      <header className="detail-head">
        <h2>
          <Who node={from} />
        </h2>
      </header>
      <p className="edge-to">
        <span aria-hidden="true">→</span> <code>{label(to)}</code>
      </p>
      {edge.capabilities && (
        <>
          <h3>Capabilities</h3>
          <CapabilityChips capabilities={edge.capabilities} />
        </>
      )}
      <Warnings items={edge.warnings} />
      {isGrant && (
        <>
          {managed?.editable && ownerMatch ? (
            <button
              type="button"
              className="danger"
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
  let body = <p className="detail-empty">Select a node or a line to see what it grants.</p>
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
