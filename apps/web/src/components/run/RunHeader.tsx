import { useState } from 'react'
import type { RunStatus } from '@runcastle/core'
import { Button, MetaLine } from '../../ui'
import { IconArrowLeft, IconStop } from '../../icons'
import { MessageWithSettingsLink } from '../settings/MessageWithSettingsLink'
import { ConfirmDialog } from './ConfirmDialog'
import { RunPicker } from './RunPicker'
import type { RunOption } from './RunPicker'

/**
 * The run's own header, over the lanes (decision #10): the Work tier's heading,
 * with the run-level controls on its right. Status, elapsed time and how many
 * tickets landed are the Status tier's rows above it (simplify-the-pages
 * decision 9a), so the header says only what those rows do not: the parts of
 * {@link runHeadline} beyond the counts — review fixes, stopped lanes, a solo
 * per-ticket retry (decisions #12b, #14c). The one addition is a failed PAST
 * run's recorded reason, as a prose line — the latest run's is on the
 * next-step bar, which speaks only of the latest.
 *
 * The run history hangs off it (decision #15b): a quiet select opens the
 * feature's past runs, and picking one puts the header into record mode — the
 * run is named as history, with the way back to the latest beside it.
 */
/**
 * The headline's parts the Status tier's rows already say: the landed and
 * burning counts and failures (Tickets), and a pass that verified nothing
 * (Review).
 */
const STATUS_TIER_PARTS = [
  /^All \d+ tickets? landed$/,
  /^(Burned|Burning) \d+ tickets?$/,
  /^\d+ (done|failed|waived)$/,
  /^Succeeded-unverified$/,
  /^nothing verified$/,
]

export function RunHeader({
  headline,
  status,
  summary,
  burning,
  busy,
  cancelling,
  onCancelRun,
  runs = [],
  selectedRunId = null,
  latestRunId = null,
  onPickRun,
  onBackToLatest,
}: {
  headline: string
  /** The shown run's status — read only for whether a past run failed. */
  status?: RunStatus
  /**
   * The run's recorded one-liner, said in record mode — a past run that died
   * in preflight otherwise reads "Failed · 9s · 0 of 2 landed" and nothing
   * else.
   */
  summary?: string
  /** Lanes with a live agent — the blast radius Cancel run states. */
  burning: number
  busy?: boolean
  /**
   * The cancel is in flight. It resolves only once every agent of the run is
   * confirmed dead, so the button holds the wait instead of the run reading
   * cancelled while its containers are still burning.
   */
  cancelling?: boolean
  /** Set only while the run can still be cancelled. */
  onCancelRun?: () => void
  /** The feature's runs, newest first — what the history select offers. */
  runs?: readonly RunOption[]
  selectedRunId?: string | null
  latestRunId?: string | null
  onPickRun?: (runId: string) => void
  /** Set only in record mode — leaving it returns to the run in flight. */
  onBackToLatest?: () => void
}) {
  const [confirming, setConfirming] = useState(false)

  const extra = headline
    .split(' · ')
    .filter((part) => !STATUS_TIER_PARTS.some((said) => said.test(part)))
    .join(', ')
  return (
    <header className="mb-4 flex flex-col gap-1.5">
      <div className="flex min-h-7 items-center gap-2">
        <h2 className="m-0 min-w-0 flex-1 text-lg font-semibold text-text">
          {onBackToLatest ? 'Past run' : 'Run'}
        </h2>
        {onPickRun && (
          <RunPicker runs={runs} selectedId={selectedRunId} latestId={latestRunId} onPick={onPickRun} />
        )}
        {onBackToLatest && (
          <Button variant="ghost" size="sm" icon={<IconArrowLeft />} onClick={onBackToLatest}>
            Back to latest
          </Button>
        )}
        {onCancelRun && (
          <Button
            variant="danger-ghost"
            size="sm"
            icon={<IconStop />}
            loading={cancelling}
            disabled={busy}
            onClick={() => setConfirming(true)}
          >
            {cancelling ? 'Stopping…' : 'Cancel run'}
          </Button>
        )}
      </div>
      {extra && <MetaLine items={[{ text: extra }]} />}
      {/* A sentence, not a fact: its own wrapping line, so the fix it ends on
          ("…from Settings → Burns") is never the part a truncating fact clips.
          Only for a past run: the latest run's reason is the next-step bar's,
          said once there (simplify-the-pages decision 6d). */}
      {status === 'failed' && summary && onBackToLatest && (
        <p className="m-0 text-sm text-pretty text-text-secondary">
          <MessageWithSettingsLink text={summary} />
        </p>
      )}

      {onCancelRun && (
        <ConfirmDialog
          open={confirming}
          title="Cancel this run?"
          body={
            burning > 0
              ? `Stops ${burning} burning agent${burning === 1 ? '' : 's'}. Finished work is kept; the burn can resume later.`
              : 'Stops the run before its remaining tickets start. Finished work is kept; the burn can resume later.'
          }
          confirmLabel="Cancel run"
          confirmIcon={<IconStop />}
          busy={busy}
          onConfirm={onCancelRun}
          onClose={() => setConfirming(false)}
        />
      )}
    </header>
  )
}
