import type { BaoClient } from './bao'
import { engineFor, type MountType } from './engines/registry'
import { listLeases } from './engines/leases'
import { listRoles, type RoleData } from './engines/roles'
import { listSecrets } from './secrets'

const encPath = (mount: string) =>
  mount
    .replace(/^\/+|\/+$/g, '')
    .split('/')
    .map(encodeURIComponent)
    .join('/')

const sysPath = (mount: string) => `sys/mounts/${encPath(mount)}`
const withSlash = (mount: string) => (mount.endsWith('/') ? mount : `${mount}/`)

/** Thrown when the mount was created but a follow-up step failed, so the caller can say the mount exists. */
export class PartialMountError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PartialMountError'
  }
}

/** Splits form values into what sys/mounts takes and what the KV engine keeps itself. */
function split(type: MountType, body: RoleData): { sys: RoleData; kv: RoleData } {
  const configKeys = new Set(type.configFields.map((f) => f.key))
  const sys: RoleData = {}
  const kv: RoleData = {}
  for (const [k, v] of Object.entries(body)) (configKeys.has(k) ? kv : sys)[k] = v
  return { sys, kv }
}

/** KV v2 sends max_versions as a number; everything else stays as the form produced it. */
function kvBody(kv: RoleData): RoleData {
  const out = { ...kv }
  if (typeof out.max_versions === 'string') out.max_versions = Number(out.max_versions)
  return out
}

/** Mounts a secrets engine at `path`. KV v2 settings take a second call; if it fails the mount is still there. */
export async function createMount(c: BaoClient, path: string, type: MountType, body: RoleData): Promise<void> {
  const { sys, kv } = split(type, body)
  const config: RoleData = {}
  if (sys.default_lease_ttl) config.default_lease_ttl = sys.default_lease_ttl
  if (sys.max_lease_ttl) config.max_lease_ttl = sys.max_lease_ttl
  await c.request('POST', sysPath(path), {
    type: type.type,
    description: sys.description ?? '',
    ...(type.options ? { options: type.options } : {}),
    ...(Object.keys(config).length ? { config } : {}),
  })
  if (Object.keys(kv).length) {
    try {
      await writeKvConfig(c, path, type, kv)
    } catch (e) {
      throw new PartialMountError(`${withSlash(path)} was mounted, but saving its KV settings failed: ${(e as Error).message}`)
    }
  }
}

/**
 * Changes a mount's description and default/max lease TTL (and KV settings). Path and type can't change. A blank TTL
 * resets to the system default, which OpenBao spells 0.
 */
export async function tuneMount(c: BaoClient, path: string, type: MountType, body: RoleData): Promise<void> {
  const { sys, kv } = split(type, body)
  const hasTtl = type.fields.some((f) => f.key === 'default_lease_ttl')
  await c.request('POST', `${sysPath(path)}/tune`, {
    description: sys.description ?? '',
    ...(hasTtl ? { default_lease_ttl: sys.default_lease_ttl ?? '0', max_lease_ttl: sys.max_lease_ttl ?? '0' } : {}),
  })
  if (Object.keys(kv).length) await writeKvConfig(c, path, type, kv)
}

/** Unmounts the engine. This permanently deletes everything stored in it and revokes every lease it issued. */
export async function deleteMount(c: BaoClient, path: string): Promise<void> {
  await c.request('DELETE', sysPath(path))
}

export async function readKvConfig(c: BaoClient, mount: string): Promise<RoleData> {
  const res = await c.request<{ data: RoleData }>('GET', `${withSlash(mount)}config`)
  return res.data
}

async function writeKvConfig(c: BaoClient, mount: string, type: MountType, kv: RoleData): Promise<void> {
  if (type.configFields.length === 0) return
  await c.request('POST', `${withSlash(mount)}config`, kvBody(kv))
}

export interface MountImpact {
  kind: 'kv' | 'dynamic'
  /** KV: entries at the top level of the mount (folders count as one). */
  topLevelEntries?: number
  /** Dynamic: roles across all role kinds. */
  roles?: number
  /** Dynamic: whether any lease exists under the mount (they are all revoked on delete). */
  hasLeases?: boolean
  /** Things that could not be counted, e.g. no permission to list. */
  unknown: string[]
}

/** What deleting a mount would destroy, as far as the token can see. Never reads secret values. */
export async function mountImpact(c: BaoClient, mount: string, type: string): Promise<MountImpact> {
  const unknown: string[] = []
  if (type === 'kv') {
    const entries = await listSecrets(c, mount, '').catch(() => {
      unknown.push('secrets')
      return null
    })
    return { kind: 'kv', topLevelEntries: entries?.length, unknown }
  }
  const engine = engineFor(type)
  let roles = 0
  for (const kind of engine.roleKinds) {
    roles += (await listRoles(c, mount, kind).catch(() => {
      unknown.push(kind.label.toLowerCase())
      return []
    })).length
  }
  const leases = await listLeases(c, mount).catch(() => {
    unknown.push('leases')
    return null
  })
  return { kind: 'dynamic', roles, hasLeases: leases === null ? undefined : leases.length > 0, unknown }
}
