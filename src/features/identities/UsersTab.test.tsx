import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { BaoClient } from '../../api/bao'
import * as api from '../../api/identities'
import { UsersTab } from './UsersTab'

vi.mock('../../api/identities')

const client = new BaoClient('http://b', 't')

beforeEach(() => {
  vi.mocked(api.listUsers).mockResolvedValue([{ name: 'alice', policies: ['dev'], ttl: 0 }])
  vi.mocked(api.listPolicyNames).mockResolvedValue(['default', 'dev'])
  vi.mocked(api.saveUser).mockResolvedValue()
  vi.mocked(api.deleteUser).mockResolvedValue()
})
afterEach(() => vi.resetAllMocks())

function setup() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <UsersTab client={client} />
    </QueryClientProvider>,
  )
  return userEvent.setup()
}

test('lists users', async () => {
  setup()
  const row = (await screen.findByText('alice')).closest('tr')!
  expect(within(row).getByText('dev')).toBeInTheDocument()
})

test('creates a user with selected policies', async () => {
  const user = setup()
  await user.click(await screen.findByRole('button', { name: 'New user' }))
  await user.type(screen.getByLabelText('Username'), 'bob')
  await user.type(screen.getByLabelText('Password'), 'pw')
  await user.click(await screen.findByLabelText('dev'))
  await user.click(screen.getByRole('button', { name: 'Save' }))
  expect(api.saveUser).toHaveBeenCalledWith(client, { name: 'bob', password: 'pw', policies: ['dev'], ttl: '' })
})

test('editing keeps the username fixed and the password optional', async () => {
  const user = setup()
  await user.click(await screen.findByRole('button', { name: 'Edit' }))
  expect(screen.getByLabelText('Username')).toBeDisabled()
  await user.click(await screen.findByLabelText('default'))
  await user.click(screen.getByRole('button', { name: 'Save' }))
  expect(api.saveUser).toHaveBeenCalledWith(client, { name: 'alice', password: '', policies: ['dev', 'default'], ttl: '' })
})

test('delete requires confirmation', async () => {
  const user = setup()
  const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
  await user.click(await screen.findByRole('button', { name: 'Delete' }))
  expect(api.deleteUser).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'Delete' }))
  expect(api.deleteUser).toHaveBeenCalledWith(client, 'alice')
  confirm.mockRestore()
})

test('shows API errors', async () => {
  vi.mocked(api.listUsers).mockRejectedValue(new Error('permission denied'))
  setup()
  expect(await screen.findByRole('alert')).toHaveTextContent('permission denied')
})
