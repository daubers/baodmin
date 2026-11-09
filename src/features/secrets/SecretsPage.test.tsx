import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { BaoClient } from '../../api/bao'
import * as grants from '../../api/grants'
import * as ids from '../../api/identities'
import * as api from '../../api/secrets'
import { SessionProvider } from '../../api/session'
import { useSession } from '../../api/useSession'
import * as tokens from '../../api/tokens'
import { SecretsPage } from './SecretsPage'

vi.mock('../../api/grants')
vi.mock('../../api/identities')
vi.mock('../../api/secrets', async (orig) => ({ ...(await orig<typeof api>()), listMounts: vi.fn(), listSecrets: vi.fn(), readPolicyHcl: vi.fn() }))
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
  vi.mocked(api.listMounts).mockResolvedValue([{ path: 'secret/', type: 'kv', version: '2' }])
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

async function openSecret() {
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
  await user.click(await screen.findByRole('button', { name: 'Grant access' }))
  return user
}

test('grants an identity access to the open secret', async () => {
  vi.mocked(grants.grantAccess).mockResolvedValue()
  const user = await openSecret()
  await user.selectOptions(screen.getByLabelText('Who'), 'bob')
  await user.click(screen.getByLabelText('update'))
  await user.click(screen.getByRole('button', { name: 'Grant' }))

  expect(grants.grantAccess).toHaveBeenCalledWith(client, { kind: 'user', name: 'bob' }, [
    { path: 'secret/data/app/db', capabilities: ['read', 'update'] },
    { path: 'secret/metadata/app/db', capabilities: [] },
  ])
  expect(await screen.findByRole('status')).toHaveTextContent('Granted read, update on secret/app/db to user “bob”.')
  expect(screen.queryByRole('form', { name: 'Grant access to this secret' })).not.toBeInTheDocument()
})

test('can grant the whole folder instead of just the secret', async () => {
  vi.mocked(grants.grantAccess).mockResolvedValue()
  const user = await openSecret()
  await user.click(screen.getByLabelText(/Everything in/))
  await user.click(screen.getByRole('button', { name: 'Grant' }))
  expect(grants.grantAccess).toHaveBeenCalledWith(client, { kind: 'user', name: 'alice' }, [
    { path: 'secret/data/app/*', capabilities: ['read'] },
    { path: 'secret/metadata/app/*', capabilities: [] },
  ])
})

test('shows why a grant failed and keeps the form open', async () => {
  vi.mocked(grants.grantAccess).mockRejectedValue(new Error('Policy "envbao-user-alice" was edited outside EnvBao'))
  const user = await openSecret()
  await user.click(screen.getByRole('button', { name: 'Grant' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('edited outside EnvBao')
  expect(screen.getByRole('form', { name: 'Grant access to this secret' })).toBeInTheDocument()
})

test('groups mounts by engine and shows the engine view for a dynamic mount', async () => {
  vi.mocked(api.listMounts).mockResolvedValue([
    { path: 'database/', type: 'database' },
    { path: 'secret/', type: 'kv', version: '2' },
    { path: 'cubbyhole/', type: 'cubbyhole' },
  ])
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
  const select = await screen.findByLabelText('Mount')
  expect(within(select).getByRole('group', { name: 'KV' })).toBeInTheDocument()
  expect(within(select).getByRole('group', { name: 'Database' })).toBeInTheDocument()
  expect(within(select).queryByText('cubbyhole/')).not.toBeInTheDocument()

  await user.selectOptions(select, 'database/')
  expect(await screen.findByText(/Database engine at database\//)).toBeInTheDocument()
  expect(api.listSecrets).not.toHaveBeenCalled()
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
