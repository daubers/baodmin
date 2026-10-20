import { useQuery } from '@tanstack/react-query'
import { useId, useState } from 'react'
import type { BaoClient } from '../../api/bao'
import { listSecrets } from '../../api/secrets'

interface Props {
  client: BaoClient
  mount: string
  /** Path within the mount: a secret ("app/db"), or a folder wildcard ("app/*", "*"). */
  value: string
  onChange: (path: string) => void
}

/**
 * Pick a secret by browsing the mount, or tick "everything inside" to grant a whole folder.
 * Lists names only; secret values are never read.
 */
export function PathPicker({ client, mount, value, onChange }: Props) {
  const id = useId()
  const [prefix, setPrefix] = useState('')
  const [manual, setManual] = useState(false)
  const entries = useQuery({ queryKey: ['secrets', mount, prefix], queryFn: () => listSecrets(client, mount, prefix) })

  const wildcard = value === `${prefix}*`
  const crumbs = prefix.split('/').filter(Boolean)

  function open(next: string) {
    setPrefix(next)
    // Keep the "everything inside" intent while moving between folders.
    onChange(wildcard ? `${next}*` : '')
  }

  if (manual) {
    return (
      <div className="path-picker">
        <label>
          Secret path
          <input value={value} onChange={(e) => onChange(e.target.value)} placeholder="app/db or app/*" />
        </label>
        <p className="hint">
          For a secret that doesn’t exist yet. A trailing * matches everything below.{' '}
          <button type="button" className="link" onClick={() => setManual(false)}>
            Browse secrets instead
          </button>
        </p>
      </div>
    )
  }

  const where = prefix ? `${mount}${prefix}` : mount

  return (
    <fieldset className="path-picker">
      <legend>Secret</legend>
      <nav aria-label="Folder" className="crumbs">
        <button type="button" onClick={() => open('')}>
          {mount}
        </button>
        {crumbs.map((c, i) => (
          <button key={i} type="button" onClick={() => open(`${crumbs.slice(0, i + 1).join('/')}/`)}>
            {c}/
          </button>
        ))}
      </nav>

      {entries.isPending && <p className="hint">Loading…</p>}
      {entries.error && <p role="alert">Can’t list secrets here: {entries.error.message}</p>}
      {entries.data?.length === 0 && <p className="hint">Nothing in {where} yet.</p>}
      {!!entries.data?.length && (
        <ul className="entries" aria-label={`Contents of ${where}`}>
          {entries.data.map((e) => (
            <li key={e.path}>
              {e.isFolder ? (
                <button type="button" className="entry-folder" aria-label={`Open ${e.name}`} onClick={() => open(e.path)}>
                  {e.name}
                  <span aria-hidden="true">›</span>
                </button>
              ) : (
                <label className="entry-secret">
                  <input
                    type="radio"
                    name={`${id}-secret`}
                    checked={value === e.path}
                    disabled={wildcard}
                    onChange={() => onChange(e.path)}
                  />
                  {e.name}
                </label>
              )}
            </li>
          ))}
        </ul>
      )}

      <label className="check">
        <input type="checkbox" checked={wildcard} onChange={(e) => onChange(e.target.checked ? `${prefix}*` : '')} />
        <span>
          Everything inside <code>{where}</code>, including subfolders and new secrets
        </span>
      </label>

      <p className="hint" aria-live="polite">
        {value ? (
          <>
            Granting on <code>{wildcard ? `${where}*` : `${mount}${value}`}</code>.
          </>
        ) : (
          'Choose a secret or tick the box above.'
        )}{' '}
        <button type="button" className="link" onClick={() => setManual(true)}>
          Type a path instead
        </button>
      </p>
    </fieldset>
  )
}
