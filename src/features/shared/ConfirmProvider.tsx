import { useCallback, useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { ConfirmContext, type Confirm, type ConfirmOptions } from './useConfirm'

interface Pending {
  options: ConfirmOptions
  resolve: (ok: boolean) => void
}

/** Renders one modal confirmation dialog for the whole app; open it with useConfirm(). */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null)
  const dialog = useRef<HTMLDialogElement>(null)

  const confirm = useCallback<Confirm>((options) => new Promise((resolve) => setPending({ options, resolve })), [])

  useEffect(() => {
    const el = dialog.current
    if (!pending || !el) return
    // showModal gives focus trapping, Escape and an inert page; fall back to a plain open dialog without it.
    if (typeof el.showModal === 'function') el.showModal()
    else el.setAttribute('open', '')
  }, [pending])

  function settle(ok: boolean) {
    pending?.resolve(ok)
    setPending(null)
  }

  return (
    <ConfirmContext value={confirm}>
      {children}
      {pending && (
        <dialog
          ref={dialog}
          className="confirm-dialog"
          aria-labelledby="confirm-title"
          aria-describedby={pending.options.message ? 'confirm-message' : undefined}
          onCancel={(e) => {
            e.preventDefault()
            settle(false)
          }}
          // A click on the backdrop lands on the dialog element itself, not on its content.
          onClick={(e: MouseEvent<HTMLDialogElement>) => e.target === e.currentTarget && settle(false)}
        >
          <h2 id="confirm-title">{pending.options.title}</h2>
          {pending.options.message && <p id="confirm-message">{pending.options.message}</p>}
          <div className="confirm-actions">
            <button type="button" autoFocus onClick={() => settle(false)}>
              Cancel
            </button>
            <button type="button" className="danger-solid" onClick={() => settle(true)}>
              {pending.options.confirmLabel}
            </button>
          </div>
        </dialog>
      )}
    </ConfirmContext>
  )
}
