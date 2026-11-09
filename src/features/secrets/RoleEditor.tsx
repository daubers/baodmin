import { useId, type FormEvent } from 'react'
import type { FieldDef, RoleKind } from '../../api/engines/registry'
import type { RoleDraft } from '../../api/engines/roles'

function Field({ field, value, onChange }: { field: FieldDef; value: string | boolean; onChange: (v: string | boolean) => void }) {
  const helpId = useId()
  const help = field.help ? (
    <span id={helpId} className="hint">
      {field.help}
    </span>
  ) : null
  const describedBy = field.help ? helpId : undefined

  if (field.type === 'bool') {
    return (
      <label>
        <input type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} aria-describedby={describedBy} />{' '}
        {field.label}
      </label>
    )
  }
  if (field.type === 'select') {
    return (
      <label>
        {field.label}
        <select value={String(value)} onChange={(e) => onChange(e.target.value)} required={field.required} aria-describedby={describedBy}>
          {field.options?.map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
        {help}
      </label>
    )
  }
  if (field.type === 'textarea' || field.type === 'statements') {
    return (
      <label>
        {field.label}
        <textarea
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}
          rows={field.type === 'statements' ? 5 : 4}
          required={field.required}
          spellCheck={false}
          aria-describedby={describedBy}
        />
        {help}
      </label>
    )
  }
  return (
    <label>
      {field.label}
      <input
        value={String(value)}
        onChange={(e) => onChange(e.target.value)}
        required={field.required}
        placeholder={field.type === 'ttl' ? 'e.g. 1h (optional)' : field.type === 'list' ? 'comma separated' : undefined}
        aria-describedby={describedBy}
      />
      {help}
    </label>
  )
}

export function RoleEditor({
  kind,
  draft,
  pending,
  error,
  onChange,
  onSubmit,
  onCancel,
}: {
  kind: RoleKind
  draft: RoleDraft
  pending: boolean
  error: string | null
  onChange: (d: RoleDraft) => void
  onSubmit: () => void
  onCancel: () => void
}) {
  const title = draft.isNew ? `New ${kind.label.toLowerCase()} role` : `Edit ${draft.name}`
  function submit(e: FormEvent) {
    e.preventDefault()
    onSubmit()
  }
  return (
    <form onSubmit={submit} aria-label={title} className="wide">
      <h3>{title}</h3>
      <label>
        Role name
        <input value={draft.name} disabled={!draft.isNew} onChange={(e) => onChange({ ...draft, name: e.target.value })} required />
      </label>
      {kind.fields.length === 0 ? (
        <label>
          Role (JSON)
          <textarea value={draft.json} onChange={(e) => onChange({ ...draft, json: e.target.value })} rows={10} spellCheck={false} />
        </label>
      ) : (
        kind.fields.map((f) => (
          <Field
            key={f.key}
            field={f}
            value={draft.values[f.key] ?? ''}
            onChange={(v) => onChange({ ...draft, values: { ...draft.values, [f.key]: v } })}
          />
        ))
      )}
      {error && <p role="alert">{error}</p>}
      <div className="form-actions">
        <button type="submit" disabled={pending}>
          Save
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  )
}
