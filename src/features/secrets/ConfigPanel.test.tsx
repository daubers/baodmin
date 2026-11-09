import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { BaoClient } from '../../api/bao'
import * as config from '../../api/engines/config'
import { ENGINES } from '../../api/engines/registry'
import { ConfigPanel } from './ConfigPanel'

vi.mock('../../api/engines/config')

const client = new BaoClient('http://b', 't')
const conn = ENGINES.database.configs[0]

function renderPanel(type: keyof typeof ENGINES) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ConfigPanel client={client} mount={`${type}/`} engine={ENGINES[type]} />
    </QueryClientProvider>,
  )
  return userEvent.setup()
}

beforeEach(() => {
  vi.mocked(config.listConfigs).mockResolvedValue(['pg'])
})
afterEach(() => vi.resetAllMocks())

test('creates a database connection, sending the password only when typed', async () => {
  vi.mocked(config.writeConfig).mockResolvedValue()
  const user = renderPanel('database')
  await user.click(await screen.findByRole('button', { name: 'New connection' }))
  await user.type(screen.getByLabelText('Connection name'), 'main')
  await user.type(screen.getByLabelText(/^Connection URL/), 'postgresql://u:p@db/app')
  await user.type(screen.getByLabelText('Admin password'), 's3cret')
  await user.click(screen.getByRole('button', { name: 'Save' }))
  expect(config.writeConfig).toHaveBeenCalledWith(
    client,
    'database/',
    conn,
    expect.objectContaining({ plugin_name: 'postgresql-database-plugin', connection_url: 'postgresql://u:p@db/app', password: 's3cret' }),
    'main',
  )
})

test('editing keeps the stored password: blank is omitted and nothing is prefilled', async () => {
  vi.mocked(config.readConfig).mockResolvedValue({ plugin_name: 'postgresql-database-plugin', connection_url: 'postgresql://x', username: 'bao', allowed_roles: ['ro'] })
  vi.mocked(config.writeConfig).mockResolvedValue()
  const user = renderPanel('database')
  await user.click(await screen.findByRole('button', { name: 'Edit pg' }))
  expect(await screen.findByLabelText('Admin password')).toHaveValue('')
  expect(screen.getByLabelText('Connection name')).toBeDisabled()
  await user.click(screen.getByRole('button', { name: 'Save' }))
  const body = vi.mocked(config.writeConfig).mock.calls[0][3]
  expect(body).toMatchObject({ connection_url: 'postgresql://x', allowed_roles: ['ro'], username: 'bao' })
  expect(body).not.toHaveProperty('password')
})

test('rotating root credentials asks first', async () => {
  vi.mocked(config.readConfig).mockResolvedValue({ plugin_name: 'postgresql-database-plugin', connection_url: 'postgresql://x' })
  vi.mocked(config.runAction).mockResolvedValue()
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
  const user = renderPanel('database')
  await user.click(await screen.findByRole('button', { name: 'Edit pg' }))
  await user.click(await screen.findByRole('button', { name: 'Rotate root credentials' }))
  expect(config.runAction).not.toHaveBeenCalled()

  confirm.mockReturnValue(true)
  await user.click(screen.getByRole('button', { name: 'Rotate root credentials' }))
  expect(config.runAction).toHaveBeenCalledWith(client, 'database/', conn.actions![0], 'pg')
})

test('aws shows root and lease configs, loaded from their own endpoints', async () => {
  vi.mocked(config.readConfig).mockImplementation(async (_c, _m, kind) =>
    kind.id === 'root' ? { access_key: 'AKIA1', region: 'eu-west-1' } : null,
  )
  renderPanel('aws')
  expect(await screen.findByDisplayValue('AKIA1')).toBeInTheDocument()
  expect(screen.getByLabelText('Secret key')).toHaveValue('')
  expect(screen.getByLabelText('Default lease')).toBeInTheDocument()
})

test('ssh CA: shows the public key and generating asks first', async () => {
  vi.mocked(config.readConfig).mockResolvedValue({ public_key: 'ssh-rsa AAAAca' })
  vi.mocked(config.runAction).mockResolvedValue()
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  const user = renderPanel('ssh')
  expect(await screen.findByLabelText('Current CA public key')).toHaveValue('ssh-rsa AAAAca')
  await user.click(screen.getByRole('button', { name: 'Generate signing key' }))
  expect(config.runAction).toHaveBeenCalledWith(client, 'ssh/', ENGINES.ssh.configs[0].actions![0], undefined)
})

test('shows the load error', async () => {
  vi.mocked(config.listConfigs).mockRejectedValue(new Error('permission denied'))
  renderPanel('database')
  expect(await screen.findByRole('alert')).toHaveTextContent('permission denied')
})
