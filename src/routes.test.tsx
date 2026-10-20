import { render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { expect, test } from 'vitest'
import { SessionProvider } from './api/session'
import { routes } from './routes'

test.each([
  ['/identities', 'Identities'],
  ['/secrets', 'Secrets'],
  ['/graph', 'Access Graph'],
  ['/connect', 'Connect'],
])('renders %s', (path, heading) => {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(
    <SessionProvider>
      <RouterProvider router={router} />
    </SessionProvider>,
  )
  expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument()
})

test('redirects / to identities', () => {
  const router = createMemoryRouter(routes, { initialEntries: ['/'] })
  render(
    <SessionProvider>
      <RouterProvider router={router} />
    </SessionProvider>,
  )
  expect(screen.getByRole('heading', { name: 'Identities' })).toBeInTheDocument()
})
