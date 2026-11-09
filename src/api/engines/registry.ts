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
  /** Write-only value (password, private key). Never prefilled; left blank it is omitted so the stored value is kept. */
  | 'secret'

export interface FieldDef {
  key: string
  label: string
  type: FieldType
  required?: boolean
  options?: string[]
  help?: string
  /** Render as a textarea (secret fields such as PEM keys). */
  multiline?: boolean
}

/** How to ask OpenBao for credentials (or a signed certificate) for a role. */
export interface CredKind {
  id: string
  label: string
  /** Path relative to the mount for a given role name. */
  path: (role: string) => string
  method: 'GET' | 'POST'
  /** Request parameters; only sent for POST. */
  inputs: FieldDef[]
}

/** A one-off call on a config, e.g. rotating the root credentials. */
export interface ActionDef {
  id: string
  label: string
  /** Path relative to the mount; "{name}" is replaced with the config name for named configs. */
  path: string
  body?: Record<string, unknown>
  confirm: { title: string; message: string; confirmLabel: string }
}

/** Engine configuration: a named list (database connections) or a single endpoint (aws root, ssh CA). */
export interface ConfigKind {
  id: string
  label: string
  /** Path relative to the mount; for named configs the name is appended. */
  path: string
  named: boolean
  fields: FieldDef[]
  /** Reads put these under a nested key (database: connection_details); merged into the form values. */
  nested?: string
  /** Read-only values to display after loading, e.g. the SSH CA public key. */
  shown?: { key: string; label: string }[]
  actions?: ActionDef[]
  deletable?: boolean
  /** Part of the error OpenBao returns when nothing is configured yet, for engines that don't answer 404. */
  unsetMessage?: string
}

/** One family of roles under a mount, e.g. database "roles" and "static-roles". */
export interface RoleKind {
  id: string
  label: string
  /** Path relative to the mount that roles are listed and written under. */
  path: string
  /** Empty means the role is edited as raw JSON (generic engines). */
  fields: FieldDef[]
  /** Ways to get credentials for a role of this kind. */
  creds: CredKind[]
}

