import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createBrowserRouter, RouterProvider } from 'react-router'
import { SessionGuard } from './api/SessionGuard'
import { SessionProvider } from './api/session'
import { ConfirmProvider } from './features/shared/ConfirmProvider'
import { routes } from './routes'

const queryClient = new QueryClient()
const router = createBrowserRouter(routes)

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <ConfirmProvider>
          <SessionGuard />
          <RouterProvider router={router} />
        </ConfirmProvider>
      </SessionProvider>
    </QueryClientProvider>
  )
}

export default App
