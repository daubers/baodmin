import { KV_CAPABILITIES, type KvCapability } from '../../model/managed'

interface Props {
  value: KvCapability[]
  onChange: (value: KvCapability[]) => void
}

/** Checkboxes for the KV capabilities a grant can carry. */
export function CapabilityPicker({ value, onChange }: Props) {
  return (
    <fieldset className="caps">
      <legend>Capabilities</legend>
      {KV_CAPABILITIES.map((c) => (
        <label key={c} className="check">
          <input
            type="checkbox"
            checked={value.includes(c)}
            onChange={(e) => onChange(e.target.checked ? [...value, c] : value.filter((x) => x !== c))}
          />{' '}
          {c}
        </label>
      ))}
    </fieldset>
  )
}
