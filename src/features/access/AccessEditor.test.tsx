import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { BaoClient } from '../../api/bao'
import * as grants from '../../api/grants'
import * as secrets from '../../api/secrets'
import { AccessEditor } from './AccessEditor'

vi.mock('../../api/grants')
vi.mock('../../api/secrets')

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
  vi.mocked(secrets.listKvMounts).mockResolvedValue([{ path: 'secret/' }])
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
  expect(await screen.findByText('secret/data/app/*')).toBeInTheDocument()
  const other = screen.getByText('default').closest('li')!
  await user.click(within(other).getByRole('button', { name: 'View default' }))
  expect(await within(other).findByText(/capabilities/)).toBeInTheDocument()
})

test('grants KV access split into data and metadata rules', async () => {
  vi.mocked(grants.grantAccess).mockResolvedValue()
  const user = setup()
  await user.type(await screen.findByLabelText('Secret path'), 'db/*')
  await user.click(screen.getByLabelText('update'))
  await user.click(screen.getByLabelText('list'))
  await user.click(screen.getByRole('button', { name: 'Grant' }))
  expect(grants.grantAccess).toHaveBeenCalledWith(client, target, [
    { path: 'secret/data/db/*', capabilities: ['read', 'update'] },
    { path: 'secret/metadata/db/*', capabilities: ['list'] },
  ])
})

test('validates the path and capabilities before calling the API', async () => {
  const user = setup()
  await user.type(await screen.findByLabelText('Secret path'), '/bad')
  await user.click(screen.getByRole('button', { name: 'Grant' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('must not start with "/"')
  expect(grants.grantAccess).not.toHaveBeenCalled()
})

test('revoke asks for confirmation', async () => {
  vi.mocked(grants.revokeAccess).mockResolvedValue()
  const user = setup()
  const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
  await user.click(await screen.findByRole('button', { name: 'Revoke secret/data/app/*' }))
  expect(grants.revokeAccess).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'Revoke secret/data/app/*' }))
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
