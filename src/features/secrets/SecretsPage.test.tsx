import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { BaoClient } from '../../api/bao'
import * as ids from '../../api/identities'
import * as api from '../../api/secrets'
import { SessionProvider } from '../../api/session'
import { useSession } from '../../api/useSession'
import * as tokens from '../../api/tokens'
import { SecretsPage } from './SecretsPage'

vi.mock('../../api/identities')
vi.mock('../../api/secrets', async (orig) => ({ ...(await orig<typeof api>()), listKvMounts: vi.fn(), listSecrets: vi.fn(), readPolicyHcl: vi.fn() }))
vi.mock('../../api/tokens')

const client = new BaoClient('http://b', 't')

function Connected() {
  const { connect } = useSession()
  return (
    <button type="button" onClick={() => connect(client, { accessor: 'me', display_name: 'me', policies: [], ttl: 0, renewable: false })}>
      go
    </button>
  )
}

beforeEach(() => {
  vi.mocked(api.listKvMounts).mockResolvedValue([{ path: 'secret/' }])
  vi.mocked(api.listSecrets).mockImplementation(async (_c, _m, prefix) =>
    prefix === ''
      ? [{ name: 'app/', path: 'app/', isFolder: true }]
      : [{ name: 'db', path: 'app/db', isFolder: false }],
  )
  vi.mocked(ids.listUsers).mockResolvedValue([
    { name: 'alice', policies: ['app-rw'], ttl: 0 },
    { name: 'bob', policies: ['other'], ttl: 0 },
  ])
  vi.mocked(ids.listEntities).mockResolvedValue([])
  vi.mocked(ids.listGroups).mockResolvedValue([])
  vi.mocked(tokens.listTokens).mockResolvedValue([])
  vi.mocked(ids.listPolicyNames).mockResolvedValue(['app-rw', 'other'])
  vi.mocked(api.readPolicyHcl).mockImplementation(async (_c, n) =>
    n === 'app-rw' ? 'path "secret/data/app/*" { capabilities = ["read", "update"] }' : 'path "secret/data/zzz" { capabilities = ["read"] }',
  )
})
afterEach(() => vi.resetAllMocks())

test('navigates folders and shows who can reach a secret', async () => {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SessionProvider>
        <MemoryRouter>
          <Connected />
          <SecretsPage />
        </MemoryRouter>
      </SessionProvider>
    </QueryClientProvider>,
  )
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'go' }))
  await user.click(await screen.findByRole('button', { name: /app\// }))
  await user.click(await screen.findByRole('button', { name: /db/ }))

  const panel = await screen.findByRole('region', { name: 'Access' })
  const row = (await within(panel).findByText('alice')).closest('tr')!
  expect(within(row).getByText('app-rw')).toBeInTheDocument()
  expect(within(row).getByText('read')).toBeInTheDocument()
  expect(within(row).getByText('update')).toBeInTheDocument()
  expect(within(panel).queryByText('bob')).not.toBeInTheDocument()
  expect(within(panel).getByText('secret/data/app/db')).toBeInTheDocument()
})

test('asks to connect first', () => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <SessionProvider>
        <MemoryRouter>
          <SecretsPage />
        </MemoryRouter>
      </SessionProvider>
    </QueryClientProvider>,
  )
  expect(screen.getByText(/Not connected/)).toBeInTheDocument()
})
