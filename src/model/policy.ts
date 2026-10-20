import { HclSyntaxError, parseHcl, type HclValue } from './hcl'

export const CAPABILITIES = ['create', 'read', 'update', 'patch', 'delete', 'list', 'sudo', 'deny'] as const
export type Capability = (typeof CAPABILITIES)[number]

export interface PolicyRule {
  path: string
  capabilities: Capability[]
  /** Constructs we cannot model precisely (parameter constraints, templating, ...). */
  warnings: string[]
}

export interface ParsedPolicy {
  rules: PolicyRule[]
  /** Policy-level problems: syntax errors, unknown blocks. */
  warnings: string[]
}

// Attributes on a path block that restrict or modify access beyond capabilities.
const CONSTRAINT_ATTRS = [
  'allowed_parameters',
  'denied_parameters',
  'required_parameters',
  'min_wrapping_ttl',
  'max_wrapping_ttl',
  'control_group',
  'mfa_methods',
]

const isCapability = (c: HclValue): c is Capability => CAPABILITIES.includes(c as Capability)

export function parsePolicy(hcl: string): ParsedPolicy {
  let body
  try {
    body = parseHcl(hcl)
  } catch (e) {
    if (e instanceof HclSyntaxError) return { rules: [], warnings: [`Could not parse policy: ${e.message}`] }
    throw e
  }

  const warnings: string[] = []
  const rules: PolicyRule[] = []

  for (const [name] of Object.entries(body.attributes)) warnings.push(`Ignored top-level attribute "${name}"`)

  for (const block of body.blocks) {
    if (block.type !== 'path' || block.labels.length !== 1) {
      warnings.push(`Ignored unsupported block "${block.type}"`)
      continue
    }
    const path = block.labels[0]
    const ruleWarnings: string[] = []

    const caps = block.body.attributes.capabilities
    const capabilities: Capability[] = []
    if (!Array.isArray(caps)) {
      ruleWarnings.push('No capabilities list')
    } else {
      for (const c of caps) {
        if (isCapability(c)) {
          if (!capabilities.includes(c)) capabilities.push(c)
        } else ruleWarnings.push(`Unknown capability "${String(c)}"`)
      }
    }

    for (const attr of CONSTRAINT_ATTRS) {
      if (attr in block.body.attributes || block.body.blocks.some((b) => b.type === attr)) {
        ruleWarnings.push(`Constraint "${attr}" is not reflected in the graph`)
      }
    }
    if (path.includes('{{')) ruleWarnings.push('Templated path is approximated')

    rules.push({ path, capabilities, warnings: ruleWarnings })
  }

  return { rules, warnings }
}

/**
 * Does a policy rule path cover a concrete path?
 * `+` matches exactly one segment; a trailing `*` matches any suffix (including none).
 * Templated segments (`{{...}}`) are treated as `+`.
 */
export function pathMatches(rulePath: string, target: string): boolean {
  const prefixGlob = rulePath.endsWith('*')
  const pattern = prefixGlob ? rulePath.slice(0, -1) : rulePath
  const pSegs = pattern.split('/')
  const tSegs = target.split('/')

  if (!prefixGlob) {
    if (pSegs.length !== tSegs.length) return false
    return pSegs.every((p, i) => segmentMatches(p, tSegs[i]))
  }

  // Everything before the final (partial) segment must match whole segments;
  // the last pattern segment is a literal prefix of the corresponding target segment.
  const last = pSegs.length - 1
  if (tSegs.length < pSegs.length) return false
  for (let i = 0; i < last; i++) if (!segmentMatches(pSegs[i], tSegs[i])) return false
  const lastPat = pSegs[last]
  if (lastPat.includes('+') || lastPat.includes('{{')) return segmentMatches(lastPat, tSegs[last]) || tSegs.length > pSegs.length
  return tSegs[last].startsWith(lastPat)
}

function segmentMatches(pattern: string, segment: string): boolean {
  if (pattern === '+' || /^\{\{.*\}\}$/.test(pattern)) return segment.length > 0
  return pattern === segment
}

const normalised = (path: string) => path.replace(/\{\{[^}]*\}\}/g, '+')

/**
 * OpenBao picks ONE winning path among the rules that match, it does not merge them
 * (rules with the identical path string, e.g. from different policies, are merged).
 * Priority, highest first: first wildcard (+ or *) later in the path; non-glob over
 * trailing-`*` glob; fewer `+` segments; longer path; lexicographically larger.
 * Returns >0 if `a` outranks `b`.
 */
export function comparePriority(a: string, b: string): number {
  const na = normalised(a)
  const nb = normalised(b)
  const wild = (p: string) => {
    const i = p.search(/[+*]/)
    return i < 0 ? Infinity : i
  }
  if (wild(na) !== wild(nb)) return wild(na) > wild(nb) ? 1 : -1
  const globA = na.endsWith('*')
  const globB = nb.endsWith('*')
  if (globA !== globB) return globA ? -1 : 1
  const plus = (p: string) => p.split('/').filter((x) => x === '+').length
  if (plus(na) !== plus(nb)) return plus(na) < plus(nb) ? 1 : -1
  if (na.length !== nb.length) return na.length > nb.length ? 1 : -1
  return na === nb ? 0 : na > nb ? 1 : -1
}

/** The rules at the single winning path for `target` (several when policies repeat that path). */
export function winningRules<T extends { path: string }>(rules: T[], target: string): T[] {
  let best: T[] = []
  for (const r of rules) {
    if (!pathMatches(r.path, target)) continue
    const c = best.length ? comparePriority(r.path, best[0].path) : 1
    if (c > 0) best = [r]
    else if (c === 0) best.push(r)
  }
  return best
}

/** Effective capabilities on a concrete path; `deny` wins at the winning path. */
export function effectiveCapabilities(rules: PolicyRule[], target: string): Capability[] {
  const caps = new Set<Capability>()
  for (const r of winningRules(rules, target)) r.capabilities.forEach((c) => caps.add(c))
  return caps.has('deny') ? ['deny'] : [...caps]
}
