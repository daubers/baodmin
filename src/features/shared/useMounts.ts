import { useQuery } from '@tanstack/react-query'
import type { BaoClient } from '../../api/bao'
import { mountKind } from '../../api/engines/registry'
import { listMounts } from '../../api/secrets'

/** KV v2 and dynamic-engine mounts (system, cubbyhole and identity mounts are left out). */
export function useMounts(client: BaoClient) {
  return useQuery({
    queryKey: ['mounts'],
    queryFn: async () => (await listMounts(client)).filter((m) => mountKind(m) !== null),
  })
}
