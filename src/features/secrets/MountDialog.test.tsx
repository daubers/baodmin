import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import { BaoClient } from '../../api/bao'
import { MOUNT_TYPES } from '../../api/engines/registry'
import * as mounts from '../../api/mounts'
import type { Mount } from '../../api/secrets'
import { MountDialog } from './MountDialog'

vi.mock('../../api/mounts', async (orig) => ({
  ...(await orig<typeof mounts>()),
  createMount: vi.fn(),
  tuneMount: vi.fn(),
  readKvConfig: vi.fn(),
}))

const client = new BaoClient('http://b', 't')
const kv = MOUNT_TYPES[0]
const database = MOUNT_TYPES[1]
afterEach(() => vi.resetAllMocks())

function setup(props: { mount?: Mount; existing?: string[] } = {}) {
  const onClose = vi.fn()
  const onDone = vi.fn()
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MountDialog client={client} existing={props.existing ?? ['secret/']} mount={props.mount} onClose={onClose} onDone={onDone} />
    </QueryClientProvider>,
  )
  return { user: userEvent.setup(), onClose, onDone }
}

test('creates a KV v2 store with its settings', async () => {
  vi.mocked(mounts.createMount).mockResolvedValue()
  const { user, onDone } = setup()
  await user.type(screen.getByLabelText('Path'), 'scratch')
  await user.type(screen.getByLabelText('Description'), 'throwaway')
  await user.type(screen.getByLabelText(/^Max versions/), '5')
  await user.click(screen.getByLabelText(/Require check-and-set/))
  await user.click(screen.getByRole('button', { name: 'Create' }))
  expect(mounts.createMount).toHaveBeenCalledWith(client, 'scratch', kv, {
    description: 'throwaway',
    max_versions: '5',
    cas_required: true,
  })
  expect(onDone).toHaveBeenCalledWith('scratch/')
})

test('each type offers its own settings, and keeps the path you typed', async () => {
  const { user } = setup()
  expect(screen.queryByLabelText(/Default lease TTL/)).not.toBeInTheDocument()
  await user.type(screen.getByLabelText('Path'), 'dbs')
  await user.selectOptions(screen.getByLabelText('Type'), 'database')
  expect(screen.getByLabelText('Path')).toHaveValue('dbs')
  expect(screen.getByLabelText(/Default lease TTL/)).toBeInTheDocument()
  expect(screen.queryByLabelText(/Max versions/)).not.toBeInTheDocument()
})

test('creates a dynamic engine with lease TTLs', async () => {
  vi.mocked(mounts.createMount).mockResolvedValue()
  const { user, onDone } = setup()
  await user.selectOptions(screen.getByLabelText('Type'), 'database')
  await user.type(screen.getByLabelText('Path'), 'team/db')
  await user.type(screen.getByLabelText(/Default lease TTL/), '1h')
  await user.click(screen.getByRole('button', { name: 'Create' }))
  expect(mounts.createMount).toHaveBeenCalledWith(client, 'team/db', database, { default_lease_ttl: '1h' })
  expect(onDone).toHaveBeenCalledWith('team/db/')
})

test.each([
  ['secret', /already a secrets engine/],
  ['sys', /reserved/],
  ['Has Caps', /lowercase/],
  ['secret/inner', /inside the existing mount/],
])('refuses the path "%s" without calling OpenBao', async (path, message) => {
  const { user } = setup()
  await user.type(screen.getByLabelText('Path'), path)
  await user.click(screen.getByRole('button', { name: 'Create' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(message)
  expect(mounts.createMount).not.toHaveBeenCalled()
})

test('shows the server error and stays open', async () => {
  vi.mocked(mounts.createMount).mockRejectedValue(new Error('plugin not found in the catalog: aws'))
  const { user, onDone } = setup()
  await user.selectOptions(screen.getByLabelText('Type'), 'aws')
  expect(screen.getByText(/Not every OpenBao build includes the AWS engine/)).toBeInTheDocument()
  await user.type(screen.getByLabelText('Path'), 'aws')
  await user.click(screen.getByRole('button', { name: 'Create' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('plugin not found in the catalog')
  expect(onDone).not.toHaveBeenCalled()
})

test('a half-finished create says the mount exists and stays open', async () => {
  vi.mocked(mounts.createMount).mockRejectedValue(new mounts.PartialMountError('scratch/ was mounted, but saving its KV settings failed: nope'))
  const { user, onDone } = setup()
  await user.type(screen.getByLabelText('Path'), 'scratch')
  await user.click(screen.getByRole('button', { name: 'Create' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('scratch/ was mounted, but saving its KV settings failed')
  expect(onDone).not.toHaveBeenCalled()
})

test('settings of a dynamic mount are prefilled from what is set on it, and saved with a blank TTL reset', async () => {
  vi.mocked(mounts.tuneMount).mockResolvedValue()
  const mount: Mount = { path: 'database/', type: 'database', description: 'main db', defaultLeaseTtl: 3600, maxLeaseTtl: 0 }
  const { user, onDone } = setup({ mount })
  expect(screen.getByLabelText('Description')).toHaveValue('main db')
  expect(screen.getByLabelText(/Default lease TTL/)).toHaveValue('3600s')
  expect(screen.getByLabelText(/Max lease TTL/)).toHaveValue('') // 0 means "system default", not a value to save back
  expect(screen.queryByLabelText('Path')).not.toBeInTheDocument()
  expect(screen.queryByLabelText('Type')).not.toBeInTheDocument()

  await user.clear(screen.getByLabelText('Description'))
  await user.type(screen.getByLabelText('Description'), 'renamed')
  await user.click(screen.getByRole('button', { name: 'Save' }))
  expect(mounts.tuneMount).toHaveBeenCalledWith(client, 'database/', database, { description: 'renamed', default_lease_ttl: '3600s' })
  expect(onDone).toHaveBeenCalledWith('database/')
})

test('settings of a KV mount load the KV configuration first', async () => {
  vi.mocked(mounts.readKvConfig).mockResolvedValue({ max_versions: 3, cas_required: true, delete_version_after: '0s' })
  vi.mocked(mounts.tuneMount).mockResolvedValue()
  const { user } = setup({ mount: { path: 'secret/', type: 'kv', version: '2', description: 'kv' } })
  expect(await screen.findByLabelText(/^Max versions/)).toHaveValue('3')
  expect(screen.getByLabelText(/Require check-and-set/)).toBeChecked()
  await user.clear(screen.getByLabelText(/^Max versions/))
  await user.type(screen.getByLabelText(/^Max versions/), '10')
  await user.click(screen.getByRole('button', { name: 'Save' }))
  expect(mounts.tuneMount).toHaveBeenCalledWith(client, 'secret/', kv, {
    description: 'kv',
    max_versions: '10',
    cas_required: true,
    delete_version_after: '0s',
  })
})

test('says so when the KV configuration cannot be read, instead of showing a blank form', async () => {
  vi.mocked(mounts.readKvConfig).mockRejectedValue(new Error('permission denied'))
  setup({ mount: { path: 'secret/', type: 'kv', version: '2' } })
  expect(await screen.findByRole('alert')).toHaveTextContent('permission denied')
  expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
})

test('engines the UI cannot manage have no settings form', () => {
  setup({ mount: { path: 'pki/', type: 'pki' } })
  expect(screen.getByText(/can’t change pki engines/)).toBeInTheDocument()
})

test('cancel closes without saving', async () => {
  const { user, onClose } = setup()
  await user.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(onClose).toHaveBeenCalled()
  expect(mounts.createMount).not.toHaveBeenCalled()
})
