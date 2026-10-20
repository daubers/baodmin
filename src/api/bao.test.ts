import { afterEach, describe, expect, test, vi } from 'vitest'
import { BaoClient, BaoError, normaliseBaseUrl } from './bao'

function mockFetch(status: number, body?: unknown) {
  const fn = vi.fn(async () =>
    status === 204
      ? new Response(null, { status })
      : new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }),
  )
  vi.stubGlobal('fetch', fn)
  return fn
}

afterEach(() => vi.unstubAllGlobals())

describe('normaliseBaseUrl', () => {
  test('strips trailing slashes', () => expect(normaliseBaseUrl(' http://x:8200// ')).toBe('http://x:8200'))
  test('rejects missing scheme', () => expect(() => normaliseBaseUrl('x:8200')).toThrow(BaoError))
})

describe('BaoClient', () => {
  test('sends token header and builds url', async () => {
    const fn = mockFetch(200, { data: { x: 1 } })
    await new BaoClient('http://b:8200/', 't0k').request('GET', '/sys/policies/acl')
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('http://b:8200/v1/sys/policies/acl')
    expect((init.headers as Record<string, string>)['X-Vault-Token']).toBe('t0k')
  })

  test('sends JSON body', async () => {
    const fn = mockFetch(204)
    await new BaoClient('http://b').request('POST', 'x', { a: 1 })
    const init = (fn.mock.calls[0] as unknown as [string, RequestInit])[1]
    expect(init.body).toBe('{"a":1}')
  })

  test('maps network failure to CORS guidance', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    await expect(new BaoClient('http://b').request('GET', 'x')).rejects.toMatchObject({
      kind: 'network',
      message: expect.stringContaining('CORS'),
    })
  })

  test.each([
    [401, 'auth'],
    [403, 'forbidden'],
    [404, 'not-found'],
    [500, 'server'],
  ])('maps HTTP %i to %s', async (status, kind) => {
    mockFetch(status, { errors: ['nope'] })
    await expect(new BaoClient('http://b').request('GET', 'x')).rejects.toMatchObject({ kind, status })
  })

  test('non-JSON success is a bad-response', async () => {
    mockFetch(200, '<html>')
    await expect(new BaoClient('http://b').request('GET', 'x')).rejects.toMatchObject({ kind: 'bad-response' })
  })

  test('list returns keys and treats 404 as empty', async () => {
    mockFetch(200, { data: { keys: ['a', 'b/'] } })
    expect(await new BaoClient('http://b').list('secret/metadata')).toEqual(['a', 'b/'])
    const fn = mockFetch(404, { errors: [] })
    expect(await new BaoClient('http://b').list('secret/metadata/')).toEqual([])
    expect((fn.mock.calls[0] as unknown as [string])[0]).toBe('http://b/v1/secret/metadata/?list=true')
  })

  test('loginUserpass returns token', async () => {
    const fn = mockFetch(200, { auth: { client_token: 'hvs.x', policies: ['default'], lease_duration: 60 } })
    const r = await new BaoClient('http://b').loginUserpass('al ice', 'pw')
    expect(r).toEqual({ token: 'hvs.x', policies: ['default'], leaseDuration: 60 })
    expect((fn.mock.calls[0] as unknown as [string])[0]).toBe('http://b/v1/auth/userpass/login/al%20ice')
  })
})
