import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Button } from '../ui'

/**
 * The shared shell around the two creation forms (New feature, Quick change).
 *
 * It exists because the two disagreed about what dismissal means (findings
 * F25.2): Escape threw away everything typed without a word, while clicking
 * outside the card did nothing at all — so the same intent, expressed two ways,
 * had two different outcomes and one of them was destructive. Here there is one
 * dismissal, reached from Escape, the backdrop and the form's own Cancel, and it
 * never destroys prose silently: with anything typed it asks first.
 *
 * `children` is a render prop so the form's Cancel button goes through the same
 * guard as everything else rather than calling `onDismiss` behind its back.
 */
export function FormOverlay({
  dirty,
  onDismiss,
  children,
}: {
  /** Something has been typed that dismissing would throw away. */
  dirty: boolean
  onDismiss: () => void
  children: (dismiss: () => void) => ReactNode
}) {
  const [confirming, setConfirming] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // The palette and the settings dialog can be open ON TOP of this form,
      // and they own the Escape that closes them. Answer only when the focus is
      // ours — or nowhere, which is where a click on our own backdrop leaves it.
      const focused = document.activeElement
      const mine = focused === null || focused === document.body || !!cardRef.current?.contains(focused)
      if (!mine) return
      // Escape out of the question first — it is the smaller of the two things
      // open, and answering it with the same key that raised it would be a trap.
      if (confirming) setConfirming(false)
      else if (dirty) setConfirming(true)
      else onDismiss()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [confirming, dirty, onDismiss])

  const dismiss = () => {
    if (dirty) setConfirming(true)
    else onDismiss()
  }

  return (
    <div
      className="nf-overlay"
      // mousedown, not click: a click that STARTS inside the card and ends on
      // the backdrop (selecting text and releasing outside) is not a dismissal.
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) dismiss()
      }}
    >
      <div className="nf-card" ref={cardRef}>
        {children(dismiss)}
        {confirming && (
          <div className="nf-discard" role="alert">
            <span className="nf-discard-text">Discard what you have typed?</span>
            <span className="nf-discard-spacer" />
            <Button variant="ghost" className="btn-xs" onClick={() => setConfirming(false)}>
              Keep editing
            </Button>
            <Button variant="danger" className="btn-xs" onClick={onDismiss}>
              Discard
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
