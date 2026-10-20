import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { BaoClient, TokenInfo } from './bao'
import { SessionContext, type Session, type SessionNotice } from './useSession'

// setTimeout overflows (fires immediately) above this
const MAX_TIMEOUT_MS = 2 ** 31 - 1

// The token lives only in React state (memory); a page reload logs out.
export function SessionProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const [state, setState] = useState<{ client: BaoClient; tokenInfo: TokenInfo } | null>(null)
  const [notice, setNotice] = useState<SessionNotice | null>(null)
  const [lastUrl, setLastUrl] = useState<string | null>(null)

  // Drop cached OpenBao data whenever the session ends so it can't leak into the next one.
  const end = useCallback(
    (n: SessionNotice | null) => {
      setState(null)
      setNotice(n)
      qc.clear()
    },
    [qc],
  )

  const ttl = state?.tokenInfo.ttl ?? 0
  useEffect(() => {
    if (!state || ttl <= 0) return // ttl 0 means the token never expires
    const t = setTimeout(() => end('expired'), Math.min(ttl * 1000, MAX_TIMEOUT_MS))
    return () => clearTimeout(t)
  }, [state, ttl, end])

  const value = useMemo<Session>(
    () => ({
      client: state?.client ?? null,
      tokenInfo: state?.tokenInfo ?? null,
      notice,
      lastUrl,
      connect: (client, tokenInfo) => {
        setState({ client, tokenInfo })
        setLastUrl(client.baseUrl)
        setNotice(null)
      },
      disconnect: () => end(null),
      expire: end,
    }),
    [state, notice, lastUrl, end],
  )
  return <SessionContext value={value}>{children}</SessionContext>
}
