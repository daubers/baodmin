import { render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { expect, test } from 'vitest'
import { SessionProvider } from './api/session'
import { Providers } from './test/providers'
import { routes } from './routes'

test.each([
  ['/identities', 'Identities'],
  ['/secrets', 'Secrets'],
  ['/graph', 'Access Graph'],
  ['/connect', 'Connect'],
])('renders %s', (path, heading) => {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(
    <Providers>
      <SessionProvider>
        <RouterProvider router={router} />
      </SessionProvider>
    </Providers>,
  )
  expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument()
})

test('redirects / to the connect page while signed out', () => {
  const router = createMemoryRouter(routes, { initialEntries: ['/'] })
  render(
    <Providers>
      <SessionProvider>
        <RouterProvider router={router} />
      </SessionProvider>
    </Providers>,
  )
  expect(screen.getByRole('heading', { name: 'Connect' })).toBeInTheDocument()
  expect(router.state.location.pathname).toBe('/connect')
})
