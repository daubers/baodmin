import { NavLink, Outlet } from 'react-router'

const links = [
  { to: '/identities', label: 'Identities' },
  { to: '/secrets', label: 'Secrets' },
  { to: '/graph', label: 'Graph' },
]

export function Layout() {
  return (
    <div className="shell">
      <nav aria-label="Main">
        <strong>EnvBao</strong>
        {links.map((l) => (
          <NavLink key={l.to} to={l.to}>
            {l.label}
          </NavLink>
        ))}
        <NavLink to="/connect" className="connect">
          Connect
        </NavLink>
      </nav>
      <main>
        <Outlet />
      </main>
    </div>
  )
}
