import { useState } from 'react'
import type { Autonomy } from '@runcastle/core'
import { Button, Dialog, DialogFooter, DialogHeader, Disclosure, SegmentedControl, StatusDot } from '../../ui'
import type { StatusTone } from '../../ui'
import { IconStop } from '../../icons'
import { AUTONOMY_LABEL } from '../../lib/vocabulary'
import { tokensText, type FeatureStatus, type FeatureStatusKind } from '../../lib/feature-ui/status-line'

/** Shape first, hue confirms (DESIGN.md principle 3) — one tone per status. */
const STATUS_TONE: Record<FeatureStatusKind, StatusTone> = {
  planning: 'neutral',
  working: 'live',
  waiting: 'warning',
  ready: 'accent',
  merged: 'success',
}

const AUTONOMY_ITEMS = (['run-until-ready', 'ask'] as const).map((value) => ({
  value,
  label: AUTONOMY_LABEL[value],
}))

/**
 * The feature's one status line (`the-feature-lead-runs-rounds` decision 21),
 * in the next-step row's left column: a dot and the line — "Working · Round 3",
 * "Waiting for you · round 4 proposed", "Ready for you · Test drive ▸ <scenario>"
 * with what to test one click away — then, beside it, the token total, the
 * autonomy switch and, only while the agent works, Stop.
 *
 * Facts are text (DESIGN.md principle 2): no pill, no box. The switch is the
 * feature's override ?? the project default; Stop asks once, because it also
 * flips the feature to "Ask before each round" (decision 15).
 */
export function FeatureStatusLine({
  status,
  autonomy,
  tokens,
  busy = false,
  onAutonomy,
  onStop,
}: {
  status: FeatureStatus
  /** The resolved autonomy: feature override ?? project default. */
  autonomy: Autonomy
  /** The feature's token total; omitted while nothing has been counted. */
  tokens?: number | null
  busy?: boolean
  onAutonomy: (autonomy: Autonomy) => void
  onStop: () => void
}) {
  const [confirmStop, setConfirmStop] = useState(false)
  const merged = status.kind === 'merged'

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
        <p className="m-0 flex min-w-0 items-center gap-2 text-sm" role="status">
          <StatusDot tone={STATUS_TONE[status.kind]} />
          <span className="font-medium text-text">{status.label}</span>
          {status.why && <span className="min-w-0 truncate text-text-secondary">· {status.why}</span>}
        </p>
        {typeof tokens === 'number' && (
          <span className="text-xs text-text-tertiary tabular-nums">{tokensText(tokens)}</span>
        )}
        {!merged && (
          <SegmentedControl
            size="sm"
            label="Autonomy"
            items={AUTONOMY_ITEMS}
            value={autonomy}
            onChange={(next) => {
              if (next !== autonomy) onAutonomy(next)
            }}
          />
        )}
        {status.kind === 'working' && (
          <Button
            size="sm"
            variant="danger-ghost"
            icon={<IconStop />}
            disabled={busy}
            onClick={() => setConfirmStop(true)}
          >
            Stop
          </Button>
        )}
      </div>

      {status.kind === 'ready' && status.whatToTest && (
        <Disclosure size="sm" title="What to test">
          <p className="m-0 max-w-prose text-base whitespace-pre-line text-text-secondary">{status.whatToTest}</p>
        </Disclosure>
      )}

      <Dialog open={confirmStop} onClose={() => setConfirmStop(false)} size="sm" label="Stop the agent?">
        <DialogHeader
          title="Stop the agent?"
          description="The running round stops — work that already landed stays — and this feature switches to Ask before each round, so nothing new starts until you reply."
        />
        <DialogFooter>
          <Button variant="ghost" onClick={() => setConfirmStop(false)}>
            Keep going
          </Button>
          <Button
            variant="danger"
            icon={<IconStop />}
            disabled={busy}
            onClick={() => {
              setConfirmStop(false)
              onStop()
            }}
          >
            Stop
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  )
}
