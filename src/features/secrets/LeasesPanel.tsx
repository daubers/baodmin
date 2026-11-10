import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type { BaoClient } from '../../api/bao'
import { listLeases, lookupLease, renewLease, revokeLease, revokePrefix } from '../../api/engines/leases'
import { ListState } from '../shared/ListState'
import { useConfirm } from '../shared/useConfirm'

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : 'never')

function LeaseRow({ client, id, name, onChanged }: { client: BaoClient; id: string; name: string; onChanged: () => void }) {
  const confirm = useConfirm()
  const [open, setOpen] = useState(false)
  const info = useQuery({ queryKey: ['lease', id], queryFn: () => lookupLease(client, id), enabled: open, retry: false })
  const renew = useMutation({
    mutationFn: () => renewLease(client, id),
    onSuccess: () => info.refetch(),
  })
  const revoke = useMutation({ mutationFn: () => revokeLease(client, id), onSuccess: onChanged })

  return (
    <li className="lease-row">
      <span>{name}</span>
      <button type="button" aria-expanded={open} aria-label={`Details ${name}`} onClick={() => setOpen(!open)}>
        Details
      </button>
      <button
        type="button"
        aria-label={`Revoke ${name}`}
        onClick={async () => {
          if (await confirm({ title: 'Revoke this lease?', message: 'The credentials it issued stop working immediately.', confirmLabel: 'Revoke' }))
            revoke.mutate()
        }}
      >
        Revoke
      </button>
      {open && info.isPending && <p role="status">Loading…</p>}
      {open && info.error && <p role="alert">{info.error.message}</p>}
      {open && info.data && (
        <dl aria-label={`Lease ${name}`}>
          <dt>Issued</dt>
          <dd>{when(info.data.issueTime)}</dd>
          <dt>Expires</dt>
          <dd>{when(info.data.expireTime)}</dd>
          <dt>Remaining</dt>
          <dd>{info.data.ttl}s</dd>
          {info.data.lastRenewal && (
            <>
              <dt>Last renewed</dt>
              <dd>{when(info.data.lastRenewal)}</dd>
            </>
          )}
          {info.data.renewable && (
            <dd>
              <button type="button" onClick={() => renew.mutate()} disabled={renew.isPending}>
                Renew
              </button>
            </dd>
          )}
        </dl>
      )}
      {renew.error && <p role="alert">{renew.error.message}</p>}
      {revoke.error && <p role="alert">{revoke.error.message}</p>}
    </li>
  )
}

/** Browse and revoke the leases issued by a dynamic engine mount. */
export function LeasesPanel({ client, mount }: { client: BaoClient; mount: string }) {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [prefix, setPrefix] = useState(mount)

  const key = ['leases', mount, prefix]
  const entries = useQuery({ queryKey: key, queryFn: () => listLeases(client, prefix), retry: false })
  const refresh = () => qc.invalidateQueries({ queryKey: ['leases', mount] })
  const revokeAll = useMutation({
    mutationFn: () => revokePrefix(client, prefix),
    onSuccess: refresh,
  })

  const crumbs = prefix.slice(mount.length).split('/').filter(Boolean)
  const atRoot = prefix === mount

  return (
    <section aria-label="Leases">
      <nav aria-label="Lease path" className="crumbs">
        <button type="button" onClick={() => setPrefix(mount)}>
          {mount}
        </button>
        {crumbs.map((c, i) => (
          <button key={i} type="button" onClick={() => setPrefix(mount + crumbs.slice(0, i + 1).join('/') + '/')}>
            {c}/
          </button>
        ))}
      </nav>
      <ListState query={entries} empty={`No leases under ${prefix}.`} />
      {!!entries.data?.length && (
        <ul className="entries" aria-label={`Leases under ${prefix}`}>
          {entries.data.map((e) =>
            e.isFolder ? (
              <li key={e.path}>
                <button type="button" className="entry-folder" onClick={() => setPrefix(e.path)}>
                  {e.name}
                  <span aria-hidden="true">›</span>
                </button>
              </li>
            ) : (
              <LeaseRow key={e.path} client={client} id={e.path} name={e.name} onChanged={refresh} />
            ),
          )}
        </ul>
      )}
      {!atRoot && (
        <button
          type="button"
          onClick={async () => {
            if (
              await confirm({
                title: `Revoke every lease under ${prefix}?`,
                message: 'All credentials issued under this prefix stop working immediately. This cannot be undone.',
                confirmLabel: 'Revoke all',
              })
            )
              revokeAll.mutate()
          }}
          disabled={revokeAll.isPending}
        >
          Revoke all under this prefix
        </button>
      )}
      {revokeAll.error && <p role="alert">{revokeAll.error.message}</p>}
    </section>
  )
}
