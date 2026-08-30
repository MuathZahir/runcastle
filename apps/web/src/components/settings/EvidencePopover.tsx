import { useEffect, useRef } from 'react'
import type { FindingSource } from '@runcastle/core'

/**
 * What preparation observed to justify a value, behind the row's provenance chip
 * (flow-redesign-settings, decision 5).
 *
 * The evidence runs to hundreds or thousands of words per field, and rendering
 * it inline turned "Commands" into several screens of prose around six inputs.
 * It is still the only thing that separates a measured value from a guess, so it
 * stays one click away rather than being deleted.
 *
 * Renders as the *sibling* of the chip that opened it, inside a positioned
 * wrapper — that is what lets a press on the chip count as "inside", so the
 * chip's own click toggles the popover instead of reopening what it just closed.
 */

/** How a finding's source reads in the popover's header. */
const HOW_ESTABLISHED: Record<FindingSource, string> = {
  prep: 'established by preparation',
  session: 'established in a conversation on this machine',
  human: 'set by you',
}

export function EvidencePopover({
  source,
  evidence,
  onClose,
}: {
  source: FindingSource
  evidence: string
  onClose: () => void
}) {
  const cardRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // Capture phase, ahead of the Dialog's own `window` listener: Escape
      // answers the smaller of the two things open. Bubbling it would take the
      // whole settings dialog down with the popover, on one key.
      e.stopPropagation()
      onClose()
    }
    const onDown = (e: MouseEvent) => {
      const anchor = cardRef.current?.parentElement
      if (e.target instanceof Node && anchor?.contains(e.target)) return
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('mousedown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('mousedown', onDown)
    }
  }, [onClose])

  return (
    <div
      ref={cardRef}
      className="absolute top-6.5 left-0 z-10 max-h-65 w-105 overflow-auto rounded-md border border-hairline-strong bg-panel-3 px-3 py-2.5 shadow-overlay"
    >
      <h4 className="mb-1.5 text-xs font-semibold tracking-[0.06em] text-text-3 uppercase">
        Evidence · {HOW_ESTABLISHED[source]}
      </h4>
      <pre className="font-mono text-sm leading-normal whitespace-pre-wrap text-text-2">
        {evidence}
      </pre>
    </div>
  )
}
