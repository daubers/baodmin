interface Query {
  isPending: boolean
  error: Error | null
  data?: unknown[]
}

/** Loading / error / empty feedback for a list. Renders nothing once there is data to show. */
export function ListState({ query, empty }: { query: Query; empty: string }) {
  if (query.isPending) return <p role="status">Loading…</p>
  if (query.error) return <p role="alert">{query.error.message}</p>
  if (query.data?.length === 0) return <p>{empty}</p>
  return null
}
