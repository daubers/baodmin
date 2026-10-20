import { isManagedPolicy } from '../../model/graph'

function Empty() {
  return <span className="hint">None</span>
}

/** Policy names as chips; the ones EnvBao manages are tinted. */
export function PolicyChips({ policies }: { policies: readonly string[] }) {
  if (policies.length === 0) return <Empty />
  return (
    <ul className="chips plain">
      {policies.map((p) => (
        <li key={p} className={isManagedPolicy(p) ? 'managed' : undefined}>
          {p}
        </li>
      ))}
    </ul>
  )
}

/** Plain names (aliases, members) as neutral chips. */
export function NameChips({ names }: { names: readonly string[] }) {
  if (names.length === 0) return <Empty />
  return (
    <ul className="chips plain">
      {names.map((n) => (
        <li key={n}>{n}</li>
      ))}
    </ul>
  )
}
