import { QueryClientProvider, type QueryClient } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { testQueryClient } from './queryClient'

export function Providers({ children, client }: { children: ReactNode; client?: QueryClient }) {
  return <QueryClientProvider client={client ?? testQueryClient()}>{children}</QueryClientProvider>
}
