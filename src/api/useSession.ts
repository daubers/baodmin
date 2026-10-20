import { createContext, useContext } from 'react'
import type { BaoClient, TokenInfo } from './bao'

export interface Session {
  client: BaoClient | null
  tokenInfo: TokenInfo | null
  connect: (client: BaoClient, tokenInfo: TokenInfo) => void
  disconnect: () => void
}

export const SessionContext = createContext<Session | null>(null)

export function useSession(): Session {
  const s = useContext(SessionContext)
  if (!s) throw new Error('useSession must be used inside SessionProvider')
  return s
}
