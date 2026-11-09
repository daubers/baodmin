import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { BaoClient } from '../../api/bao'
import { ENGINES } from '../../api/engines/registry'
import * as grants from '../../api/grants'
import * as ids from '../../api/identities'
import * as secrets from '../../api/secrets'
import * as tokens from '../../api/tokens'
import { RoleAccessPanel } from './RoleAccessPanel'

vi.mock('../../api/grants')
vi.mock('../../api/identities')
vi.mock('../../api/secrets', async (orig) => ({ ...(await orig<typeof secrets>()), readPolicyHcl: vi.fn() }))
vi.mock('../../api/tokens')

const client = new BaoClient('http://b', 't')
const kind = ENGINES.database.roleKinds[0]

beforeEach(() => {
  vi.mocked(ids.listUsers).mockResolvedValue([
    { name: 'alice', policies: ['db-ro'], ttl: 0 },
    { name: 'bob', policies: ['other'], ttl: 0 },
  ])
  vi.mocked(ids.listEntities).mockResolvedValue([])
  vi.mocked(ids.listGroups).mockResolvedValue([])
  vi.mocked(tokens.listTokens).mockResolvedValue([])
  vi.mocked(ids.listPolicyNames).mockResolvedValue(['db-ro', 'other'])
  vi.mocked(secrets.readPolicyHcl).mockImplementation(async (_c, n) =>
    n === 'db-ro' ? 'path "database/creds/*" { capabilities = ["read"] }' : 'path "secret/data/x" { capabilities = ["read"] }',
  )
})
afterEach(() => vi.resetAllMocks())

function setup() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RoleAccessPanel client={client} mount="database/" kind={kind} role="ro" onClose={() => {}} />
    </QueryClientProvider>,
  )
  return userEvent.setup()
}

test('shows who can generate credentials from the role', async () => {
  setup()
  const table = await screen.findByRole('table', { name: 'Who can: Generate credentials' })
  const row = within(table).getByText('alice').closest('tr')!
  expect(within(row).getByText('db-ro')).toBeInTheDocument()
  expect(within(row).getByText('read')).toBeInTheDocument()
  expect(within(table).queryByText('bob')).not.toBeInTheDocument()
  expect(screen.getByText('No identity can manage this role.')).toBeInTheDocument()
})

test('grants generate on one role', async () => {
  vi.mocked(grants.grantAccess).mockResolvedValue()
  const user = setup()
  await user.click(await screen.findByRole('button', { name: 'Grant access' }))
  await user.selectOptions(screen.getByLabelText('Who'), 'bob')
  await user.click(screen.getByRole('button', { name: 'Grant' }))
  expect(grants.grantAccess).toHaveBeenCalledWith(client, { kind: 'user', name: 'bob' }, [
    { path: 'database/creds/ro', capabilities: ['read'] },
    { path: 'database/roles/ro', capabilities: [] },
  ])
  expect(await screen.findByRole('status')).toHaveTextContent('Granted generate credentials on database/roles/ro to user “bob”.')
})

test('can grant every role, and requires some access', async () => {
  vi.mocked(grants.grantAccess).mockResolvedValue()
  const user = setup()
  await user.click(await screen.findByRole('button', { name: 'Grant access' }))
  await user.click(screen.getByLabelText(/Every role in/))
  await user.click(screen.getByLabelText(/Manage role/))
  await user.click(screen.getByRole('button', { name: 'Grant' }))
  expect(grants.grantAccess).toHaveBeenCalledWith(client, { kind: 'user', name: 'alice' }, [
    { path: 'database/creds/*', capabilities: ['read'] },
    { path: 'database/roles/*', capabilities: ['create', 'read', 'update', 'delete'] },
    { path: 'database/roles', capabilities: ['list'] },
  ])
})

test('refuses to grant nothing', async () => {
  const user = setup()
  await user.click(await screen.findByRole('button', { name: 'Grant access' }))
  const form = screen.getByRole('form', { name: 'Grant access to this role' })
  await user.click(within(form).getByLabelText(/Generate credentials/))
  await user.click(within(form).getByRole('button', { name: 'Grant' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Select at least one kind of access.')
  expect(grants.grantAccess).not.toHaveBeenCalled()
})

test('shows why a grant failed', async () => {
  vi.mocked(grants.grantAccess).mockRejectedValue(new Error('Policy was edited outside EnvBao'))
  const user = setup()
  await user.click(await screen.findByRole('button', { name: 'Grant access' }))
  await user.click(screen.getByRole('button', { name: 'Grant' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('edited outside EnvBao')
})
