import { engineFor } from '../../api/engines/registry'
import type { Mount } from '../../api/secrets'

/** Roles / Config / Leases for a dynamic secrets engine. Filled in by later phases. */
export function EngineView({ mount }: { mount: Mount }) {
  const engine = engineFor(mount.type)
  return (
    <p className="secret-placeholder">
      {engine.label} engine at {mount.path}: role management is coming soon.
    </p>
  )
}
