import { describe, expect, test } from 'vitest'
import { BaoClient } from './bao'
import * as api from './tokens'

const client = new BaoClient(process.env.BAO_ADDR ?? 'http://127.0.0.1:8200', process.env.BAO_TOKEN ?? 'root')

describe('token API against a dev OpenBao', () => {
  test('create, authenticate, list, revoke', async () => {
    const created = await api.createToken(client, {
      displayName: 'it-token',
      policies: ['default', 'it-extra'],
      ttl: '1h',
      renewable: false,
      orphan: false,
    })
    expect(created.token).toBeTruthy()

    // the new token authenticates with the chosen policies
    const self = await client.withToken(created.token).lookupSelf()
    expect(self.policies.sort()).toEqual(['default', 'it-extra'])
    expect(self.display_name).toBe('token-it-token')
    expect(self.renewable).toBe(false)

    const listed = await api.listTokens(client)
    expect(listed.find((t) => t.accessor === created.accessor)).toMatchObject({ display_name: 'token-it-token' })

    await api.revokeToken(client, created.accessor)
    await expect(client.withToken(created.token).lookupSelf()).rejects.toMatchObject({ kind: 'forbidden' })
    expect((await api.listTokens(client)).some((t) => t.accessor === created.accessor)).toBe(false)
  })

  test('orphan tokens survive revocation of their parent', async () => {
    const parent = await api.createToken(client, {
      displayName: 'it-parent',
      policies: ['root'],
      renewable: true,
      orphan: false,
    })
    const parentClient = client.withToken(parent.token)
    const child = await api.createToken(parentClient, {
      displayName: 'it-orphan',
      policies: ['default'],
      renewable: false,
      orphan: true,
    })
    const plain = await api.createToken(parentClient, {
      displayName: 'it-child',
      policies: ['default'],
      renewable: false,
      orphan: false,
    })
    await api.revokeToken(client, parent.accessor)
    expect((await client.withToken(child.token).lookupSelf()).policies).toContain('default')
    await expect(client.withToken(plain.token).lookupSelf()).rejects.toMatchObject({ kind: 'forbidden' })
    await api.revokeToken(client, child.accessor)
  })
})
