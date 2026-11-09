import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { BaoClient } from '../../api/bao'
import * as mounts from '../../api/mounts'
import type { Mount } from '../../api/secrets'
import { DeleteMountDialog } from './DeleteMountDialog'

vi.mock('../../api/mounts', async (orig) => ({ ...(await orig<typeof mounts>()), deleteMount: vi.fn(), mountImpact: vi.fn() }))
vi.mock('../shared/useAccessInputs', () => ({ useAccessInputs: vi.fn() }))

import { useAccessInputs } from '../shared/useAccessInputs'

const client = new BaoClient('http://b', 't')
const kv: Mount = { path: 'secret/', type: 'kv', version: '2' }
const db: Mount = { path: 'database/', type: 'database' }

function policies(list: { name: string; hcl: string | null }[], error: Error | null = null) {
  vi.mocked(useAccessInputs).mockReturnValue({ data: error ? undefined : { identities: [], policies: list, notes: [] }, error } as never)
}

beforeEach(() => policies([]))
afterEach(() => vi.resetAllMocks())

function setup(mount: Mount) {
  const onClose = vi.fn()
  const onDeleted = vi.fn()
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <DeleteMountDialog client={client} mount={mount} onClose={onClose} onDeleted={onDeleted} />
    </QueryClientProvider>,
  )
  return { user: userEvent.setup(), onClose, onDeleted, qc }
}

const deleteButton = () => screen.getByRole('button', { name: 'Delete forever' })

test('describes what deleting a KV store destroys', async () => {
  vi.mocked(mounts.mountImpact).mockResolvedValue({ kind: 'kv', topLevelEntries: 4, unknown: [] })
  setup(kv)
  expect(await screen.findByText(/with all of its versions, will be permanently deleted/)).toHaveTextContent('at least 4 entries at the top level')
  expect(screen.getByText('This cannot be undone.')).toBeInTheDocument()
  expect(mounts.mountImpact).toHaveBeenCalledWith(client, 'secret/', 'kv')
})

test('describes a dynamic engine, including that leases are revoked', async () => {
  vi.mocked(mounts.mountImpact).mockResolvedValue({ kind: 'dynamic', roles: 1, hasLeases: true, unknown: [] })
  setup(db)
  const text = await screen.findByText(/engine at/)
  expect(text).toHaveTextContent('Database engine at database/ will be permanently deleted, with its 1 role and its configuration.')
  expect(text).toHaveTextContent('Every lease it has issued will be revoked')
})

test('does not claim leases are revoked when there are none', async () => {
  vi.mocked(mounts.mountImpact).mockResolvedValue({ kind: 'dynamic', roles: 0, hasLeases: false, unknown: [] })
  setup(db)
  expect(await screen.findByText(/engine at/)).not.toHaveTextContent('lease')
})

test('says what it could not count', async () => {
  vi.mocked(mounts.mountImpact).mockResolvedValue({ kind: 'dynamic', roles: 2, hasLeases: undefined, unknown: ['leases'] })
  setup(db)
  expect(await screen.findByText('Could not count leases, so there may be more than shown.')).toBeInTheDocument()
})

test('lists policies that refer to the mount and leaves them alone', async () => {
  vi.mocked(mounts.mountImpact).mockResolvedValue({ kind: 'kv', topLevelEntries: 0, unknown: [] })
  policies([
    { name: 'envbao-user-alice', hcl: 'path "secret/data/team-a/*" { capabilities = ["read"] }' },
    { name: 'unrelated', hcl: 'path "other/x" { capabilities = ["read"] }' },
  ])
  setup(kv)
  expect(await screen.findByText(/1 policy grants access under this mount/)).toBeInTheDocument()
  expect(screen.getByText('envbao-user-alice')).toBeInTheDocument()
  expect(screen.queryByText('unrelated')).not.toBeInTheDocument()
})

test('says when policies could not be checked', async () => {
  vi.mocked(mounts.mountImpact).mockResolvedValue({ kind: 'kv', topLevelEntries: 0, unknown: [] })
  policies([], new Error('permission denied'))
  setup(kv)
  expect(await screen.findByText(/Could not check which policies refer to this mount: permission denied/)).toBeInTheDocument()
})

test('Delete stays disabled until the path is typed, and nothing is deleted before then', async () => {
  vi.mocked(mounts.mountImpact).mockResolvedValue({ kind: 'kv', topLevelEntries: 0, unknown: [] })
  const { user } = setup(kv)
  expect(deleteButton()).toBeDisabled()
  await user.type(screen.getByLabelText(/Type/), 'secre')
  expect(deleteButton()).toBeDisabled()
  await user.type(screen.getByLabelText(/Type/), 'x')
  expect(deleteButton()).toBeDisabled()
  expect(mounts.deleteMount).not.toHaveBeenCalled()
})

test.each(['secret/', 'secret', '  secret/  '])('deleting after typing "%s"', async (typed) => {
  vi.mocked(mounts.mountImpact).mockResolvedValue({ kind: 'kv', topLevelEntries: 0, unknown: [] })
  vi.mocked(mounts.deleteMount).mockResolvedValue()
  const { user, onDeleted } = setup(kv)
  await user.type(screen.getByLabelText(/Type/), typed)
  await user.click(deleteButton())
  expect(mounts.deleteMount).toHaveBeenCalledWith(client, 'secret/')
  expect(onDeleted).toHaveBeenCalled()
})

test('a different mount name does not unlock it', async () => {
  vi.mocked(mounts.mountImpact).mockResolvedValue({ kind: 'kv', topLevelEntries: 0, unknown: [] })
  const { user } = setup(kv)
  await user.type(screen.getByLabelText(/Type/), 'secrets')
  expect(deleteButton()).toBeDisabled()
})

test('shows the server error and stays open', async () => {
  vi.mocked(mounts.mountImpact).mockResolvedValue({ kind: 'kv', topLevelEntries: 0, unknown: [] })
  vi.mocked(mounts.deleteMount).mockRejectedValue(new Error('permission denied'))
  const { user, onDeleted } = setup(kv)
  await user.type(screen.getByLabelText(/Type/), 'secret')
  await user.click(deleteButton())
  expect(await screen.findByRole('alert')).toHaveTextContent('permission denied')
  expect(onDeleted).not.toHaveBeenCalled()
})

test('cancel closes without deleting', async () => {
  vi.mocked(mounts.mountImpact).mockResolvedValue({ kind: 'kv', topLevelEntries: 0, unknown: [] })
  const { user, onClose } = setup(kv)
  await user.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(onClose).toHaveBeenCalled()
  expect(mounts.deleteMount).not.toHaveBeenCalled()
})

test('forgets cached data for the deleted mount', async () => {
  vi.mocked(mounts.mountImpact).mockResolvedValue({ kind: 'dynamic', roles: 0, hasLeases: false, unknown: [] })
  vi.mocked(mounts.deleteMount).mockResolvedValue()
  const { user, qc } = setup(db)
  qc.setQueryData(['engine-roles', 'database/', 'roles'], ['ro'])
  qc.setQueryData(['engine-roles', 'ssh/', 'roles'], ['keep'])
  await user.type(screen.getByLabelText(/Type/), 'database')
  await user.click(deleteButton())
  await vi.waitFor(() => expect(mounts.deleteMount).toHaveBeenCalled())
  await vi.waitFor(() => expect(qc.getQueryData(['engine-roles', 'database/', 'roles'])).toBeUndefined())
  expect(qc.getQueryData(['engine-roles', 'ssh/', 'roles'])).toEqual(['keep'])
})
