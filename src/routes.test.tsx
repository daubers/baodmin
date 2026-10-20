import { render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { expect, test } from 'vitest'
import { routes } from './routes'

test.each([
  ['/identities', 'Identities'],
  ['/secrets', 'Secrets'],
  ['/graph', 'Access Graph'],
  ['/connect', 'Connect'],
])('renders %s', (path, heading) => {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(<RouterProvider router={router} />)
  expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument()
})

test('redirects / to identities', () => {
  const router = createMemoryRouter(routes, { initialEntries: ['/'] })
  render(<RouterProvider router={router} />)
  expect(screen.getByRole('heading', { name: 'Identities' })).toBeInTheDocument()
})
