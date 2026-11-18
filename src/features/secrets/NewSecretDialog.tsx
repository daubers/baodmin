import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type { BaoClient } from '../../api/bao'
import { writeSecret } from '../../api/secrets'
import { validateSecretPath } from '../../model/mounts'

interface Row {
  key: string
  value: string
}

/** Create a new KV v2 secret under the current path. Values are write-only and existing secrets are never overwritten. */
export function NewSecretDialog({ client, mount, prefix, onClose, onDone }: {
  client: BaoClient
  mount: string
  prefix: string
  onClose: () => void
  onDone: (path: string) => void
}) {
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [rows, setRows] = useState<Row[]>([{ key: '', value: '' }])
  const [formError, setFormError] = useState<string | null>(null)

  const create = useMutation({
    mutationFn: async () => {
      const path = prefix + name.trim()
      const data: Record<string, string> = {}
      for (const r of rows) data[r.key.trim()] = r.value
      await writeSecret(client, mount, path, data)
      await qc.invalidateQueries({ queryKey: ['kv-list'] })
      return path
    },
    onSuccess: (path) => onDone(path),
  })

  const setRow = (i: number, patch: Partial<Row>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)
    const nameError = validateSecretPath(name.trim())
    if (nameError) return setFormError(nameError)
    const keys = rows.map((r) => r.key.trim())
    if (keys.some((k) => !k)) return setFormError('Every key needs a name.')
    if (new Set(keys).size !== keys.length) return setFormError('Keys must be unique.')
    create.mutate()
  }

  return (
    <section aria-label="New secret" className="mount-dialog">
      <form aria-label="New secret form" onSubmit={submit}>
        <label>
          Name
          <span className="hint"> in {mount}{prefix}</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="expo" autoComplete="off" />
        </label>
        <div className="kv-rows">
          {rows.map((r, i) => (
            <div className="kv-row" key={i}>
              <input aria-label={`Key ${i + 1}`} placeholder="key" value={r.key} autoComplete="off" onChange={(e) => setRow(i, { key: e.target.value })} />
              <input aria-label={`Value ${i + 1}`} type="password" placeholder="value" value={r.value} autoComplete="new-password" onChange={(e) => setRow(i, { value: e.target.value })} />
              <button type="button" disabled={rows.length === 1} onClick={() => setRows(rows.filter((_, j) => j !== i))}>
                Remove
              </button>
            </div>
          ))}
          <div>
            <button type="button" onClick={() => setRows([...rows, { key: '', value: '' }])}>
              Add key
            </button>
          </div>
        </div>
        <p className="hint">Values are write-only: they are never shown again, and an existing secret is never overwritten.</p>
        {(formError ?? create.error) && <p role="alert">{formError ?? create.error?.message}</p>}
        <button type="submit" disabled={create.isPending}>
          {create.isPending ? 'Saving…' : 'Create'}
        </button>
        <button type="button" onClick={onClose}>
          Cancel
        </button>
      </form>
    </section>
  )
}
