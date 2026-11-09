import type { BaoClient } from '../bao'
import type { FieldDef, RoleKind } from './registry'

/** Anything with a field schema: a role kind, a config kind, or a credential request. */
export interface Schema {
  fields: FieldDef[]
}

const enc = encodeURIComponent

export type RoleData = Record<string, unknown>
export type DraftValue = string | boolean
export interface RoleDraft {
  name: string
  isNew: boolean
  /** Values for the schema fields, keyed by field key. */
  values: Record<string, DraftValue>
  /** Raw JSON body, used when the role kind has no field schema. */
  json: string
  /** Fields OpenBao returned that the schema does not know about; written back unchanged so edits don't drop them. */
  extras: RoleData
}

export async function listRoles(c: BaoClient, mount: string, kind: RoleKind): Promise<string[]> {
  return (await c.list(`${mount}${kind.path}`)).sort((a, b) => a.localeCompare(b))
}

export async function readRole(c: BaoClient, mount: string, kind: RoleKind, name: string): Promise<RoleData> {
  const res = await c.request<{ data: RoleData }>('GET', `${mount}${kind.path}/${enc(name)}`)
  return res.data
}

export async function writeRole(c: BaoClient, mount: string, kind: RoleKind, name: string, body: RoleData): Promise<void> {
  await c.request('POST', `${mount}${kind.path}/${enc(name)}`, body)
}

export async function deleteRole(c: BaoClient, mount: string, kind: RoleKind, name: string): Promise<void> {
  await c.request('DELETE', `${mount}${kind.path}/${enc(name)}`)
}

const listText = (v: unknown, sep: string) => (Array.isArray(v) ? v.join(sep) : typeof v === 'string' ? v : '')

function fieldToDraft(f: FieldDef, v: unknown): DraftValue {
  switch (f.type) {
    case 'bool':
      return v === true
    case 'ttl':
      // OpenBao reports durations as seconds; 0 means "unset / use default".
      return typeof v === 'number' ? (v > 0 ? `${v}s` : '') : typeof v === 'string' ? v : ''
    case 'secret':
      return ''
    case 'list':
      return listText(v, ', ')
    case 'statements':
      return listText(v, '\n\n')
    default:
      return typeof v === 'string' ? v : v == null ? '' : String(v)
  }
}

export function emptyDraft(kind: Schema): RoleDraft {
  const values: Record<string, DraftValue> = {}
  for (const f of kind.fields) values[f.key] = f.type === 'bool' ? false : f.type === 'select' ? (f.options?.[0] ?? '') : ''
  return { name: '', isNew: true, values, json: '{\n}', extras: {} }
}

export function draftFromRole(kind: Schema, name: string, data: RoleData): RoleDraft {
  const known = new Set(kind.fields.map((f) => f.key))
  const values: Record<string, DraftValue> = {}
  for (const f of kind.fields) values[f.key] = fieldToDraft(f, data[f.key])
  const extras = Object.fromEntries(Object.entries(data).filter(([k]) => !known.has(k)))
  return { name, isNew: false, values, json: JSON.stringify(data, null, 2), extras }
}

const splitList = (s: string) =>
  s
    .split(/[,\n]/)
    .map((x) => x.trim())
    .filter(Boolean)
const splitStatements = (s: string) =>
  s
    .split(/\n\s*\n/)
    .map((x) => x.trim())
    .filter(Boolean)

/** Request body for a role write. Throws an Error with a user-facing message for invalid input. */
export function payloadFromDraft(kind: Schema, draft: RoleDraft): RoleData {
  if (kind.fields.length === 0) {
    let parsed: unknown
    try {
      parsed = JSON.parse(draft.json)
    } catch {
      throw new Error('Role body is not valid JSON.')
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Role body must be a JSON object.')
    return parsed as RoleData
  }
  const body: RoleData = { ...draft.extras }
  for (const f of kind.fields) {
    const v = draft.values[f.key]
    if (f.type === 'bool') body[f.key] = v === true
    else if (f.type === 'list') body[f.key] = splitList(String(v))
    else if (f.type === 'statements') body[f.key] = splitStatements(String(v))
    else if (String(v).trim() !== '') body[f.key] = String(v).trim()
    else if (f.required) throw new Error(`${f.label} is required.`)
    else delete body[f.key]
    if ((f.type === 'list' || f.type === 'statements') && f.required && (body[f.key] as string[]).length === 0) {
      throw new Error(`${f.label} is required.`)
    }
  }
  return body
}
