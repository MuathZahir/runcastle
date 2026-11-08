import { Button, Dialog, DialogFooter, DialogHeader, StatusDot } from '../../ui'
import type { StatusTone } from '../../ui'
import { IconStop } from '../../icons'
import type { FeatureStatus, FeatureStatusKind } from '../../lib/feature-ui/status-line'
import { Term } from '../Term'

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
 * "Plan to approve", "Needs permission · Bash: git push", "Ready to test ·
 * <scenario>" (you-always-know-what-s-waiting decision 1). It
 * replaces the stepper and the next-step sentence on the page; the header's
 * buttons are the header's.
 *
 * Facts are text (DESIGN.md principle 2): no pill, no box.
 */
export function FeatureStatusLine({ status }: { status: FeatureStatus }) {
  return (
    <p className="m-0 flex min-w-0 items-center gap-2 text-sm text-text-tertiary" role="status">
      {/* A need its orchestrator handles is not the human's yet: a quiet dot. */}
      <StatusDot tone={status.held ? 'neutral' : STATUS_TONE[status.kind]} />
      {/* Squeezed, the reason gives way first, then the label truncates: the line never draws past its box. */}
      {/* Held, the label ("With the orchestrator") explains the crumb beside it, whose title only a tooltip holds. */}
      <span className="min-w-0 truncate text-text-secondary">
        {status.held ? <Term id="held-by">{status.label}</Term> : status.label}
      </span>
      {status.why && <span className="min-w-0 shrink-[100] truncate">· {status.why}</span>}
    </p>
  )
}

/**
 * Stop asks once (decision 23): it ends the lead's turn and every working
 * worker's (burns-become-workers decision 15) — they stay where they are —
 * and nothing new starts until the human replies.
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
        description="The agent and its workers stop where they are — you can still open each one — and nothing new starts until you reply to the agent."
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
