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

export async function listKvMounts(c: BaoClient): Promise<KvMount[]> {
  const res = await c.request<{ data: Record<string, { type: string; options?: { version?: string } | null }> }>(
    'GET',
    'sys/mounts',
  )
  return Object.entries(res.data)
    .filter(([, m]) => m.type === 'kv' && m.options?.version === '2')
    .map(([path]) => ({ path }))
    .sort((a, b) => a.path.localeCompare(b.path))
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
