import { useQuery } from '@tanstack/react-query'
import { useId } from 'react'
import type { BaoClient } from '../../api/bao'
import type { EngineDef } from '../../api/engines/registry'
import { listRoles } from '../../api/engines/roles'

export interface RoleSelection {
  kindId: string
  /** A role name, "*" for every role of the kind, or "" for none chosen yet. */
  role: string
}

/** Pick a role of a dynamic engine (or all of them) to grant access to. Lists role names only. */
export function RolePicker({
  client,
  mount,
  engine,
  value,
  onChange,
}: {
  client: BaoClient
  mount: string
  engine: EngineDef
  value: RoleSelection
  onChange: (v: RoleSelection) => void
}) {
  const id = useId()
  const kind = engine.roleKinds.find((k) => k.id === value.kindId) ?? engine.roleKinds[0]
  const roles = useQuery({ queryKey: ['engine-roles', mount, kind.id], queryFn: () => listRoles(client, mount, kind) })
  const all = value.role === '*'

  return (
    <fieldset className="path-picker">
      <legend>Role</legend>
      {engine.roleKinds.length > 1 && (
        <label>
          Role type
          <select value={kind.id} onChange={(e) => onChange({ kindId: e.target.value, role: '' })}>
            {engine.roleKinds.map((k) => (
              <option key={k.id} value={k.id}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {roles.isPending && <p className="hint">Loading…</p>}
      {roles.error && <p role="alert">Can’t list roles here: {roles.error.message}</p>}
      {roles.data?.length === 0 && <p className="hint">No roles in {mount}{kind.path} yet.</p>}
      {!!roles.data?.length && (
        <ul className="entries" aria-label={`Roles in ${mount}`}>
          {roles.data.map((name) => (
            <li key={name}>
              <label className="entry-secret">
                <input
                  type="radio"
                  name={`${id}-role`}
                  checked={value.role === name}
                  disabled={all}
                  onChange={() => onChange({ kindId: kind.id, role: name })}
                />
                {name}
              </label>
            </li>
          ))}
        </ul>
      )}
      <label className="check">
        <input
          type="checkbox"
          checked={all}
          onChange={(e) => onChange({ kindId: kind.id, role: e.target.checked ? '*' : '' })}
        />
        <span>
          Every role in <code>{mount}{kind.path}</code>, including ones added later
        </span>
      </label>
    </fieldset>
  )
}
