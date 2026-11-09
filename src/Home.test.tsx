import { render, screen } from '@testing-library/react'
import { useEffect, useRef, type ReactNode } from 'react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { expect, test } from 'vitest'
import { BaoClient } from './api/bao'
import { SessionProvider } from './api/session'
import { useSession } from './api/useSession'
import { Home } from './Home'
import { Providers } from './test/providers'

/** Signs in first, and only renders its children once the session exists. */
function SignedIn({ children }: { children: ReactNode }) {
  const { client, connect } = useSession()
  // connect() isn't a stable function, so guard instead of listing it as a dependency (that would sign in forever).
  const done = useRef(false)
  useEffect(() => {
    if (done.current) return
    done.current = true
    connect(new BaoClient('http://b', 't'), { accessor: 'a', display_name: 'alice', policies: [], ttl: 0, renewable: false })
  })
  return client ? children : null
}

function setup(landing: ReactNode) {
  const router = createMemoryRouter(
    [
      { path: '/', element: landing },
      { path: '/connect', element: <p>connect page</p> },
      { path: '/identities', element: <p>identities page</p> },
    ],
    { initialEntries: ['/'] },
  )
  render(
    <Providers>
      <SessionProvider>
        <RouterProvider router={router} />
      </SessionProvider>
    </Providers>,
  )
  return router
}

test('sends a signed-out visitor to the connect page', async () => {
  const router = setup(<Home />)
  expect(await screen.findByText('connect page')).toBeInTheDocument()
  expect(router.state.location.pathname).toBe('/connect')
})

test('sends a signed-in visitor to identities', async () => {
  const router = setup(
    <SignedIn>
      <Home />
    </SignedIn>,
  )
  expect(await screen.findByText('identities page')).toBeInTheDocument()
  expect(router.state.location.pathname).toBe('/identities')
})
