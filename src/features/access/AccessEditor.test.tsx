import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { BaoClient } from '../../api/bao'
import * as grants from '../../api/grants'
import * as roles from '../../api/engines/roles'
import * as secrets from '../../api/secrets'
import { AccessEditor } from './AccessEditor'

vi.mock('../../api/grants')
vi.mock('../../api/engines/roles')
vi.mock('../../api/secrets', async (orig) => ({
  ...(await orig<typeof secrets>()),
  listMounts: vi.fn(),
  listSecrets: vi.fn(),
  readPolicyHcl: vi.fn(),
}))

const client = new BaoClient('http://b', 't')
const target = { kind: 'user' as const, name: 'alice' }

const state = (over: Partial<grants.GrantState> = {}): grants.GrantState => ({
  policyName: 'envbao-user-alice',
  hcl: '# envbao-owner: user:alice\npath "secret/data/app/*" {\n  capabilities = ["read"]\n}\n',
  managed: {
    owner: 'user:alice',
    editable: true,
    reasons: [],
    grants: [{ path: 'secret/data/app/*', capabilities: ['read'] }],
  },
  attached: true,
  otherPolicies: ['default'],
  ...over,
})

beforeEach(() => {
  vi.mocked(grants.getGrantState).mockResolvedValue(state())
  vi.mocked(secrets.listMounts).mockResolvedValue([{ path: 'secret/', type: 'kv', version: '2' }])
  vi.mocked(secrets.listSecrets).mockImplementation(async (_c, _m, prefix) =>
    prefix === ''
      ? [
          { name: 'app/', path: 'app/', isFolder: true },
          { name: 'shared', path: 'shared', isFolder: false },
        ]
      : [{ name: 'db', path: 'app/db', isFolder: false }],
  )
  vi.mocked(secrets.readPolicyHcl).mockResolvedValue('path "x" { capabilities = ["read"] }')
})
afterEach(() => vi.resetAllMocks())

function setup() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AccessEditor client={client} target={target} onClose={() => {}} />
    </QueryClientProvider>,
  )
  return userEvent.setup()
}

test('shows managed grants and read-only other policies', async () => {
  const user = setup()
  expect(await screen.findByText('secret/app/*')).toBeInTheDocument()
  const other = screen.getByText('default').closest('li')!
  await user.click(within(other).getByRole('button', { name: 'View default' }))
  expect(await within(other).findByText(/capabilities/)).toBeInTheDocument()
})

test('grants KV access split into data and metadata rules', async () => {
  vi.mocked(grants.grantAccess).mockResolvedValue()
  const user = setup()
  await user.click(await screen.findByRole('button', { name: 'Type a path instead' }))
  await user.type(await screen.findByLabelText('Secret path'), 'db/*')
  await user.click(screen.getByLabelText('update'))
  await user.click(screen.getByLabelText('list'))
  await user.click(screen.getByRole('button', { name: 'Grant' }))
  expect(grants.grantAccess).toHaveBeenCalledWith(client, target, [
    { path: 'secret/data/db/*', capabilities: ['read', 'update'] },
    { path: 'secret/metadata/db/*', capabilities: ['list'] },
  ])
})

test('grants a secret chosen from the browser', async () => {
  vi.mocked(grants.grantAccess).mockResolvedValue()
  const user = setup()
  await user.click(await screen.findByRole('button', { name: 'Open app/' }))
  await user.click(await screen.findByLabelText('db'))
  await user.click(screen.getByRole('button', { name: 'Grant' }))
  expect(grants.grantAccess).toHaveBeenCalledWith(client, target, [
    { path: 'secret/data/app/db', capabilities: ['read'] },
    { path: 'secret/metadata/app/db', capabilities: [] },
  ])
})

