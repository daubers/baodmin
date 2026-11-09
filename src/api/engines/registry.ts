import type { Mount } from '../secrets'
import { isKvV2 } from '../secrets'

export type FieldType =
  /** Single-line string. */
  | 'text'
  /** Multi-line string sent as-is (e.g. a JSON policy document). */
  | 'textarea'
  /** Duration such as "1h" or "3600s"; read back from OpenBao as seconds. */
  | 'ttl'
  /** Comma or newline separated values sent as a string array. */
  | 'list'
  /** Statements separated by blank lines (SQL can contain commas) sent as a string array. */
  | 'statements'
  | 'bool'
  | 'select'

export interface FieldDef {
  key: string
  label: string
  type: FieldType
  required?: boolean
  options?: string[]
  help?: string
}

/** One family of roles under a mount, e.g. database "roles" and "static-roles". */
export interface RoleKind {
  id: string
  label: string
  /** Path relative to the mount that roles are listed and written under. */
  path: string
  /** Empty means the role is edited as raw JSON (generic engines). */
  fields: FieldDef[]
}

/** Describes a dynamic secrets engine the UI can manage. Grows in later phases (creds, config). */
export interface EngineDef {
  /** Engine type as reported by sys/mounts. */
  type: string
  label: string
  roleKinds: RoleKind[]
}

const DATABASE_ROLE: RoleKind = {
  id: 'roles',
  label: 'Dynamic roles',
  path: 'roles',
  fields: [
    { key: 'db_name', label: 'Database config name', type: 'text', required: true },
    {
      key: 'creation_statements',
      label: 'Creation statements',
      type: 'statements',
      required: true,
      help: 'Separate statements with a blank line. Use {{name}}, {{password}} and {{expiration}}.',
    },
    { key: 'revocation_statements', label: 'Revocation statements', type: 'statements' },
    { key: 'renew_statements', label: 'Renew statements', type: 'statements' },
    { key: 'rollback_statements', label: 'Rollback statements', type: 'statements' },
    { key: 'default_ttl', label: 'Default TTL', type: 'ttl' },
    { key: 'max_ttl', label: 'Max TTL', type: 'ttl' },
  ],
}

const DATABASE_STATIC_ROLE: RoleKind = {
  id: 'static-roles',
  label: 'Static roles',
  path: 'static-roles',
  fields: [
    { key: 'db_name', label: 'Database config name', type: 'text', required: true },
    { key: 'username', label: 'Database username', type: 'text', required: true },
    { key: 'rotation_statements', label: 'Rotation statements', type: 'statements' },
    { key: 'rotation_period', label: 'Rotation period', type: 'ttl' },
  ],
}

const AWS_ROLE: RoleKind = {
  id: 'roles',
  label: 'Roles',
  path: 'roles',
  fields: [
    {
      key: 'credential_type',
      label: 'Credential type',
      type: 'select',
      required: true,
      options: ['iam_user', 'assumed_role', 'federation_token'],
    },
    { key: 'role_arns', label: 'Role ARNs', type: 'list', help: 'For assumed_role.' },
    { key: 'policy_arns', label: 'Policy ARNs', type: 'list' },
    { key: 'policy_document', label: 'Policy document (JSON)', type: 'textarea' },
    { key: 'iam_groups', label: 'IAM groups', type: 'list', help: 'For iam_user.' },
    { key: 'default_sts_ttl', label: 'Default STS TTL', type: 'ttl' },
    { key: 'max_sts_ttl', label: 'Max STS TTL', type: 'ttl' },
    { key: 'permissions_boundary_arn', label: 'Permissions boundary ARN', type: 'text' },
    { key: 'user_path', label: 'IAM user path', type: 'text' },
  ],
}

const SSH_ROLE: RoleKind = {
  id: 'roles',
  label: 'Roles',
  path: 'roles',
  fields: [
    { key: 'key_type', label: 'Key type', type: 'select', required: true, options: ['ca', 'otp'] },
    { key: 'default_user', label: 'Default user', type: 'text' },
    { key: 'allowed_users', label: 'Allowed users', type: 'text', help: 'Comma separated; * allows any.' },
    { key: 'cidr_list', label: 'CIDR list', type: 'text', help: 'otp only. Comma separated.' },
    { key: 'ttl', label: 'TTL', type: 'ttl' },
    { key: 'max_ttl', label: 'Max TTL', type: 'ttl' },
    { key: 'allow_user_certificates', label: 'Allow user certificates', type: 'bool' },
    { key: 'allow_host_certificates', label: 'Allow host certificates', type: 'bool' },
    { key: 'allowed_extensions', label: 'Allowed extensions', type: 'text' },
  ],
}

export const ENGINES: Record<string, EngineDef> = {
  database: { type: 'database', label: 'Database', roleKinds: [DATABASE_ROLE, DATABASE_STATIC_ROLE] },
  aws: { type: 'aws', label: 'AWS', roleKinds: [AWS_ROLE] },
  ssh: { type: 'ssh', label: 'SSH', roleKinds: [SSH_ROLE] },
}

/** Engine types that are managed as plain secret stores or by the system, not as dynamic engines. */
const NOT_DYNAMIC = new Set(['kv', 'generic', 'cubbyhole', 'system', 'identity'])

/** Known engine definition, or a generic fallback (raw JSON roles) for any other dynamic engine type. */
export function engineFor(type: string): EngineDef {
  return ENGINES[type] ?? { type, label: type, roleKinds: [{ id: 'roles', label: 'Roles', path: 'roles', fields: [] }] }
}

export type MountKind = 'kv' | 'dynamic'

/** KV v2 mounts use the path-tree browser; every other non-system engine is treated as dynamic. */
export function mountKind(m: Mount): MountKind | null {
  if (isKvV2(m)) return 'kv'
  if (NOT_DYNAMIC.has(m.type)) return null
  return 'dynamic'
}
