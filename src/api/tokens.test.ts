import { expect, test, vi } from 'vitest'
import type { BaoClient } from './bao'
import { createToken } from './tokens'

function fakeClient() {
  const request = vi.fn().mockResolvedValue({ auth: { client_token: 's.x', accessor: 'a', policies: ['default'] } })
  return { client: { request } as unknown as BaoClient, request }
}

const base = { displayName: 'ci', renewable: true, orphan: false }

test('a token with no policies gets only the default policy, not its creator’s', async () => {
  const { client, request } = fakeClient()
  await createToken(client, { ...base, policies: [] })
  expect(request.mock.calls[0][2]).toMatchObject({ policies: ['default'] })
})

test('chosen policies are sent as they are', async () => {
  const { client, request } = fakeClient()
  await createToken(client, { ...base, policies: ['dev'] })
  expect(request.mock.calls[0][2]).toMatchObject({ policies: ['dev'] })
})
