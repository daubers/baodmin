import { MANAGED_PREFIX } from './graph'
import { CAPABILITIES, parsePolicy, type Capability } from './policy'

/** Identity kinds that can hold a managed policy. Tokens cannot: their policies are fixed at creation. */
export type GrantTarget = 'user' | 'entity' | 'group'

export interface Grant {
  /** Full API path, e.g. "secret/data/app/*". */
  path: string
  capabilities: Capability[]
}

export interface ManagedPolicy {
  owner: string | null
  grants: Grant[]
  /** False when the policy has anything the form cannot round-trip (or isn't ours). */
  editable: boolean
  reasons: string[]
}

const OWNER_RE = /^# envbao-owner: (user|entity|group):(.+)$/m

export const ownerTag = (kind: GrantTarget, name: string) => `${kind}:${name}`

/** OpenBao lowercases policy names; keep to a safe character set. */
export function managedPolicyName(kind: GrantTarget, name: string): string {
  const safe = name.toLowerCase().replace(/[^a-z0-9_.-]+/g, '-')
  return `${MANAGED_PREFIX}${kind}-${safe}`
}

/** Returns an error message, or null if the path can be written safely into a policy. */
export function validateGrantPath(path: string): string | null {
  if (!path.trim()) return 'Path is required.'
  if (path !== path.trim()) return 'Path must not start or end with spaces.'
  if (path.startsWith('/')) return 'Path must not start with "/".'
  if (/["\\\n\r]/.test(path)) return 'Path must not contain quotes, backslashes or line breaks.'
  if (path.includes('*') && !path.endsWith('*')) return '"*" is only allowed at the end of a path.'
  return null
}

export function renderManagedPolicy(kind: GrantTarget, name: string, grants: Grant[]): string {
  const sorted = [...grants].sort((a, b) => a.path.localeCompare(b.path))
  const header = [
    '# Managed by EnvBao. Changes made outside EnvBao may be overwritten.',
    `# envbao-owner: ${ownerTag(kind, name)}`,
  ]
  const blocks = sorted.map((g) => {
    const caps = CAPABILITIES.filter((c) => g.capabilities.includes(c))
    return `path "${g.path}" {\n  capabilities = [${caps.map((c) => `"${c}"`).join(', ')}]\n}`
  })
  return [...header, '', ...blocks].join('\n') + '\n'
}

export function parseManagedPolicy(hcl: string): ManagedPolicy {
  const owner = OWNER_RE.exec(hcl)?.[0].replace('# envbao-owner: ', '') ?? null
  const parsed = parsePolicy(hcl)
  const reasons: string[] = []
  if (!owner) reasons.push('Not created by EnvBao (no owner marker).')
  reasons.push(...parsed.warnings)
  for (const r of parsed.rules) reasons.push(...r.warnings.map((w) => `${r.path}: ${w}`))
  const seen = new Set<string>()
  for (const r of parsed.rules) {
    if (seen.has(r.path)) reasons.push(`${r.path}: declared more than once`)
    seen.add(r.path)
  }
  return {
    owner,
    grants: parsed.rules.map((r) => ({ path: r.path, capabilities: r.capabilities })),
    editable: reasons.length === 0,
    reasons,
  }
}

/** Replace the grant for `grant.path`; an empty capability list removes it. */
export function upsertGrant(grants: Grant[], grant: Grant): Grant[] {
  const rest = grants.filter((g) => g.path !== grant.path)
  return grant.capabilities.length ? [...rest, grant] : rest
}

export const removeGrant = (grants: Grant[], path: string): Grant[] => grants.filter((g) => g.path !== path)

export type KvCapability = 'read' | 'create' | 'update' | 'delete' | 'list'
export const KV_CAPABILITIES: KvCapability[] = ['read', 'create', 'update', 'delete', 'list']

/**
 * Expand a KV v2 grant on `mount` + `secretPath` into API-path rules: data operations apply to
 * `<mount>data/<path>`, while `list` is a metadata operation on `<mount>metadata/<path>`.
 */
export function kvGrantRules(mount: string, secretPath: string, caps: KvCapability[]): Grant[] {
  const m = mount.endsWith('/') ? mount : `${mount}/`
  const dataCaps = caps.filter((c): c is Exclude<KvCapability, 'list'> => c !== 'list')
  return [
    { path: `${m}data/${secretPath}`, capabilities: dataCaps },
    { path: `${m}metadata/${secretPath}`, capabilities: caps.includes('list') ? ['list'] : [] },
  ]
}
