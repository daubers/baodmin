import { BaoError, type BaoClient } from '../bao'
import type { ActionDef, ConfigKind } from './registry'
import type { RoleData } from './roles'

const enc = encodeURIComponent
const where = (mount: string, kind: ConfigKind, name?: string) =>
  kind.named ? `${mount}${kind.path}/${enc(name ?? '')}` : `${mount}${kind.path}`

/** Names of the configs of a named kind (database connections). */
export async function listConfigs(c: BaoClient, mount: string, kind: ConfigKind): Promise<string[]> {
  return (await c.list(`${mount}${kind.path}`)).sort((a, b) => a.localeCompare(b))
}

/**
 * Reads a config, flattening `kind.nested` into the top level. Returns null when nothing is configured yet.
 * OpenBao never returns write-only values such as passwords, so none can appear here.
 */
export async function readConfig(c: BaoClient, mount: string, kind: ConfigKind, name?: string): Promise<RoleData | null> {
  try {
    const res = await c.request<{ data: RoleData } | undefined>('GET', where(mount, kind, name))
    const data = res?.data
    if (!data) return null
    const nested = kind.nested ? data[kind.nested] : undefined
    return nested && typeof nested === 'object' ? { ...data, ...(nested as RoleData) } : data
  } catch (e) {
    if (e instanceof BaoError && e.kind === 'not-found') return null
    if (e instanceof BaoError && kind.unsetMessage && e.message.toLowerCase().includes(kind.unsetMessage)) return null
    throw e
  }
}

export async function writeConfig(c: BaoClient, mount: string, kind: ConfigKind, body: RoleData, name?: string): Promise<void> {
  await c.request('POST', where(mount, kind, name), body)
}

export async function deleteConfig(c: BaoClient, mount: string, kind: ConfigKind, name?: string): Promise<void> {
  await c.request('DELETE', where(mount, kind, name))
}

export async function runAction(c: BaoClient, mount: string, action: ActionDef, name?: string): Promise<void> {
  await c.request('POST', `${mount}${action.path.replace('{name}', enc(name ?? ''))}`, action.body ?? {})
}
