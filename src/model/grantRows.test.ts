import { expect, test } from 'vitest'
import { groupGrants } from './grantRows'

test('folds a KV data rule and its metadata rule into one row', () => {
  const rows = groupGrants(
    [
      { path: 'secret/data/team-a/*', capabilities: ['read', 'update'] },
      { path: 'secret/metadata/team-a/*', capabilities: ['list'] },
    ],
    ['secret/'],
  )
  expect(rows).toEqual([
    {
      display: 'secret/team-a/*',
      wildcard: true,
      capabilities: ['read', 'update', 'list'],
      paths: ['secret/data/team-a/*', 'secret/metadata/team-a/*'],
    },
  ])
})

test('a secret with only a data rule is one row', () => {
  const [row] = groupGrants([{ path: 'secret/data/app/db', capabilities: ['read'] }], ['secret/'])
  expect(row).toMatchObject({ display: 'secret/app/db', wildcard: false, paths: ['secret/data/app/db'] })
})

test('paths outside a known KV mount keep their raw path', () => {
  const [row] = groupGrants([{ path: 'sys/health', capabilities: ['read'] }], ['secret/'])
  expect(row).toMatchObject({ display: 'sys/health', paths: ['sys/health'] })
})

test('keeps different secrets and mounts apart', () => {
  const rows = groupGrants(
    [
      { path: 'secret/data/a', capabilities: ['read'] },
      { path: 'kv/data/a', capabilities: ['read'] },
    ],
    ['secret/', 'kv/'],
  )
  expect(rows.map((r) => r.display)).toEqual(['secret/a', 'kv/a'])
})
