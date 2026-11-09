import type { BaoClient } from './bao'

const enc = (path: string) => path.split('/').map(encodeURIComponent).join('/')

export interface KvMount {
  /** Mount path with trailing slash, e.g. "secret/". */
  path: string
}

export interface SecretEntry {
  name: string
  /** Path relative to the mount, e.g. "app/db" (folders keep a trailing slash). */
  path: string
  isFolder: boolean
}

export interface Mount {
  /** Mount path with trailing slash, e.g. "database/". */
  path: string
  /** Engine type as reported by sys/mounts, e.g. "kv", "database", "aws", "ssh". */
  type: string
  /** KV version ("1" | "2") when the engine is KV. */
  version?: string
  description?: string
  /**
   * Seconds explicitly set on this mount, 0 when it uses the system default. (sys/mounts/<path>/tune reports the
   * effective value instead, which would pin the default if it were saved back.)
   */
  defaultLeaseTtl?: number
  maxLeaseTtl?: number
}

/** Every secrets engine mount visible to the token, sorted by path. */
export async function listMounts(c: BaoClient): Promise<Mount[]> {
  const res = await c.request<{
    data: Record<
      string,
      {
        type: string
        description?: string
        options?: { version?: string } | null
        config?: { default_lease_ttl?: number; max_lease_ttl?: number }
      }
    >
  }>('GET', 'sys/mounts')
  return Object.entries(res.data)
    .map(([path, m]) => ({
      path,
      type: m.type,
      version: m.options?.version,
      description: m.description,
      defaultLeaseTtl: m.config?.default_lease_ttl,
      maxLeaseTtl: m.config?.max_lease_ttl,
    }))
    .sort((a, b) => a.path.localeCompare(b.path))
}

export const isKvV2 = (m: Mount) => m.type === 'kv' && m.version === '2'

export async function listKvMounts(c: BaoClient): Promise<KvMount[]> {
  return (await listMounts(c)).filter(isKvV2).map(({ path }) => ({ path }))
}

/** Lists metadata only; secret values are never read. `prefix` is "" or ends with "/". */
export async function listSecrets(c: BaoClient, mount: string, prefix: string): Promise<SecretEntry[]> {
  const keys = await c.list(`${mount}metadata/${enc(prefix)}`)
  return keys
    .map((k) => ({ name: k, path: prefix + k, isFolder: k.endsWith('/') }))
    .sort((a, b) => Number(b.isFolder) - Number(a.isFolder) || a.name.localeCompare(b.name))
}

/** API path of a secret's data, which is what ACL policies are written against. */
export const dataPath = (mount: string, secret: string) => `${mount}data/${secret}`

export async function readPolicyHcl(c: BaoClient, name: string): Promise<string | null> {
  try {
    const res = await c.request<{ data: { policy: string } }>('GET', `sys/policies/acl/${encodeURIComponent(name)}`)
    return res.data.policy
  } catch {
    return null
  }
}

/** Capabilities of the current token on a path (used to cross-check the access model). */
export async function capabilitiesSelf(c: BaoClient, path: string): Promise<string[]> {
  const res = await c.request<{ capabilities: string[] }>('POST', 'sys/capabilities-self', { paths: [path] })
  return res.capabilities
}
