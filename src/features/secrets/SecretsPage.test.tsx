import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { BaoClient } from '../../api/bao'
import * as grants from '../../api/grants'
import * as ids from '../../api/identities'
import * as mountsApi from '../../api/mounts'
import * as api from '../../api/secrets'
import { SessionProvider } from '../../api/session'
import { useSession } from '../../api/useSession'
import * as tokens from '../../api/tokens'
import { SecretsPage } from './SecretsPage'

vi.mock('../../api/grants')
vi.mock('../../api/identities')
vi.mock('../../api/secrets', async (orig) => ({ ...(await orig<typeof api>()), listMounts: vi.fn(), listSecrets: vi.fn(), readPolicyHcl: vi.fn() }))
vi.mock('../../api/tokens')
vi.mock('../../api/mounts', async (orig) => ({ ...(await orig<typeof mountsApi>()), createMount: vi.fn(), tuneMount: vi.fn(), readKvConfig: vi.fn(), deleteMount: vi.fn(), mountImpact: vi.fn() }))

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
  vi.spyOn(BaoClient.prototype, 'list').mockResolvedValue([])
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
  const select = await screen.findByLabelText('Secrets engine')
  expect(within(select).getByRole('group', { name: 'KV' })).toBeInTheDocument()
  expect(within(select).getByRole('group', { name: 'Database' })).toBeInTheDocument()
  expect(within(select).queryByText('cubbyhole/')).not.toBeInTheDocument()

  await user.selectOptions(select, 'database/')
  expect(await screen.findByRole('heading', { name: /Database · database\// })).toBeInTheDocument()
  expect(await screen.findByRole('button', { name: 'New role' })).toBeInTheDocument()
  expect(api.listSecrets).not.toHaveBeenCalled()
})

async function openPage() {
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
  return user
}

test('a server with no engines can still create its first one', async () => {
  vi.mocked(api.listMounts).mockResolvedValue([])
  vi.mocked(mountsApi.createMount).mockResolvedValue()
  const user = await openPage()
  expect(await screen.findByText('No secrets engines are mounted.')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'New secrets engine' }))
  await user.type(screen.getByRole('textbox', { name: 'Path' }), 'secret')
  vi.mocked(api.listMounts).mockResolvedValue([{ path: 'secret/', type: 'kv', version: '2' }])
  await user.click(screen.getByRole('button', { name: 'Create' }))
  expect(mountsApi.createMount).toHaveBeenCalled()
  expect(await screen.findByRole('navigation', { name: 'Path' })).toBeInTheDocument()
  expect(screen.queryByRole('region', { name: 'New secrets engine' })).not.toBeInTheDocument()
})

