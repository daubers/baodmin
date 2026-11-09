import { useState } from 'react'
import type { BaoClient } from '../../api/bao'
import { engineFor } from '../../api/engines/registry'
import type { Mount } from '../../api/secrets'
import { ConfigPanel } from './ConfigPanel'
import { RolesPanel } from './RolesPanel'

type Tab = 'roles' | 'config'

/** Roles and Config (and, in a later phase, Leases) for a dynamic secrets engine. */
export function EngineView({ client, mount }: { client: BaoClient; mount: Mount }) {
  const engine = engineFor(mount.type)
  const [tab, setTab] = useState<Tab>('roles')
  const tabs: { id: Tab; label: string }[] = [{ id: 'roles', label: 'Roles' }]
  if (engine.configs.length > 0) tabs.push({ id: 'config', label: 'Config' })
  const current = tabs.some((t) => t.id === tab) ? tab : 'roles'

  return (
    <div className="engine-view">
      <h2>
        {engine.label} · {mount.path}
      </h2>
      {tabs.length > 1 && (
        <div role="tablist" aria-label="Engine" className="tabs">
          {tabs.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={t.id === current} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
      )}
      {current === 'roles' && <RolesPanel key={mount.path} client={client} mount={mount.path} engine={engine} />}
      {current === 'config' && <ConfigPanel key={mount.path} client={client} mount={mount.path} engine={engine} />}
    </div>
  )
}
