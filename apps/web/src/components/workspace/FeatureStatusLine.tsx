import { Button, Dialog, DialogFooter, DialogHeader, StatusDot } from '../../ui'
import type { StatusTone } from '../../ui'
import { IconStop } from '../../icons'
import type { FeatureStatus, FeatureStatusKind } from '../../lib/feature-ui/status-line'

/** Shape first, hue confirms (DESIGN.md principle 3) — one tone per status. */
const STATUS_TONE: Record<FeatureStatusKind, StatusTone> = {
  needsYou: 'warning',
  working: 'live',
  idle: 'neutral',
  merged: 'success',
  shelf: 'neutral',
}

/**
 * The feature's one status line, quiet, beside the title in the page's one
 * header row: a dot and "Needs you · <the agent's line>", "Working", "Idle"
 * or "Merged" (needs-you-is-the-agent-s-call decision 15). The line is one
 * line, clipped (decision 3); clicking Needs you opens the chat the question
 * waits in (decision 12).
 *
 * Facts are text (DESIGN.md principle 2): no pill, no box.
 */
export function FeatureStatusLine({
  status,
  onOpenThread,
}: {
  status: FeatureStatus
  onOpenThread?: (threadId: string) => void
}) {
  const threadId = status.threadId
  const words = (
    <>
      <StatusDot tone={STATUS_TONE[status.kind]} />
      {/* Squeezed, the reason gives way first, then the label truncates: the line never draws past its box. */}
      <span className="min-w-0 truncate text-text-secondary">{status.label}</span>
      {status.why && <span className="min-w-0 shrink-[100] truncate">· {status.why}</span>}
    </>
  )
  return (
    <p className="m-0 flex min-w-0 items-center text-sm text-text-tertiary" role="status">
      {threadId && onOpenThread ? (
        <button
          type="button"
          className="flex min-w-0 cursor-pointer items-center gap-2 rounded-md hover:text-text-secondary"
          title={status.why ? `Open the chat: ${status.why}` : 'Open the chat'}
          onClick={() => onOpenThread(threadId)}
        >
          {words}
        </button>
      ) : (
        <span className="flex min-w-0 items-center gap-2" {...(status.why ? { title: status.why } : {})}>
          {words}
        </span>
      )}
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
