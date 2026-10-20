import type { ReactNode } from 'react'
import { Link } from 'react-router'
import type { BaoClient } from '../../api/bao'
import { useSession } from '../../api/useSession'

export function RequireConnection({ children }: { children: (client: BaoClient) => ReactNode }) {
  const { client } = useSession()
  if (!client) {
    return (
      <p>
        Not connected. <Link to="/connect">Connect to OpenBao</Link> first.
      </p>
    )
  }
  return <>{children(client)}</>
}
