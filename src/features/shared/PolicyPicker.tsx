import { useQuery } from '@tanstack/react-query'
import type { BaoClient } from '../../api/bao'
import { listPolicyNames } from '../../api/identities'

interface Props {
  client: BaoClient
  value: string[]
  onChange: (policies: string[]) => void
}

export function PolicyPicker({ client, value, onChange }: Props) {
  const { data, error } = useQuery({ queryKey: ['policies'], queryFn: () => listPolicyNames(client) })
  // Keep policies that are attached but no longer exist selectable, so editing doesn't drop them silently.
  const names = [...new Set([...(data ?? []), ...value])].filter((n) => n !== 'root').sort()
  return (
    <fieldset className="pick-grid">
      <legend>Policies</legend>
      {error && <p role="alert">Could not load policies: {error.message}</p>}
      {names.map((n) => (
        <label key={n} className="check">
          <input
            type="checkbox"
            checked={value.includes(n)}
            onChange={(e) => onChange(e.target.checked ? [...value, n] : value.filter((v) => v !== n))}
          />{' '}
          {n}
        </label>
      ))}
    </fieldset>
  )
}
