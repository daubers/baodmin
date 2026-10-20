import { useQueryClient } from '@tanstack/react-query'

/** After a grant changes: reload everything that shows who can reach what. */
export function useRefreshAccess() {
  const qc = useQueryClient()
  return () =>
    Promise.all(
      ['grant-state', 'users', 'entities', 'groups', 'access-inputs', 'policies'].map((k) => qc.invalidateQueries({ queryKey: [k] })),
    )
}
