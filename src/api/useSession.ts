import { createContext, useContext } from 'react'
import type { BaoClient, TokenInfo } from './bao'

/** Why the session ended without the user disconnecting. */
export type SessionNotice = 'expired' | 'sealed'

export interface Session {
  client: BaoClient | null
  tokenInfo: TokenInfo | null
  notice: SessionNotice | null
  /** URL of the last connection, so signing in again doesn't mean retyping it. */
  lastUrl: string | null
  connect: (client: BaoClient, tokenInfo: TokenInfo) => void
  disconnect: () => void
  expire: (notice: SessionNotice) => void
}

export const SessionContext = createContext<Session | null>(null)

export function useSession(): Session {
  const s = useContext(SessionContext)
  if (!s) throw new Error('useSession must be used inside SessionProvider')
  return s
}
