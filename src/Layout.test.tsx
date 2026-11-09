import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { expect, test } from 'vitest'
import { BaoClient } from './api/bao'
import { SessionProvider } from './api/session'
import { useSession } from './api/useSession'
import { Layout } from './Layout'
import { Providers } from './test/providers'

function SignIn() {
  const { connect } = useSession()
  return (
    <button type="button" onClick={() => connect(new BaoClient('http://b', 't'), { accessor: 'a', display_name: 'alice', policies: [], ttl: 0, renewable: false })}>
      sign in
    </button>
  )
}

function setup() {
  const router = createMemoryRouter([{ path: '/', element: <Layout />, children: [{ index: true, element: <SignIn /> }, { path: 'connect', element: <p>connect page</p> }] }])
  render(
    <Providers>
      <SessionProvider>
        <RouterProvider router={router} />
      </SessionProvider>
    </Providers>,
  )
  return userEvent.setup()
}

test('offers Connect only while signed out', async () => {
  const user = setup()
  const nav = screen.getByRole('navigation', { name: 'Main' })
  expect(nav).toHaveTextContent('Connect')
  expect(screen.getByRole('link', { name: 'Connect' })).toHaveAttribute('href', '/connect')

  await user.click(screen.getByRole('button', { name: 'sign in' }))
  expect(screen.queryByRole('link', { name: 'Connect' })).not.toBeInTheDocument()
  expect(screen.queryByRole('link', { name: 'Connection' })).not.toBeInTheDocument()
})

test('while signed in, the signed-in name links to the connection details', async () => {
  const user = setup()
  await user.click(screen.getByRole('button', { name: 'sign in' }))
  const me = screen.getByRole('link', { name: 'alice' })
  expect(me).toHaveAttribute('href', '/connect')
  await user.click(me)
  expect(screen.getByText('connect page')).toBeInTheDocument()
})
