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
 * The feature's one status line (`the-feature-lead-runs-rounds` decision 21),
 * quiet, beside the title in the page's one header row (design-mode decision
 * 12): a dot and the line — "Planning with you", "Working · Round 3",
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
      <span className="shrink-0 text-text-secondary">{status.label}</span>
      {status.why && <span className="min-w-0 truncate">· {status.why}</span>}
    </p>
  )
}

/**
 * What the agent asked to be tested, one click from Ready — closed, at the top
 * of the chat column, since the header row has no room for it.
 */
export function WhatToTest({ status }: { status: FeatureStatus }) {
  if (status.kind !== 'ready' || !status.whatToTest) return null
  return (
    <Disclosure size="sm" title="What to test">
      <p className="m-0 max-w-prose text-base whitespace-pre-line text-text-secondary">{status.whatToTest}</p>
    </Disclosure>
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