test('creating an engine selects it', async () => {
  vi.mocked(mountsApi.createMount).mockResolvedValue()
  const user = await openPage()
  await user.click(await screen.findByRole('button', { name: 'New secrets engine' }))
  await user.selectOptions(screen.getByLabelText('Type'), 'ssh')
  await user.type(screen.getByRole('textbox', { name: 'Path' }), 'hosts')
  vi.mocked(api.listMounts).mockResolvedValue([
    { path: 'secret/', type: 'kv', version: '2' },
    { path: 'hosts/', type: 'ssh' },
  ])
  vi.spyOn(BaoClient.prototype, 'list').mockResolvedValue([])
  await user.click(screen.getByRole('button', { name: 'Create' }))
  expect(await screen.findByRole('heading', { name: /SSH · hosts\// })).toBeInTheDocument()
  expect(screen.getByLabelText('Secrets engine')).toHaveValue('hosts/')
})

test('Settings opens the selected mount\'s settings, and toggles closed', async () => {
  vi.mocked(mountsApi.readKvConfig).mockResolvedValue({ max_versions: 0, cas_required: false, delete_version_after: '0s' })
  const user = await openPage()
  await user.click(await screen.findByRole('button', { name: 'Settings' }))
  expect(await screen.findByRole('region', { name: 'Settings for secret/' })).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Settings' }))
  expect(screen.queryByRole('region', { name: 'Settings for secret/' })).not.toBeInTheDocument()
})

test('deleting the selected engine falls back to another', async () => {
  vi.mocked(api.listMounts).mockResolvedValue([
    { path: 'secret/', type: 'kv', version: '2' },
    { path: 'hosts/', type: 'ssh' },
  ])
  vi.mocked(mountsApi.mountImpact).mockResolvedValue({ kind: 'dynamic', roles: 0, hasLeases: false, unknown: [] })
  vi.mocked(mountsApi.deleteMount).mockResolvedValue()
  vi.spyOn(BaoClient.prototype, 'list').mockResolvedValue([])
  const user = await openPage()
  await user.selectOptions(await screen.findByLabelText('Secrets engine'), 'hosts/')
  await user.click(screen.getByRole('button', { name: 'Delete' }))
  expect(await screen.findByRole('alertdialog', { name: 'Delete hosts/' })).toBeInTheDocument()
  vi.mocked(api.listMounts).mockResolvedValue([{ path: 'secret/', type: 'kv', version: '2' }])
  await user.type(screen.getByLabelText(/Type/), 'hosts')
  await user.click(screen.getByRole('button', { name: 'Delete forever' }))
  expect(mountsApi.deleteMount).toHaveBeenCalledWith(client, 'hosts/')
  expect(await screen.findByRole('button', { name: 'secret/' })).toBeInTheDocument()
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
})

test('switching mounts closes an open delete panel', async () => {
  vi.mocked(api.listMounts).mockResolvedValue([
    { path: 'secret/', type: 'kv', version: '2' },
    { path: 'hosts/', type: 'ssh' },
  ])
  vi.mocked(mountsApi.mountImpact).mockResolvedValue({ kind: 'kv', topLevelEntries: 0, unknown: [] })
  vi.spyOn(BaoClient.prototype, 'list').mockResolvedValue([])
  const user = await openPage()
  await user.click(await screen.findByRole('button', { name: 'Delete' }))
  expect(await screen.findByRole('alertdialog', { name: 'Delete secret/' })).toBeInTheDocument()
  await user.selectOptions(screen.getByLabelText('Secrets engine'), 'hosts/')
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
})

test('lays out New, then the labelled engine picker with Settings and Delete, then the breadcrumbs', async () => {
  await openPage()
  const newButton = await screen.findByRole('button', { name: 'New secrets engine' })
  const select = screen.getByLabelText('Secrets engine') // a single engine still gets its picker, so the bar looks the same
  const settings = screen.getByRole('button', { name: 'Settings' })
  const del = screen.getByRole('button', { name: 'Delete' })
  const crumbs = screen.getByRole('navigation', { name: 'Path' })

  // Settings and Delete share the picker's line
  const bar = select.closest('.mount-bar')!
  expect(bar).toContainElement(settings)
  expect(bar).toContainElement(del)
  expect(bar).not.toContainElement(newButton)
  expect(bar).not.toContainElement(crumbs)

  // top to bottom: New, the bar, then the breadcrumbs
  const before = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
  expect(before(newButton, select)).toBe(true)
  expect(before(bar, crumbs)).toBe(true)
  expect(screen.getByRole('button', { name: 'secret/' }).closest('nav')).toBe(crumbs)
})

test('a dynamic engine uses the full width, with the same header', async () => {
  vi.mocked(api.listMounts).mockResolvedValue([{ path: 'hosts/', type: 'ssh' }])
  vi.spyOn(BaoClient.prototype, 'list').mockResolvedValue([])
  await openPage()
  expect(await screen.findByLabelText('Secrets engine')).toHaveValue('hosts/')
  expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument()
  expect(screen.queryByRole('navigation', { name: 'Path' })).not.toBeInTheDocument()
  expect(document.querySelector('.secrets-layout')).toBeNull()
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
