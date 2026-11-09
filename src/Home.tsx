import { Navigate } from 'react-router'
import { useSession } from './api/useSession'

/** The landing route: straight to the work when signed in, otherwise to the only page that can be used. */
export function Home() {
  const { client } = useSession()
  return <Navigate to={client ? '/identities' : '/connect'} replace />
}
