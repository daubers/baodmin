import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { BaoClient } from '../../api/bao'
import * as leases from '../../api/engines/leases'
import { LeasesPanel } from './LeasesPanel'

vi.mock('../../api/engines/leases')

const client = new BaoClient('http://b', 't')

function setup() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <LeasesPanel client={client} mount="database/" />
    </QueryClientProvider>,
  )
  return userEvent.setup()
}

beforeEach(() => {
  vi.mocked(leases.listLeases).mockImplementation(async (_c, prefix) =>
    prefix === 'database/'
      ? [{ name: 'creds/', path: 'database/creds/', isFolder: true }]
      : prefix === 'database/creds/'
        ? [{ name: 'ro/', path: 'database/creds/ro/', isFolder: true }]
        : [{ name: 'abc', path: 'database/creds/ro/abc', isFolder: false }],
  )
  vi.mocked(leases.lookupLease).mockResolvedValue({
    id: 'database/creds/ro/abc',
    issueTime: '2026-01-01T00:00:00Z',
    expireTime: '2026-01-01T01:00:00Z',
    lastRenewal: null,
    renewable: true,
    ttl: 3000,
  })
})
afterEach(() => vi.resetAllMocks())

async function openLease(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: /creds\// }))
  await user.click(await screen.findByRole('button', { name: /ro\// }))
}

test('browses folders down to a lease and shows its details', async () => {
  const user = setup()
  await openLease(user)
  await user.click(await screen.findByRole('button', { name: 'Details abc' }))
  const details = await screen.findByLabelText('Lease abc')
  expect(within(details).getByText('3000s')).toBeInTheDocument()
  expect(leases.lookupLease).toHaveBeenCalledWith(client, 'database/creds/ro/abc')
})

test('renews a renewable lease', async () => {
  vi.mocked(leases.renewLease).mockResolvedValue(3600)
  const user = setup()
  await openLease(user)
  await user.click(await screen.findByRole('button', { name: 'Details abc' }))
  await user.click(await screen.findByRole('button', { name: 'Renew' }))
  expect(leases.renewLease).toHaveBeenCalledWith(client, 'database/creds/ro/abc')
})

test('revokes one lease only after confirmation', async () => {
  vi.mocked(leases.revokeLease).mockResolvedValue()
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
  const user = setup()
  await openLease(user)
  await user.click(await screen.findByRole('button', { name: 'Revoke abc' }))
  expect(leases.revokeLease).not.toHaveBeenCalled()
  confirm.mockReturnValue(true)
  await user.click(screen.getByRole('button', { name: 'Revoke abc' }))
  expect(leases.revokeLease).toHaveBeenCalledWith(client, 'database/creds/ro/abc')
})

test('revoke-all is offered below the mount root and names the prefix', async () => {
  vi.mocked(leases.revokePrefix).mockResolvedValue()
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
  const user = setup()
  await screen.findByRole('button', { name: /creds\// })
  expect(screen.queryByRole('button', { name: /Revoke all/ })).not.toBeInTheDocument()

  await openLease(user)
  await user.click(await screen.findByRole('button', { name: 'Revoke all under this prefix' }))
  expect(confirm.mock.calls[0][0]).toContain('database/creds/ro/')
  expect(leases.revokePrefix).toHaveBeenCalledWith(client, 'database/creds/ro/')
})

test('says so when there are no leases, and why listing failed', async () => {
  vi.mocked(leases.listLeases).mockResolvedValueOnce([])
  setup()
  expect(await screen.findByText('No leases under database/.')).toBeInTheDocument()
})

test('shows the error when listing is not permitted', async () => {
  vi.mocked(leases.listLeases).mockRejectedValue(new Error('permission denied'))
  setup()
  expect(await screen.findByRole('alert')).toHaveTextContent('permission denied')
})
