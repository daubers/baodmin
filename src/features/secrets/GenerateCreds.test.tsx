import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import { BaoClient } from '../../api/bao'
import * as creds from '../../api/engines/creds'
import * as leases from '../../api/engines/leases'
import { ENGINES } from '../../api/engines/registry'
import { GenerateCreds } from './GenerateCreds'

vi.mock('../../api/engines/creds')
vi.mock('../../api/engines/leases')

const client = new BaoClient('http://b', 't')
afterEach(() => vi.resetAllMocks())

function setup(type: 'database' | 'ssh', kindIndex = 0) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const onClose = vi.fn()
  render(
    <QueryClientProvider client={qc}>
      <GenerateCreds client={client} mount={`${type}/`} role="ro" kinds={ENGINES[type].roleKinds[kindIndex].creds} onClose={onClose} />
    </QueryClientProvider>,
  )
  return { qc, onClose, user: userEvent.setup() }
}

const issued = { leaseId: 'database/creds/ro/abc', leaseDuration: 3600, renewable: true, data: { username: 'v-ro-1', password: 'hunter2' }, warnings: [] }

test('shows issued credentials once, and keeps them out of every cache', async () => {
  vi.mocked(creds.generateCreds).mockResolvedValue(issued)
  const { qc, onClose, user } = setup('database')
  await user.click(screen.getByRole('button', { name: 'Generate' }))

  const dialog = await screen.findByRole('dialog', { name: 'Credentials for ro' })
  expect(dialog).toHaveTextContent('v-ro-1')
  expect(dialog).toHaveTextContent('hunter2')
  expect(dialog).toHaveTextContent('valid for 3600s')
  expect(JSON.stringify(qc.getQueryCache().getAll().map((q) => q.state.data))).not.toContain('hunter2')

  await user.click(screen.getByRole('button', { name: 'Done' }))
  expect(onClose).toHaveBeenCalled()
  expect(qc.getMutationCache().getAll()).toHaveLength(0)
})

test('a role that takes no input offers just Generate, with no raw JSON box', () => {
  setup('database')
  expect(screen.getByRole('form', { name: 'Generate credentials for ro' })).toBeInTheDocument()
  expect(screen.queryByLabelText(/JSON/)).not.toBeInTheDocument()
})

test('revokes the lease on request', async () => {
  vi.mocked(creds.generateCreds).mockResolvedValue(issued)
  vi.mocked(leases.revokeLease).mockResolvedValue()
  const { user } = setup('database')
  await user.click(screen.getByRole('button', { name: 'Generate' }))
  await user.click(await screen.findByRole('button', { name: 'Revoke now' }))
  expect(leases.revokeLease).toHaveBeenCalledWith(client, 'database/creds/ro/abc')
  expect(await screen.findByRole('status')).toHaveTextContent('Lease revoked.')
  expect(screen.queryByRole('button', { name: 'Revoke now' })).not.toBeInTheDocument()
})

test('credentials without a lease cannot be revoked', async () => {
  vi.mocked(creds.generateCreds).mockResolvedValue({ ...issued, leaseId: '', leaseDuration: 0 })
  const { user } = setup('database')
  await user.click(screen.getByRole('button', { name: 'Generate' }))
  expect(await screen.findByText(/No lease/)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Revoke now' })).not.toBeInTheDocument()
})

test('ssh: choose between signing and OTP, and validate inputs before calling OpenBao', async () => {
  vi.mocked(creds.generateCreds).mockResolvedValue({ ...issued, leaseId: '', data: { signed_key: 'ssh-ed25519-cert-v01@openssh.com AAAA' } })
  const { user } = setup('ssh')
  // sign is first; the public key is required
  await user.type(screen.getByLabelText(/^Public key/), '  ')
  await user.click(screen.getByRole('button', { name: 'Generate' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Public key is required.')
  expect(creds.generateCreds).not.toHaveBeenCalled()

  await user.selectOptions(screen.getByLabelText('Action'), 'otp')
  await user.type(screen.getByLabelText('Target IP'), '10.0.0.5')
  await user.click(screen.getByRole('button', { name: 'Generate' }))
  expect(creds.generateCreds).toHaveBeenCalledWith(client, 'ssh/', ENGINES.ssh.roleKinds[0].creds[1], 'ro', { ip: '10.0.0.5' })
})

test('shows why generating failed', async () => {
  vi.mocked(creds.generateCreds).mockRejectedValue(new Error('permission denied'))
  const { user } = setup('database')
  await user.click(screen.getByRole('button', { name: 'Generate' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('permission denied')
})
