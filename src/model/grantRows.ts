import type { Grant } from './managed'
import { CAPABILITIES, type Capability } from './policy'

/** One line in the "granted by EnvBao" list: a secret path with everything granted on it. */
export interface GrantRow {
  /** Where the grant applies as a user thinks of it, e.g. "secret/app/*" (not "secret/data/app/*"). */
  display: string
  wildcard: boolean
  capabilities: Capability[]
  /** The policy paths behind this row; revoking the row removes all of them. */
  paths: string[]
}

/**
 * KV v2 grants are stored as a `data/` rule and a `metadata/` rule per secret. Fold each pair into one row
 * keyed by the secret's own path; grants outside a known KV mount keep their raw path.
 */
export function groupGrants(grants: Grant[], mounts: string[]): GrantRow[] {
  const rows = new Map<string, GrantRow>()
  for (const g of grants) {
    let display = g.path
    for (const m of mounts) {
      const mount = m.endsWith('/') ? m : `${m}/`
      for (const kind of ['data', 'metadata']) {
        const prefix = `${mount}${kind}/`
        if (g.path.startsWith(prefix)) display = mount + g.path.slice(prefix.length)
      }
    }
    const row = rows.get(display) ?? { display, wildcard: display.endsWith('*'), capabilities: [], paths: [] }
    row.capabilities = CAPABILITIES.filter((c) => row.capabilities.includes(c) || g.capabilities.includes(c))
    row.paths.push(g.path)
    rows.set(display, row)
  }
  return [...rows.values()]
}
