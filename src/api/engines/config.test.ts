import { expect, test, vi } from 'vitest'
import { BaoClient, BaoError } from '../bao'
import { deleteConfig, listConfigs, readConfig, runAction, writeConfig } from './config'
import { generateCreds } from './creds'
import { revokeLease } from './leases'
import { ENGINES } from './registry'
import { draftFromRole, emptyDraft, payloadFromDraft } from './roles'

const conn = ENGINES.database.configs[0]
const aws = ENGINES.aws.configs[0]
const awsCreds = ENGINES.aws.roleKinds[0].creds[0]

test('named configs are addressed by name and flatten connection_details', async () => {
  const c = new BaoClient('http://b', 't')
  const req = vi.spyOn(c, 'request').mockResolvedValue({
    data: { plugin_name: 'postgresql-database-plugin', allowed_roles: ['ro'], connection_details: { connection_url: 'postgresql://x', username: 'bao' } },
  })
  vi.spyOn(c, 'list').mockResolvedValue(['b', 'a'])

  expect(await listConfigs(c, 'database/', conn)).toEqual(['a', 'b'])
  expect(await readConfig(c, 'database/', conn, 'my pg')).toMatchObject({ plugin_name: 'postgresql-database-plugin', connection_url: 'postgresql://x', username: 'bao' })
  expect(req).toHaveBeenCalledWith('GET', 'database/config/my%20pg')
  await writeConfig(c, 'database/', conn, { a: 1 }, 'pg')
  expect(req).toHaveBeenCalledWith('POST', 'database/config/pg', { a: 1 })
  await deleteConfig(c, 'database/', conn, 'pg')
  expect(req).toHaveBeenCalledWith('DELETE', 'database/config/pg')
  await runAction(c, 'database/', conn.actions![0], 'pg')
  expect(req).toHaveBeenCalledWith('POST', 'database/rotate-root/pg', {})
})

test('single configs use the bare path and read as null when unconfigured', async () => {
  const c = new BaoClient('http://b', 't')
  const req = vi.spyOn(c, 'request').mockRejectedValue(new BaoError('not-found', 'nope', 404))
  expect(await readConfig(c, 'aws/', aws)).toBeNull()
  expect(req).toHaveBeenCalledWith('GET', 'aws/config/root')
  req.mockRejectedValue(new BaoError('forbidden', 'denied', 403))
  await expect(readConfig(c, 'aws/', aws)).rejects.toThrow('denied')
})

test('an engine that errors instead of 404ing reads as unconfigured only for its own message', async () => {
  const c = new BaoClient('http://b', 't')
  const ca = ENGINES.ssh.configs[0]
  const req = vi.spyOn(c, 'request').mockRejectedValue(new BaoError('server', 'No default issuer currently configured', 400))
  expect(await readConfig(c, 'ssh/', ca)).toBeNull()
  req.mockRejectedValue(new BaoError('server', 'something else', 500))
  await expect(readConfig(c, 'ssh/', ca)).rejects.toThrow('something else')
  req.mockRejectedValue(new BaoError('server', 'No default issuer currently configured', 400))
  await expect(readConfig(c, 'aws/', aws)).rejects.toThrow('No default issuer')
})

test('secret fields are never prefilled and are omitted when left blank', () => {
  const draft = draftFromRole(conn, 'pg', { plugin_name: 'postgresql-database-plugin', connection_url: 'postgresql://x', username: 'bao', password: 'leaked' })
  expect(draft.values.password).toBe('')
  expect(payloadFromDraft(conn, draft)).not.toHaveProperty('password')
  draft.values.password = 's3cret'
  expect(payloadFromDraft(conn, draft)).toMatchObject({ password: 's3cret' })
  expect(emptyDraft(conn).values.password).toBe('')
})

test('credential requests: POST sends inputs, result is normalised', async () => {
  const c = new BaoClient('http://b', 't')
  const req = vi.spyOn(c, 'request').mockResolvedValue({
    lease_id: 'aws/creds/ci/abc',
    lease_duration: 3600,
    renewable: true,
    data: { access_key: 'AK', secret_key: 'SK' },
    warnings: null,
  })
  const creds = await generateCreds(c, 'aws/', awsCreds, 'ci', { ttl: '1h' })
  expect(req).toHaveBeenCalledWith('POST', 'aws/creds/ci', { ttl: '1h' })
  expect(creds).toEqual({ leaseId: 'aws/creds/ci/abc', leaseDuration: 3600, renewable: true, data: { access_key: 'AK', secret_key: 'SK' }, warnings: [] })

  const dbCreds = ENGINES.database.roleKinds[0].creds[0]
  await generateCreds(c, 'database/', dbCreds, 'ro', { ignored: true })
  expect(req).toHaveBeenLastCalledWith('GET', 'database/creds/ro', undefined)
})

test('revoking a lease', async () => {
  const c = new BaoClient('http://b', 't')
  const req = vi.spyOn(c, 'request').mockResolvedValue(undefined)
  await revokeLease(c, 'database/creds/ro/xyz')
  expect(req).toHaveBeenCalledWith('PUT', 'sys/leases/revoke', { lease_id: 'database/creds/ro/xyz' })
})
