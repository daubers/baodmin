import { useMemo, useState, type ReactNode } from 'react'
import type { BaoClient, TokenInfo } from './bao'
import { SessionContext, type Session } from './useSession'

// The token lives only in React state (memory); a page reload logs out.
export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ client: BaoClient; tokenInfo: TokenInfo } | null>(null)
  const value = useMemo<Session>(
    () => ({
      client: state?.client ?? null,
      tokenInfo: state?.tokenInfo ?? null,
      connect: (client, tokenInfo) => setState({ client, tokenInfo }),
      disconnect: () => setState(null),
    }),
    [state],
  )
  return <SessionContext value={value}>{children}</SessionContext>
}
