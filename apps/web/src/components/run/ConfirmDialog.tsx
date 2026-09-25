import { useId } from 'react'
import type { ReactNode } from 'react'
import { Button, Dialog, DialogBody, DialogFooter, DialogHeader } from '../../ui'

/**
 * The run view's destructive confirmations on the foundation's dialog primitive
 * (decision #12a). Both of them — Cancel run and Retry fresh — used to be a
 * native `confirm()` or no question at all, which is how the run view ended up
 * with the strictly less destructive action (Retry fresh, one ticket) asking
 * while the one that kills every agent in the run did not.
 *
 * The body states the blast radius rather than asking "are you sure": what
 * stops, and what survives it. One `danger` action, last; the way out is a ghost.
 */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  confirmIcon,
  busy,
  onConfirm,
  onClose,
}: {
  open: boolean
  title: string
  body: ReactNode
  confirmLabel: string
  /** The confirm button's leading glyph — the same one the action wears in the page. */
  confirmIcon?: ReactNode
  busy?: boolean
  onConfirm: () => void
  onClose: () => void
}) {
  const titleId = useId()
  return (
    <Dialog open={open} onClose={onClose} size="sm" labelledBy={titleId}>
      <DialogHeader id={titleId} title={title} onClose={onClose} />
      <DialogBody>
        <p className="m-0 text-sm text-pretty text-text-secondary">{body}</p>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          Keep going
        </Button>
        <Button
          variant="danger"
          icon={confirmIcon}
          autoFocus
          disabled={busy}
          onClick={() => {
            onConfirm()
            onClose()
          }}
        >
          {confirmLabel}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
