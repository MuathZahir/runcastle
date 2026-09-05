import type { ReactNode } from 'react'
import { Button, Dialog } from '../../ui'

/**
 * The run view's destructive confirmations on the foundation's dialog primitive
 * (decision #12a). Both of them — Cancel run and Retry fresh — used to be a
 * native `confirm()` or no question at all, which is how the run view ended up
 * with the strictly less destructive action (Retry fresh, one ticket) asking
 * while the one that kills every agent in the run did not.
 *
 * The body states the blast radius rather than asking "are you sure": what
 * stops, and what survives it.
 */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  busy,
  onConfirm,
  onClose,
}: {
  open: boolean
  title: string
  body: ReactNode
  confirmLabel: string
  busy?: boolean
  onConfirm: () => void
  onClose: () => void
}) {
  return (
    <Dialog open={open} onClose={onClose} size="sm" label={title}>
      <div className="flex flex-col gap-6 p-6">
        <div className="flex flex-col gap-2">
          <strong className="text-lg font-semibold text-text">{title}</strong>
          <div className="text-base leading-relaxed text-text-2">{body}</div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Keep going
          </Button>
          <Button
            variant="danger"
            autoFocus
            disabled={busy}
            onClick={() => {
              onConfirm()
              onClose()
            }}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