/** Describes a dynamic secrets engine the UI can manage. Grows in later phases (creds, config). */
export interface EngineDef {
  /** Engine type as reported by sys/mounts. */
  type: string
  label: string
  roleKinds: RoleKind[]
  configs: ConfigKind[]
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
  creds: [{ id: 'creds', label: 'Generate credentials', path: (r) => `creds/${encodeURIComponent(r)}`, method: 'GET', inputs: [] }],
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
  creds: [
    { id: 'static-creds', label: 'Read current credentials', path: (r) => `static-creds/${encodeURIComponent(r)}`, method: 'GET', inputs: [] },
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
  creds: [
    {
      id: 'creds',
      label: 'Generate credentials',
      path: (r) => `creds/${encodeURIComponent(r)}`,
      method: 'POST',
      inputs: [
        { key: 'ttl', label: 'TTL', type: 'ttl', help: 'For STS credentials.' },
        { key: 'role_arn', label: 'Role ARN', type: 'text', help: 'Only when the role allows several.' },
      ],
    },
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
  creds: [
    {
      id: 'sign',
      label: 'Sign a public key (CA)',
      path: (r) => `sign/${encodeURIComponent(r)}`,
      method: 'POST',
      inputs: [
        { key: 'public_key', label: 'Public key', type: 'textarea', required: true },
        { key: 'valid_principals', label: 'Valid principals', type: 'text', help: 'Comma separated.' },
        { key: 'ttl', label: 'TTL', type: 'ttl' },
        { key: 'cert_type', label: 'Certificate type', type: 'select', options: ['user', 'host'] },
      ],
    },
    {
      id: 'otp',
      label: 'Generate an OTP',
      path: (r) => `creds/${encodeURIComponent(r)}`,
      method: 'POST',
      inputs: [
        { key: 'ip', label: 'Target IP', type: 'text', required: true },
        { key: 'username', label: 'Username', type: 'text' },
      ],
    },
  ],
}

const DATABASE_CONNECTION: ConfigKind = {
  id: 'connections',
  label: 'Connections',
  path: 'config',
  named: true,
  nested: 'connection_details',
  deletable: true,
  fields: [
    {
      key: 'plugin_name',
      label: 'Plugin',
      type: 'select',
      required: true,
      options: ['postgresql-database-plugin', 'mysql-database-plugin', 'mongodb-database-plugin', 'mssql-database-plugin'],
    },
    {
      key: 'connection_url',
      label: 'Connection URL',
      type: 'text',
      required: true,
      help: 'e.g. postgresql://{{username}}:{{password}}@db:5432/app',
    },
    { key: 'allowed_roles', label: 'Allowed roles', type: 'list', help: 'Role names, or * for any.' },
    { key: 'username', label: 'Admin username', type: 'text' },
    { key: 'password', label: 'Admin password', type: 'secret' },
    { key: 'verify_connection', label: 'Verify the connection when saving', type: 'bool' },
  ],
  actions: [
    {
      id: 'rotate-root',
      label: 'Rotate root credentials',
      path: 'rotate-root/{name}',
      confirm: {
        title: 'Rotate the root credentials?',
        message: 'OpenBao will change the admin password, and only OpenBao will know the new one.',
        confirmLabel: 'Rotate',
      },
    },
    {
      id: 'reset',
      label: 'Reset connection',
      path: 'reset/{name}',
      confirm: { title: 'Reset the connection?', message: 'The plugin connection is closed and reopened.', confirmLabel: 'Reset' },
    },
  ],
}

const AWS_ROOT: ConfigKind = {
  id: 'root',
  label: 'Root credentials',
  path: 'config/root',
  named: false,
  fields: [
    { key: 'access_key', label: 'Access key', type: 'text' },
    { key: 'secret_key', label: 'Secret key', type: 'secret' },
    { key: 'region', label: 'Region', type: 'text' },
    { key: 'iam_endpoint', label: 'IAM endpoint', type: 'text' },
    { key: 'sts_endpoint', label: 'STS endpoint', type: 'text' },
  ],
  actions: [
    {
      id: 'rotate-root',
      label: 'Rotate root credentials',
      path: 'config/rotate-root',
      confirm: {
        title: 'Rotate the root access key?',
        message: 'OpenBao will create a new access key and delete the old one.',
        confirmLabel: 'Rotate',
      },
    },
  ],
}

const AWS_LEASE: ConfigKind = {
  id: 'lease',
  label: 'Lease',
  path: 'config/lease',
  named: false,
  fields: [
    { key: 'lease', label: 'Default lease', type: 'ttl' },
    { key: 'lease_max', label: 'Max lease', type: 'ttl' },
  ],
}

const SSH_CA: ConfigKind = {
  id: 'ca',
  label: 'Signing CA',
  path: 'config/ca',
  named: false,
  deletable: true,
  unsetMessage: 'no default issuer',
  fields: [
    { key: 'public_key', label: 'Public key', type: 'textarea', help: 'Import a key pair, or generate one below.' },
    { key: 'private_key', label: 'Private key', type: 'secret', multiline: true },
  ],
  shown: [{ key: 'public_key', label: 'Current CA public key' }],
  actions: [
    {
      id: 'generate',
      label: 'Generate signing key',
      path: 'config/ca',
      body: { generate_signing_key: true },
      confirm: {
        title: 'Generate a new signing key?',
        message: 'This replaces any existing CA, so certificates signed by the old key stop being trusted.',
        confirmLabel: 'Generate',
      },
    },
  ],
}

export const ENGINES: Record<string, EngineDef> = {
  database: { type: 'database', label: 'Database', roleKinds: [DATABASE_ROLE, DATABASE_STATIC_ROLE], configs: [DATABASE_CONNECTION] },
  aws: { type: 'aws', label: 'AWS', roleKinds: [AWS_ROLE], configs: [AWS_ROOT, AWS_LEASE] },
  ssh: { type: 'ssh', label: 'SSH', roleKinds: [SSH_ROLE], configs: [SSH_CA] },
}

/** Engine types that are managed as plain secret stores or by the system, not as dynamic engines. */
const NOT_DYNAMIC = new Set(['kv', 'generic', 'cubbyhole', 'system', 'identity'])

/** Known engine definition, or a generic fallback (raw JSON roles) for any other dynamic engine type. */
export function engineFor(type: string): EngineDef {
  return (
    ENGINES[type] ?? {
      type,
      label: type,
      roleKinds: [{ id: 'roles', label: 'Roles', path: 'roles', fields: [], creds: [] }],
      configs: [],
    }
  )
}

export type MountKind = 'kv' | 'dynamic'

/** KV v2 mounts use the path-tree browser; every other non-system engine is treated as dynamic. */
export function mountKind(m: Mount): MountKind | null {
  if (isKvV2(m)) return 'kv'
  if (NOT_DYNAMIC.has(m.type)) return null
  return 'dynamic'
}
