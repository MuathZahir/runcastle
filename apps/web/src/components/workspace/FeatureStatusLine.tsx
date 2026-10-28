import { Button, Dialog, DialogFooter, DialogHeader, StatusDot } from '../../ui'
import type { StatusTone } from '../../ui'
import { IconStop } from '../../icons'
import type { FeatureStatus, FeatureStatusKind } from '../../lib/feature-ui/status-line'

/** Shape first, hue confirms (DESIGN.md principle 3) — one tone per status. */
const STATUS_TONE: Record<FeatureStatusKind, StatusTone> = {
  talking: 'neutral',
  working: 'live',
  waiting: 'warning',
  ready: 'accent',
  merged: 'success',
}

/**
 * The feature's one status line (`the-feature-lead-runs-rounds` decision 21),
 * quiet, beside the title in the page's one header row (design-mode decision
 * 12): a dot and the line — "Talking with you", "Working · Round 3",
 * "Waiting for you · stopped", "Ready for you · Test drive ▸ <scenario>". It
 * replaces the stepper and the next-step sentence on the page; the header's
 * buttons are the header's.
 *
 * Facts are text (DESIGN.md principle 2): no pill, no box.
 */
export function FeatureStatusLine({ status }: { status: FeatureStatus }) {
  return (
    <p className="m-0 flex min-w-0 items-center gap-2 text-sm text-text-tertiary" role="status">
      <StatusDot tone={STATUS_TONE[status.kind]} />
      {/* Squeezed, the reason gives way first, then the label truncates: the line never draws past its box. */}
      <span className="min-w-0 truncate text-text-secondary">{status.label}</span>
      {status.why && <span className="min-w-0 shrink-[100] truncate">· {status.why}</span>}
    </p>
  )
}

/**
 * Stop asks once (decision 23): it stops the running round — landed work
 * stays — and nothing new is dispatched until the human replies.
 */
export function StopAgentDialog({
  open,
  busy = false,
  onStop,
  onClose,
}: {
  open: boolean
  busy?: boolean
  onStop: () => void
  onClose: () => void
}) {
  return (
    <Dialog open={open} onClose={onClose} size="sm" label="Stop the agent?">
      <DialogHeader
        title="Stop the agent?"
        description="The running round stops — work that already landed stays — and nothing new starts until you reply to the agent."
      />
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          Keep going
        </Button>
        <Button
          variant="danger"
          icon={<IconStop />}
          disabled={busy}
          onClick={() => {
            onClose()
            onStop()
          }}
        >
          Stop
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
