import { Link, NavLink, Outlet } from 'react-router'
import { useSession } from './api/useSession'

const links = [
  { to: '/identities', label: 'Identities' },
  { to: '/secrets', label: 'Secrets' },
  { to: '/graph', label: 'Graph' },
]

const notices = {
  expired: 'Your session has expired or the token was revoked.',
  sealed: 'OpenBao has been sealed.',
}

export function Layout() {
  const { notice, client, tokenInfo } = useSession()
  return (
    <div className="shell">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <nav aria-label="Main">
        <strong>EnvBao</strong>
        {links.map((l) => (
          <NavLink key={l.to} to={l.to}>
            {l.label}
          </NavLink>
        ))}
        {client ? (
          // Signed in: the name is the way back to the connection details and Disconnect.
          <NavLink to="/connect" className="whoami" title="Connection details and sign out">
            {tokenInfo?.display_name || 'token'}
          </NavLink>
        ) : (
          <NavLink to="/connect" className="connect">
            Connect
          </NavLink>
        )}
      </nav>
      {notice && (
        <div role="alert" className="notice">
          {notices[notice]} <Link to="/connect">Sign in again</Link>
        </div>
      )}
      <main id="main" tabIndex={-1}>
        <Outlet />
      </main>
    </div>
  )
}
