import type { DraftValue } from '../api/engines/roles'

/**
 * A Postgres for the database-engine integration tests, from BAO_PG_URL, e.g.
 * postgresql://postgres:secret@postgres:5432/app?sslmode=disable. The host must be reachable from OpenBao (not
 * necessarily from the test process). The user needs CREATEROLE. Returns null when unset, so tests can skip.
 */
export function pgTarget(): { values: Record<string, DraftValue>; creationStatements: string } | null {
  const raw = process.env.BAO_PG_URL
  if (!raw) return null
  const u = new URL(raw)
  const db = u.pathname.slice(1)
  return {
    values: {
      plugin_name: 'postgresql-database-plugin',
      // OpenBao substitutes the admin login into the template, so the password never sits in the URL it stores.
      connection_url: `${u.protocol}//{{username}}:{{password}}@${u.host}${u.pathname}${u.search}`,
      allowed_roles: '*',
      username: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      verify_connection: true,
    },
    // Two statements separated by a blank line, which is how the form takes them.
    creationStatements: [
      `CREATE ROLE "{{name}}" WITH LOGIN PASSWORD '{{password}}' VALID UNTIL '{{expiration}}';`,
      `GRANT CONNECT ON DATABASE "${db}" TO "{{name}}";`,
    ].join('\n\n'),
  }
}
