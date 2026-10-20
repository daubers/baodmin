import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { BaoClient } from '../../api/bao'
import * as ids from '../../api/identities'
import { SessionProvider } from '../../api/session'
import * as api from '../../api/tokens'
import { TokensTab } from './TokensTab'

vi.mock('../../api/identities')
vi.mock('../../api/tokens')

const client = new BaoClient('http://b', 't')
const token = (over: Partial<api.TokenSummary>): api.TokenSummary => ({
  accessor: 'acc-aaaaaaaa',
  display_name: 'token-ci',
  policies: ['dev'],
  ttl: 7200,
  renewable: true,
  orphan: false,
  creation_time: '',
  expire_time: null,
  ...over,
})

beforeEach(() => {
  vi.mocked(api.listTokens).mockResolvedValue([token({})])
  vi.mocked(ids.listPolicyNames).mockResolvedValue(['default', 'dev'])
})
afterEach(() => vi.resetAllMocks())

function setup() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SessionProvider>
        <TokensTab client={client} />
      </SessionProvider>
    </QueryClientProvider>,
  )
  return userEvent.setup()
}

test('lists tokens with a human TTL', async () => {
  setup()
  const row = (await screen.findByText('token-ci')).closest('tr')!
  expect(within(row).getByText('2h')).toBeInTheDocument()
})

test('creates a token and shows its value once', async () => {
  vi.mocked(api.createToken).mockResolvedValue({ token: 'hvs.SECRET', accessor: 'x', policies: ['dev'] })
  const user = setup()
  await user.click(await screen.findByRole('button', { name: 'New token' }))
  await user.type(screen.getByLabelText('Display name'), 'ci')
  await user.type(screen.getByLabelText('TTL'), '24h')
  await user.click(await screen.findByLabelText('dev'))
  await user.click(screen.getByRole('button', { name: 'Create' }))

  expect(api.createToken).toHaveBeenCalledWith(client, {
    displayName: 'ci',
    policies: ['dev'],
    ttl: '24h',
    renewable: true,
    orphan: false,
  })
  expect(await screen.findByText('hvs.SECRET')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Done' }))
  expect(screen.queryByText('hvs.SECRET')).not.toBeInTheDocument()
})

test('revoke requires confirmation', async () => {
  vi.mocked(api.revokeToken).mockResolvedValue()
  const user = setup()
  const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
  await user.click(await screen.findByRole('button', { name: 'Revoke' }))
  expect(api.revokeToken).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'Revoke' }))
  expect(api.revokeToken).toHaveBeenCalledWith(client, 'acc-aaaaaaaa')
  confirm.mockRestore()
})

test('shows create errors', async () => {
  vi.mocked(api.createToken).mockRejectedValue(new Error('permission denied'))
  const user = setup()
  await user.click(await screen.findByRole('button', { name: 'New token' }))
  await user.click(screen.getByRole('button', { name: 'Create' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('permission denied')
})
