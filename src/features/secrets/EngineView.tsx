import type { BaoClient } from '../../api/bao'
import { engineFor } from '../../api/engines/registry'
import type { Mount } from '../../api/secrets'
import { RolesPanel } from './RolesPanel'

/** Roles (and, in later phases, Config / Leases) for a dynamic secrets engine. */
export function EngineView({ client, mount }: { client: BaoClient; mount: Mount }) {
  const engine = engineFor(mount.type)
  return (
    <div className="engine-view">
      <h2>
        {engine.label} · {mount.path}
      </h2>
      <RolesPanel key={mount.path} client={client} mount={mount.path} engine={engine} />
    </div>
  )
}