test('ticking "everything inside" grants the folder wildcard', async () => {
  vi.mocked(grants.grantAccess).mockResolvedValue()
  const user = setup()
  await user.click(await screen.findByRole('button', { name: 'Open app/' }))
  await user.click(await screen.findByLabelText(/Everything inside/))
  expect(screen.getByLabelText('db')).toBeDisabled()
  await user.click(screen.getByRole('button', { name: 'Grant' }))
  expect(grants.grantAccess).toHaveBeenCalledWith(client, target, [
    { path: 'secret/data/app/*', capabilities: ['read'] },
    { path: 'secret/metadata/app/*', capabilities: [] },
  ])
})

test('asks for a choice before granting', async () => {
  const user = setup()
  await user.click(await screen.findByRole('button', { name: 'Grant' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Path is required')
  expect(grants.grantAccess).not.toHaveBeenCalled()
})

test('validates the path and capabilities before calling the API', async () => {
  const user = setup()
  await user.click(await screen.findByRole('button', { name: 'Type a path instead' }))
  await user.type(await screen.findByLabelText('Secret path'), '/bad')
  await user.click(screen.getByRole('button', { name: 'Grant' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('must not start with "/"')
  expect(grants.grantAccess).not.toHaveBeenCalled()
})

test('revoke asks for confirmation', async () => {
  vi.mocked(grants.revokeAccess).mockResolvedValue()
  const user = setup()
  const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
  await user.click(await screen.findByRole('button', { name: 'Revoke secret/app/*' }))
  expect(grants.revokeAccess).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'Revoke secret/app/*' }))
  expect(grants.revokeAccess).toHaveBeenCalledWith(client, target, ['secret/data/app/*'])
  confirm.mockRestore()
})

test('a policy edited outside EnvBao is read-only', async () => {
  vi.mocked(grants.getGrantState).mockResolvedValue(
    state({ managed: { owner: 'user:alice', editable: false, reasons: ['x: Constraint "allowed_parameters"'], grants: [{ path: 'x', capabilities: ['read'] }] } }),
  )
  setup()
  expect(await screen.findByRole('alert')).toHaveTextContent('changed outside EnvBao')
  expect(screen.getByRole('button', { name: 'Revoke x' })).toBeDisabled()
  expect(screen.queryByRole('form', { name: 'Grant access' })).not.toBeInTheDocument()
})

test('shows load errors', async () => {
  vi.mocked(grants.getGrantState).mockRejectedValue(new Error('permission denied'))
  setup()
  expect(await screen.findByRole('alert')).toHaveTextContent('permission denied')
})

test('grants generate on a dynamic-engine role from the identity side', async () => {
  vi.mocked(secrets.listMounts).mockResolvedValue([
    { path: 'secret/', type: 'kv', version: '2' },
    { path: 'database/', type: 'database' },
  ])
  vi.mocked(roles.listRoles).mockResolvedValue(['readonly', 'readwrite'])
  vi.mocked(grants.grantAccess).mockResolvedValue()
  const user = setup()
  await user.selectOptions(await screen.findByLabelText('Secrets engine'), 'database/')
  await user.click(await screen.findByLabelText('readwrite'))
  await user.click(screen.getByLabelText(/Manage role/))
  await user.click(screen.getByRole('button', { name: 'Grant' }))
  expect(grants.grantAccess).toHaveBeenCalledWith(client, target, [
    { path: 'database/creds/readwrite', capabilities: ['read'] },
    { path: 'database/roles/readwrite', capabilities: ['create', 'read', 'update', 'delete'] },
    { path: 'database/roles', capabilities: ['list'] },
  ])
})

test('a dynamic grant needs a role chosen', async () => {
  vi.mocked(secrets.listMounts).mockResolvedValue([{ path: 'database/', type: 'database' }])
  vi.mocked(roles.listRoles).mockResolvedValue(['readonly'])
  const user = setup()
  await screen.findByLabelText('readonly')
  await user.click(screen.getByRole('button', { name: 'Grant' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Choose a role.')
  expect(grants.grantAccess).not.toHaveBeenCalled()
})
