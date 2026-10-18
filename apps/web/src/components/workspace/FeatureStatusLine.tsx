import { Button, Dialog, DialogFooter, DialogHeader, Disclosure, StatusDot } from '../../ui'
import type { StatusTone } from '../../ui'
import { IconStop } from '../../icons'
import type { FeatureStatus, FeatureStatusKind } from '../../lib/feature-ui/status-line'

/** Shape first, hue confirms (DESIGN.md principle 3) — one tone per status. */
const STATUS_TONE: Record<FeatureStatusKind, StatusTone> = {
  planning: 'neutral',
  working: 'live',
  waiting: 'warning',
  ready: 'accent',
  merged: 'success',
}

/**
 * The feature's one status line (`the-feature-lead-runs-rounds` decisions 21
 * and 24), in the action row's left column: a dot and the line — "Working ·
 * Round 3", "Waiting for you · stopped", "Ready for you · Test drive ▸
 * <scenario>" with what to test one click away. The row's buttons, Stop
 * among them, are the next-step bar's.
 *
 * Facts are text (DESIGN.md principle 2): no pill, no box.
 */
export function FeatureStatusLine({ status }: { status: FeatureStatus }) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <p className="m-0 flex min-w-0 items-center gap-2 text-sm" role="status">
        <StatusDot tone={STATUS_TONE[status.kind]} />
        <span className="font-medium text-text">{status.label}</span>
        {status.why && <span className="min-w-0 truncate text-text-secondary">· {status.why}</span>}
      </p>

      {status.kind === 'ready' && status.whatToTest && (
        <Disclosure size="sm" title="What to test">
          <p className="m-0 max-w-prose text-base whitespace-pre-line text-text-secondary">{status.whatToTest}</p>
        </Disclosure>
      )}
    </div>
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
