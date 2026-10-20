import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import { SessionProvider } from '../../api/session'
import { ConnectPage } from './ConnectPage'

const health = { initialized: true, sealed: false, standby: false, version: '2.1.0' }
const tokenInfo = { accessor: 'a', display_name: 'root', policies: ['root'], ttl: 0, renewable: false }

afterEach(() => vi.unstubAllGlobals())

function setup() {
  render(
    <SessionProvider>
      <ConnectPage />
    </SessionProvider>,
  )
  return userEvent.setup()
}

test('connects with a token', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      new Response(JSON.stringify(url.includes('sys/health') ? health : { data: tokenInfo }), { status: 200 }),
    ),
  )
  const user = setup()
  await user.type(screen.getByLabelText('Token', { selector: 'input[type=password]' }), 'root')
  await user.click(screen.getByRole('button', { name: 'Connect' }))
  expect(await screen.findByRole('status')).toHaveTextContent('Connected to http://127.0.0.1:8200 as root')
})

test('shows CORS guidance when unreachable', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
  const user = setup()
  await user.type(screen.getByLabelText('Token', { selector: 'input[type=password]' }), 'x')
  await user.click(screen.getByRole('button', { name: 'Connect' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('CORS')
})

test('shows invalid token error', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      url.includes('sys/health')
        ? new Response(JSON.stringify(health), { status: 200 })
        : new Response(JSON.stringify({ errors: ['permission denied'] }), { status: 403 }),
    ),
  )
  const user = setup()
  await user.type(screen.getByLabelText('Token', { selector: 'input[type=password]' }), 'bad')
  await user.click(screen.getByRole('button', { name: 'Connect' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('permission denied')
})

test('refuses a sealed server', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ...health, sealed: true }), { status: 200 })))
  const user = setup()
  await user.type(screen.getByLabelText('Token', { selector: 'input[type=password]' }), 'x')
  await user.click(screen.getByRole('button', { name: 'Connect' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('sealed')
})
