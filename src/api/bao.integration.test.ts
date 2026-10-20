import { describe, expect, test } from 'vitest'
import { BaoClient } from './bao'

const addr = process.env.BAO_ADDR ?? 'http://127.0.0.1:8200'
const token = process.env.BAO_TOKEN ?? 'root'

describe('BaoClient against a dev OpenBao', () => {
  const client = new BaoClient(addr, token)

  test('health', async () => {
    const h = await client.health()
    expect(h.initialized).toBe(true)
    expect(h.sealed).toBe(false)
  })

  test('lookupSelf with root token', async () => {
    expect((await client.lookupSelf()).policies).toContain('root')
  })

  test('bad token is a forbidden error', async () => {
    await expect(client.withToken('nope').lookupSelf()).rejects.toMatchObject({ kind: 'forbidden' })
  })

  test('list of missing path is empty', async () => {
    expect(await client.list('secret/metadata/does-not-exist')).toEqual([])
  })
})
