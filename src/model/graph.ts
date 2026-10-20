import { CAPABILITIES, parsePolicy, winningRules, type Capability, type PolicyRule } from './policy'

export const MANAGED_PREFIX = 'envbao-'

export type IdentityKind = 'user' | 'token' | 'entity' | 'group'

export interface Identity {
  kind: IdentityKind
  name: string
  policies: string[]
}

/** `hcl: null` for a policy that is referenced by an identity but could not be fetched. */
export interface PolicyInput {
  name: string
  hcl: string | null
}

export interface IdentityNode {
  id: string
  type: 'identity'
  kind: IdentityKind
  label: string
}

export interface PolicyNode {
  id: string
  type: 'policy'
  label: string
  managed: boolean
  /** Referenced by an identity but not present in the policy list. */
  missing: boolean
  warnings: string[]
}

export interface PathNode {
  id: string
  type: 'path'
  label: string
}

export type GraphNode = IdentityNode | PolicyNode | PathNode

export interface GraphEdge {
  id: string
  source: string
  target: string
  /** Present on policy -> path edges only. */
  capabilities?: Capability[]
  warnings?: string[]
}

export interface AccessGraph {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

export const identityId = (i: Pick<Identity, 'kind' | 'name'>) => `identity:${i.kind}:${i.name}`
export const policyId = (name: string) => `policy:${name}`
export const pathId = (path: string) => `path:${path}`

export const isManagedPolicy = (name: string) => name.startsWith(MANAGED_PREFIX)

/** The built-in root policy is not HCL; it allows everything. */
const ROOT_RULES: PolicyRule[] = [
  {
    path: '*',
    capabilities: CAPABILITIES.filter((c) => c !== 'deny'),
    warnings: ['Root policy: unrestricted access'],
  },
]

export function rulesFor(policy: PolicyInput): { rules: PolicyRule[]; warnings: string[] } {
  if (policy.name === 'root') return { rules: ROOT_RULES, warnings: [] }
  if (policy.hcl === null) return { rules: [], warnings: [] }
  return parsePolicy(policy.hcl)
}

/**
 * Identity -> Policy -> Path graph. Pure: callers fetch identities and policies.
 * Policies no identity uses are included so unattached grants stay visible.
 */
export function buildAccessGraph(identities: Identity[], policies: PolicyInput[]): AccessGraph {
  const nodes = new Map<string, GraphNode>()
  const edges = new Map<string, GraphEdge>()
  const byName = new Map(policies.map((p) => [p.name, p]))

  const addPolicy = (name: string) => {
    const id = policyId(name)
    if (nodes.has(id)) return
    // root is built in and never appears in the policy list
    const input = byName.get(name) ?? (name === 'root' ? { name, hcl: null } : undefined)
    const { rules, warnings } = input ? rulesFor(input) : { rules: [], warnings: [] }
    nodes.set(id, {
      id,
      type: 'policy',
      label: name,
      managed: isManagedPolicy(name),
      missing: !input,
      warnings: [...warnings, ...rules.flatMap((r) => r.warnings.map((w) => `${r.path}: ${w}`))],
    })
    for (const rule of rules) {
      const pid = pathId(rule.path)
      if (!nodes.has(pid)) nodes.set(pid, { id: pid, type: 'path', label: rule.path })
      const eid = `${id}->${pid}`
      const existing = edges.get(eid)
      if (existing) {
        // Same path declared twice in one policy: OpenBao unions the capabilities.
        existing.capabilities = [...new Set([...(existing.capabilities ?? []), ...rule.capabilities])]
        existing.warnings = [...(existing.warnings ?? []), ...rule.warnings]
      } else {
        edges.set(eid, {
          id: eid,
          source: id,
          target: pid,
          capabilities: [...rule.capabilities],
          warnings: rule.warnings.length ? [...rule.warnings] : undefined,
        })
      }
    }
  }

  for (const identity of identities) {
    const id = identityId(identity)
    nodes.set(id, { id, type: 'identity', kind: identity.kind, label: identity.name })
    for (const name of new Set(identity.policies)) {
      addPolicy(name)
      const eid = `${id}->${policyId(name)}`
      edges.set(eid, { id: eid, source: id, target: policyId(name) })
    }
  }
  for (const p of policies) addPolicy(p.name)

  return { nodes: [...nodes.values()], edges: [...edges.values()] }
}

/** Who can reach `secretPath`, and through which policies? Mirrors OpenBao: one winning path per identity, deny wins. */
export interface AccessEntry {
  identity: Identity
  policy: string
  capabilities: Capability[]
}

export function accessForPath(
  identities: Identity[],
  policies: PolicyInput[],
  secretPath: string,
  // Kept as a parameter so callers/tests can substitute the matcher.
  match: (rulePath: string, target: string) => boolean,
): AccessEntry[] {
  const byName = new Map(policies.map((p) => [p.name, p]))
  const out: AccessEntry[] = []
  for (const identity of identities) {
    const tagged = [...new Set(identity.policies)].flatMap((name) => {
      const p = byName.get(name) ?? (name === 'root' ? { name, hcl: null } : undefined)
      return p ? rulesFor(p).rules.filter((r) => match(r.path, secretPath)).map((r) => ({ ...r, policy: name })) : []
    })
    const winners = winningRules(tagged, secretPath)
    if (winners.some((r) => r.capabilities.includes('deny'))) continue
    for (const policy of new Set(winners.map((r) => r.policy))) {
      const caps = new Set(winners.filter((r) => r.policy === policy).flatMap((r) => r.capabilities))
      if (caps.size) out.push({ identity, policy, capabilities: [...caps] })
    }
  }
  return out
}
