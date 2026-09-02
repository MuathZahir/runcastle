import { useEffect, useRef, useState } from 'react'

/**
 * Landing on the row a deep link named (decision 9).
 *
 * Shared by the setting rows and the Burns prerequisites checklist: an error
 * message that says "Settings → Burns (Rebuild image)" points at a doctor probe,
 * not at a setting key, and both kinds of row have to answer a link the same way
 * or the link is only half a link.
 */

/** How long a deep-linked row keeps its accent outline. */
const HIGHLIGHT_MS = 1500

/** The outline a flashing row wears. */
export const HIGHLIGHT_RING = 'rounded-sm outline-2 outline-offset-2 outline-accent'

export function useHighlight<T extends HTMLElement>(active: boolean | undefined) {
  const ref = useRef<T>(null)
  const [flash, setFlash] = useState(false)

  useEffect(() => {
    if (!active) return
    ref.current?.scrollIntoView?.({ block: 'center' })
    setFlash(true)
    const timer = setTimeout(() => setFlash(false), HIGHLIGHT_MS)
    return () => clearTimeout(timer)
  }, [active])

  return { ref, flash }
}
