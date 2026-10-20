import { createContext, useContext } from 'react'

export interface ConfirmOptions {
  title: string
  message?: string
  /** Label of the confirming button, e.g. "Delete". */
  confirmLabel: string
}

export type Confirm = (options: ConfirmOptions) => Promise<boolean>

export const ConfirmContext = createContext<Confirm | null>(null)

/** Ask before a destructive action. Falls back to the browser's confirm() when no provider is mounted. */
export function useConfirm(): Confirm {
  const confirm = useContext(ConfirmContext)
  return confirm ?? (async (o) => window.confirm(o.message ? `${o.title}\n${o.message}` : o.title))
}
