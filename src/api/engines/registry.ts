import type { Mount } from '../secrets'
import { isKvV2 } from '../secrets'

/** Describes a dynamic secrets engine the UI can manage. Grows in later phases (role fields, creds, config). */
export interface EngineDef {
  /** Engine type as reported by sys/mounts. */
  type: string
  label: string
  /** Path, relative to the mount, that roles are listed/written under. */
  rolesPath: string
}

export const ENGINES: Record<string, EngineDef> = {
  database: { type: 'database', label: 'Database', rolesPath: 'roles' },
  aws: { type: 'aws', label: 'AWS', rolesPath: 'roles' },
  ssh: { type: 'ssh', label: 'SSH', rolesPath: 'roles' },
}

/** Engine types that are managed as plain secret stores or by the system, not as dynamic engines. */
const NOT_DYNAMIC = new Set(['kv', 'generic', 'cubbyhole', 'system', 'identity'])

/** Known engine definition, or a generic fallback (raw JSON roles) for any other dynamic engine type. */
export function engineFor(type: string): EngineDef {
  return ENGINES[type] ?? { type, label: type, rolesPath: 'roles' }
}

export type MountKind = 'kv' | 'dynamic'

/** KV v2 mounts use the path-tree browser; every other non-system engine is treated as dynamic. */
export function mountKind(m: Mount): MountKind | null {
  if (isKvV2(m)) return 'kv'
  if (NOT_DYNAMIC.has(m.type)) return null
  return 'dynamic'
}
