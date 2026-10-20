import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { BaoClient } from '../../api/bao'
import * as grants from '../../api/grants'
import * as ids from '../../api/identities'
import * as secrets from '../../api/secrets'
import { SessionProvider } from '../../api/session'
import { useSession } from '../../api/useSession'
import * as tokens from '../../api/tokens'
import { renderManagedPolicy } from '../../model/managed'
import { GraphPage } from './GraphPage'

// jsdom can't lay out React Flow, so render nodes/edges as plain buttons that fire the same callbacks.
vi.mock('@xyflow/react', () => ({
  ReactFlow: (p: {
    nodes: { id: string; data: { label: string } }[]
    edges: { id: string; label?: string }[]
    onNodeClick: (e: unknown, n: { id: string }) => void
    onEdgeClick: (e: unknown, ed: { id: string }) => void
  }) => (
    <div>
      {p.nodes.map((n) => (
        <button key={n.id} type="button" onClick={(e) => p.onNodeClick(e, n)}>
          node {n.data.label}
        </button>
      ))}
      {p.edges.map((ed) => (
        <button key={ed.id} type="button" onClick={(e) => p.onEdgeClick(e, ed)}>
          edge {ed.id}
        </button>
      ))}
    </div>
  ),
  Background: () => null,
  Controls: () => null,
  MarkerType: { ArrowClosed: 'arrowclosed' },
  Position: { Left: 'left', Right: 'right' },
}))
vi.mock('../../api/identities')
vi.mock('../../api/tokens')
vi.mock('../../api/grants')
vi.mock('../../api/secrets', async (orig) => ({ ...(await orig<typeof secrets>()), readPolicyHcl: vi.fn() }))

const client = new BaoClient('http://b', 't')
const managedHcl = renderManagedPolicy('user', 'alice', [{ path: 'secret/data/app/*', capabilities: ['read'] }])
const handHcl = 'path "secret/data/other" { capabilities = ["read"] }'

function Connected() {
  const { connect } = useSession()
  return (
    <button type="button" onClick={() => connect(client, { accessor: 'me', display_name: 'me', policies: [], ttl: 0, renewable: false })}>
      go
    </button>
  )
}

beforeEach(() => {
  vi.mocked(ids.listUsers).mockResolvedValue([
    { name: 'alice', policies: ['envbao-user-alice', 'default'], ttl: 0 },
    { name: 'bob', policies: ['legacy'], ttl: 0 },
  ])
  vi.mocked(ids.listEntities).mockResolvedValue([])
  vi.mocked(ids.listGroups).mockResolvedValue([])
  vi.mocked(tokens.listTokens).mockResolvedValue([])
  vi.mocked(ids.listPolicyNames).mockResolvedValue(['envbao-user-alice', 'default', 'legacy'])
  vi.mocked(secrets.readPolicyHcl).mockImplementation(async (_c, n) =>
    n === 'envbao-user-alice' ? managedHcl : n === 'legacy' ? handHcl : 'path "auth/token/lookup-self" { capabilities = ["read"] }',
  )
})
afterEach(() => vi.resetAllMocks())

async function open() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SessionProvider>
        <MemoryRouter>
          <Connected />
          <GraphPage />
        </MemoryRouter>
      </SessionProvider>
    </QueryClientProvider>,
  )
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'go' }))
  await screen.findByRole('button', { name: 'node alice' })
  return user
}

test('renders identities, policies and paths, hiding the default policy', async () => {
  await open()
  expect(screen.getByRole('button', { name: 'node envbao-user-alice' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'node secret/data/app/*' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'node default' })).not.toBeInTheDocument()
})

test('can show the default policy', async () => {
  const user = await open()
  await user.click(screen.getByLabelText(/Hide the default policy/))
  expect(screen.getByRole('button', { name: 'node default' })).toBeInTheDocument()
})

test('filters by identity and by path', async () => {
  const user = await open()
  await user.type(screen.getByLabelText('Identity'), 'bob')
  expect(screen.queryByRole('button', { name: 'node alice' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'node secret/data/other' })).toBeInTheDocument()
  await user.clear(screen.getByLabelText('Identity'))
  await user.type(screen.getByLabelText('Path'), 'app')
  expect(screen.queryByRole('button', { name: 'node bob' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'node alice' })).toBeInTheDocument()
  await user.type(screen.getByLabelText('Path'), 'zzz')
  expect(screen.getByText('Nothing matches.')).toBeInTheDocument()
})

test('node details show who reaches a path', async () => {
  const user = await open()
  await user.click(screen.getByRole('button', { name: 'node secret/data/app/*' }))
  const d = screen.getByRole('complementary', { name: 'Details' })
  expect(within(d).getByText(/envbao-user-alice \(read\): alice/)).toBeInTheDocument()
})

test('revokes a grant from a managed policy edge', async () => {
  vi.mocked(grants.revokeAccess).mockResolvedValue()
  const user = await open()
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
  await user.click(screen.getByRole('button', { name: 'edge policy:envbao-user-alice->path:secret/data/app/*' }))
  await user.click(screen.getByRole('button', { name: 'Revoke' }))
  expect(grants.revokeAccess).toHaveBeenCalledWith(client, { kind: 'user', name: 'alice' }, ['secret/data/app/*'])
  confirm.mockRestore()
})

test('grants in unmanaged policies cannot be revoked', async () => {
  const user = await open()
  await user.click(screen.getByRole('button', { name: 'edge policy:legacy->path:secret/data/other' }))
  expect(screen.queryByRole('button', { name: 'Revoke' })).not.toBeInTheDocument()
  expect(screen.getByText(/does not manage/)).toBeInTheDocument()
})
