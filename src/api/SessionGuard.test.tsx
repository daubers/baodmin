import { useQuery } from '@tanstack/react-query'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { Layout } from '../Layout'
import { Providers } from '../test/providers'
import { testQueryClient } from '../test/queryClient'
import { BaoClient, BaoError, type TokenInfo } from './bao'
import { SessionGuard } from './SessionGuard'
import { SessionProvider } from './session'
import { useSession } from './useSession'

const info = (ttl: number): TokenInfo => ({ accessor: 'a', display_name: 'me', policies: [], ttl, renewable: false })

function Harness({ client, ttl, failWith }: { client: BaoClient; ttl: number; failWith?: BaoError }) {
  const { connect, client: c } = useSession()
  useQuery({
    queryKey: ['probe'],
    queryFn: () => (failWith ? Promise.reject(failWith) : Promise.resolve('ok')),
    enabled: !!c,
  })
  return (
    <>
      <button type="button" onClick={() => connect(client, info(ttl))}>
        go
      </button>
    </>
  )
}

function setup(client: BaoClient, ttl = 0, failWith?: BaoError, qc = testQueryClient()) {
  render(
    <Providers client={qc}>
      <SessionProvider>
        <SessionGuard />
        <MemoryRouter>
          <Harness client={client} ttl={ttl} failWith={failWith} />
          <Layout />
        </MemoryRouter>
      </SessionProvider>
    </Providers>,
  )
}

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }))
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

test('the session ends when the token TTL elapses', async () => {
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  setup(new BaoClient('http://b', 't'), 60)
  await user.click(screen.getByRole('button', { name: 'go' }))
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  act(() => vi.advanceTimersByTime(61_000))
  expect(await screen.findByRole('alert')).toHaveTextContent('expired')
  expect(screen.getByRole('link', { name: 'Sign in again' })).toHaveAttribute('href', '/connect')
})

test('a token with no TTL never expires by timer', async () => {
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  setup(new BaoClient('http://b', 't'), 0)
  await user.click(screen.getByRole('button', { name: 'go' }))
  act(() => vi.advanceTimersByTime(10 * 365 * 86_400_000))
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

test('a 403 ends the session only if the token itself is dead', async () => {
  const client = new BaoClient('http://b', 't')
  const forbidden = new BaoError('forbidden', 'permission denied', 403)
  const lookup = vi.spyOn(client, 'lookupSelf').mockResolvedValue(info(0))
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  setup(client, 0, forbidden)
  await user.click(screen.getByRole('button', { name: 'go' }))
  await vi.waitFor(() => expect(lookup).toHaveBeenCalled())
  expect(screen.queryByRole('alert')).not.toBeInTheDocument() // token fine: just missing permission

  lookup.mockRejectedValue(forbidden)
  await act(() => vi.waitFor(() => expect(screen.queryByRole('alert')).toBeNull()))
})

test('a revoked token (lookup-self also 403) ends the session', async () => {
  const client = new BaoClient('http://b', 't')
  const forbidden = new BaoError('forbidden', 'permission denied', 403)
  vi.spyOn(client, 'lookupSelf').mockRejectedValue(forbidden)
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  setup(client, 0, forbidden)
  await user.click(screen.getByRole('button', { name: 'go' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('expired or the token was revoked')
})

test('a 503 from a sealed OpenBao ends the session with a sealed notice', async () => {
  const client = new BaoClient('http://b', 't')
  vi.spyOn(client, 'health').mockResolvedValue({ initialized: true, sealed: true, standby: false, version: '2' })
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  setup(client, 0, new BaoError('unavailable', 'OpenBao is sealed or unavailable.', 503))
  await user.click(screen.getByRole('button', { name: 'go' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('sealed')
})

test('a 503 from an unsealed OpenBao keeps the session', async () => {
  const client = new BaoClient('http://b', 't')
  const health = vi.spyOn(client, 'health').mockResolvedValue({ initialized: true, sealed: false, standby: true, version: '2' })
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  setup(client, 0, new BaoError('unavailable', 'x', 503))
  await user.click(screen.getByRole('button', { name: 'go' }))
  await vi.waitFor(() => expect(health).toHaveBeenCalled())
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

test('ending the session clears cached OpenBao data', async () => {
  const qc = testQueryClient()
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  setup(new BaoClient('http://b', 't'), 60, undefined, qc)
  await user.click(screen.getByRole('button', { name: 'go' }))
  await vi.waitFor(() => expect(qc.getQueryData(['probe'])).toBe('ok'))
  act(() => vi.advanceTimersByTime(61_000))
  await vi.waitFor(() => expect(qc.getQueryData(['probe'])).toBeUndefined())
})
