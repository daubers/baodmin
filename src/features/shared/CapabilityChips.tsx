// Capabilities that let someone change or remove data, or bypass policy checks.
const RISKY = new Set(['delete', 'sudo'])

/** A grant's capabilities as chips; the risky ones are red. Everything-plus-sudo reads as "full access". */
export function CapabilityChips({ capabilities }: { capabilities: readonly string[] }) {
  const full = ['create', 'read', 'update', 'delete', 'list', 'sudo'].every((c) => capabilities.includes(c))
  return (
    <ul className="chips">
      {full ? (
        <li className="risky">full access</li>
      ) : (
        capabilities.map((c) => (
          <li key={c} className={RISKY.has(c) ? 'risky' : undefined}>
            {c}
          </li>
        ))
      )}
    </ul>
  )
}
