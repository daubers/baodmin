import { Navigate, type RouteObject } from 'react-router'
import { ConnectPage } from './features/connect/ConnectPage'
import { GraphPage } from './features/graph/GraphPage'
import { IdentitiesPage } from './features/identities/IdentitiesPage'
import { SecretsPage } from './features/secrets/SecretsPage'
import { Layout } from './Layout'

export const routes: RouteObject[] = [
  {
    element: <Layout />,
    children: [
      { index: true, element: <Navigate to="/identities" replace /> },
      { path: 'connect', element: <ConnectPage /> },
      { path: 'identities', element: <IdentitiesPage /> },
      { path: 'secrets', element: <SecretsPage /> },
      { path: 'graph', element: <GraphPage /> },
    ],
  },
]
