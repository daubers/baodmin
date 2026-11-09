import { parsePolicy } from './policy'

/** Prefixes OpenBao reserves for itself; a secrets engine cannot be mounted at or under them. */
const RESERVED = ['sys', 'auth', 'identity', 'cubbyhole']

const SEGMENT = /^[a-z0-9][a-z0-9_-]*$/

const norm = (p: string) => p.replace(/^\/+|\/+$/g, '')

/**
 * Error message for a mount path that can't be used, or null. `existing` are the current mounts (with or without
 * trailing slashes). Nested paths such as "team/kv" are fine, but a mount can't sit inside another or contain one.
 */
export function validateMountPath(path: string, existing: string[]): string | null {
  const p = norm(path)
  if (!p) return 'Path is required.'
  if (path !== path.trim()) return 'Path must not start or end with spaces.'
  if (!p.split('/').every((s) => SEGMENT.test(s))) {
    return 'Use lowercase letters, digits, "-" and "_", starting each part with a letter or digit. Parts are separated by "/".'
  }
  const first = p.split('/')[0]
  if (RESERVED.includes(first)) return `"${first}" is reserved by OpenBao.`
  for (const e of existing.map(norm)) {
    if (e === p) return `"${p}/" is already a secrets engine.`
    if (p.startsWith(`${e}/`)) return `"${p}/" would sit inside the existing mount "${e}/".`
    if (e.startsWith(`${p}/`)) return `"${p}/" would contain the existing mount "${e}/".`
  }
  return null
}

export interface PolicyText {
  name: string
  /** Null when the policy could not be read. */
  hcl: string | null
}

/** Policies with a rule on a path under `mount`, which would be left pointing at nothing if it were deleted. */
export function policiesReferencing(policies: PolicyText[], mount: string): string[] {
  const m = mount.endsWith('/') ? mount : `${mount}/`
  return policies
    .filter((p) => p.hcl !== null && parsePolicy(p.hcl).rules.some((r) => r.path.startsWith(m)))
    .map((p) => p.name)
    .sort((a, b) => a.localeCompare(b))
}
