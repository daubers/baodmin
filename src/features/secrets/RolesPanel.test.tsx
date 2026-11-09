import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { BaoClient } from '../../api/bao'
import { ENGINES } from '../../api/engines/registry'
import * as roles from '../../api/engines/roles'
import { RolesPanel } from './RolesPanel'

vi.mock('../../api/engines/roles', async (orig) => ({
  ...(await orig<typeof roles>()),
  listRoles: vi.fn(),
  readRole: vi.fn(),
  writeRole: vi.fn(),
  deleteRole: vi.fn(),
}))

const client = new BaoClient('http://b', 't')

function renderPanel(type: keyof typeof ENGINES = 'database') {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RolesPanel client={client} mount={`${type}/`} engine={ENGINES[type]} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.mocked(roles.listRoles).mockResolvedValue(['readonly'])
})
afterEach(() => vi.resetAllMocks())

test('creates a database role from the form', async () => {
  vi.mocked(roles.writeRole).mockResolvedValue()
  renderPanel()
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: 'New role' }))
  await user.type(screen.getByLabelText('Role name'), 'rw')
  await user.type(screen.getByLabelText('Database config name'), 'pg')
  await user.type(screen.getByLabelText(/^Creation statements/), 'CREATE ROLE "{{{{name}}";')
  await user.click(screen.getByRole('button', { name: 'Save' }))

  expect(roles.writeRole).toHaveBeenCalledWith(
    client,
    'database/',
    ENGINES.database.roleKinds[0],
    'rw',
    expect.objectContaining({ db_name: 'pg', creation_statements: ['CREATE ROLE "{{name}}";'] }),
  )
  expect(screen.queryByRole('form')).not.toBeInTheDocument()
})

test('shows validation errors without calling OpenBao', async () => {
  renderPanel()
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: 'New role' }))
  await user.type(screen.getByLabelText('Role name'), 'rw')
  await user.type(screen.getByLabelText('Database config name'), 'pg')
  // the statements field is `required` natively, so fill it with whitespace to reach our own check
  await user.type(screen.getByLabelText(/^Creation statements/), '  ')
  await user.click(screen.getByRole('button', { name: 'Save' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Creation statements is required.')
  expect(roles.writeRole).not.toHaveBeenCalled()
})

test('edits an existing role, preserving fields the form does not know', async () => {
  vi.mocked(roles.readRole).mockResolvedValue({
    db_name: 'pg',
    creation_statements: ['CREATE ROLE a;'],
    default_ttl: 60,
    credential_type: 'password',
  })
  vi.mocked(roles.writeRole).mockResolvedValue()
  renderPanel()
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: 'Edit readonly' }))
  expect(await screen.findByLabelText('Default TTL')).toHaveValue('60s')
  expect(screen.getByLabelText('Role name')).toBeDisabled()
  await user.clear(screen.getByLabelText('Default TTL'))
  await user.type(screen.getByLabelText('Default TTL'), '2h')
  await user.click(screen.getByRole('button', { name: 'Save' }))

  expect(roles.writeRole).toHaveBeenCalledWith(
    client,
    'database/',
    ENGINES.database.roleKinds[0],
    'readonly',
    expect.objectContaining({ default_ttl: '2h', credential_type: 'password', db_name: 'pg' }),
  )
})

test('deletes a role after confirmation', async () => {
  vi.mocked(roles.deleteRole).mockResolvedValue()
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  renderPanel()
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: 'Delete readonly' }))
  expect(window.confirm).toHaveBeenCalled()
  expect(roles.deleteRole).toHaveBeenCalledWith(client, 'database/', ENGINES.database.roleKinds[0], 'readonly')
})

test('does not delete when the confirmation is declined', async () => {
  vi.spyOn(window, 'confirm').mockReturnValue(false)
  renderPanel()
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: 'Delete readonly' }))
  expect(roles.deleteRole).not.toHaveBeenCalled()
})

test('switches between dynamic and static database roles', async () => {
  renderPanel()
  const user = userEvent.setup()
  await screen.findByRole('table', { name: 'Dynamic roles' })
  await user.click(screen.getByRole('tab', { name: 'Static roles' }))
  expect(await screen.findByRole('table', { name: 'Static roles' })).toBeInTheDocument()
  expect(roles.listRoles).toHaveBeenLastCalledWith(client, 'database/', ENGINES.database.roleKinds[1])
})

test('shows an empty state and the load error', async () => {
  vi.mocked(roles.listRoles).mockResolvedValue([])
  renderPanel('ssh')
  expect(await screen.findByText('No roles yet.')).toBeInTheDocument()
})

test('yes/no settings lay the box beside its text (the "check" label), not stacked above it', async () => {
  renderPanel('ssh')
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: 'New role' }))
  const box = screen.getByLabelText('Allow user certificates')
  expect(box.closest('label')).toHaveClass('check')
})
