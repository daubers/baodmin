import { DYNAMIC_ACCESS, type DynamicAccess } from '../../model/managed'

/** Checkboxes for what a grant on a dynamic-engine role allows. */
export function DynamicAccessPicker({ value, onChange }: { value: DynamicAccess[]; onChange: (v: DynamicAccess[]) => void }) {
  return (
    <fieldset className="caps">
      <legend>Access</legend>
      {DYNAMIC_ACCESS.map((a) => (
        <label key={a.id} className="check">
          <input
            type="checkbox"
            checked={value.includes(a.id)}
            onChange={(e) => onChange(e.target.checked ? [...value, a.id] : value.filter((x) => x !== a.id))}
          />
          <span>
            {a.label}
            <span className="hint"> {a.help}</span>
          </span>
        </label>
      ))}
    </fieldset>
  )
}
