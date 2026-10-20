import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { BaoError } from './bao'
import { useSession } from './useSession'

const isAuthFailure = (e: BaoError) => e.kind === 'forbidden' || e.kind === 'auth'

/**
 * OpenBao answers 403 both for "token expired/revoked" and for "no permission", so a failed request
 * alone proves nothing. On such errors, check the token itself (lookup-self is allowed by the default
 * policy); on 503, check whether OpenBao has been sealed. Only then end the session.
 */
export function SessionGuard() {
  const qc = useQueryClient()
  const { client, expire } = useSession()

  useEffect(() => {
    if (!client) return
    let checking = false
    const onError = async (error: unknown) => {
      if (!(error instanceof BaoError) || checking) return
      checking = true
      try {
        if (isAuthFailure(error)) {
          await client.lookupSelf()
        } else if (error.kind === 'unavailable') {
          if ((await client.health()).sealed) expire('sealed')
        }
      } catch (e) {
        if (e instanceof BaoError && isAuthFailure(e)) expire('expired')
      } finally {
        checking = false
      }
    }
    const unsubQ = qc.getQueryCache().subscribe((ev) => {
      if (ev.type === 'updated' && ev.action.type === 'error') void onError(ev.query.state.error)
    })
    const unsubM = qc.getMutationCache().subscribe((ev) => {
      if (ev.type === 'updated' && ev.action.type === 'error') void onError(ev.mutation.state.error)
    })
    return () => {
      unsubQ()
      unsubM()
    }
  }, [client, qc, expire])

  return null
}
