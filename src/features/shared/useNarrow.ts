import { useSyncExternalStore } from 'react'

const QUERY = '(max-width: 40rem)'
const supported = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function'

/** True on phone-width screens (matches the 40rem breakpoint in index.css). */
export function useNarrow(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (!supported()) return () => {}
      const m = window.matchMedia(QUERY)
      m.addEventListener('change', onChange)
      return () => m.removeEventListener('change', onChange)
    },
    () => supported() && window.matchMedia(QUERY).matches,
    () => false,
  )
}
