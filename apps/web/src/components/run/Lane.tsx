import { useState } from 'react'
import type { ReactNode } from 'react'
import type { AgentRuntime, TicketKind, TicketStatus } from '@runcastle/core'
import { laneState, verdictStrip } from '../../lib/feature-ui/run'
import type { LaneState } from '../../lib/feature-ui/run'
import type { TicketModelChip } from '../../lib/feature-ui'
import { shortSha } from '../../lib/format'
import { Button, TicketKindChip } from '../../ui'
import { IconChevronRight, IconClaude, IconCodex } from '../../icons'
import { MessageWithSettingsLink } from '../settings/MessageWithSettingsLink'
import { ConfirmDialog } from './ConfirmDialog'

/** A ticket as its lane reads it. Every stored `Ticket` satisfies this. */
export interface LaneRow {
  id: string
  seq: number
  title: string
  kind: TicketKind
  passKind?: 'review' | 'verification'
  status: TicketStatus
  error?: string
  conflictFiles?: string[]
  commits: readonly string[]
}

/**
 * One ticket lane — the spine of the run view (decision #10).
 *
 * Everything it shows arrives as a prop: the tRPC reads and the mutations live
 * in `RunBody`, so this file is the whole of what a lane LOOKS like in each
 * state and can be tested as the markup it emits.
 *
 * The states are the point. `stopped` is a deliberate human stop or a lane
 * orphaned by a dead run and reads amber, never the red failure chip; `waived`
 * is work explicitly set aside and reads muted, carried into review as
 * unfinished rather than hidden; `launch-failed` is a sandbox that never
 * started, which is a different problem from an agent that failed and says so
 * (decisions #12b, #11a, #16c).
 */
const LANE_EDGE: Record<LaneState, string> = {
  pending: 'border-l-hairline-strong',
  burning: 'border-l-ph-implementation',
  done: 'border-l-ok',
  failed: 'border-l-danger',
  'launch-failed': 'border-l-danger',
  stopped: 'border-l-warn',
  waived: 'border-l-hairline',
}

const CHIP = 'inline-flex h-5 shrink-0 items-center gap-1.5 rounded-pill border px-2 font-mono text-xs'

const LANE_CHIP: Record<LaneState, string> = {
  pending: 'border-hairline text-text-3',
  burning:
    'border-ph-implementation/45 bg-ph-implementation/8 text-ph-implementation animate-[pulse_1.5s_ease-in-out_infinite]',
  done: 'border-ok/40 text-ok',
  failed: 'border-danger/45 text-danger',
  'launch-failed': 'border-danger/45 text-danger',
  stopped: 'border-warn/45 text-warn',
  waived: 'border-hairline text-text-4 line-through',
}

const LANE_LABEL: Record<LaneState, string> = {
  pending: 'pending',
  burning: 'burning',
  done: 'done',
  failed: 'failed',
  'launch-failed': 'launch failed',
  stopped: 'stopped',
  waived: 'set aside',
}

/** A lane settles into its terminal state rather than snapping to it. */
const SETTLE = 'animate-[fadeUp_220ms_ease-out]'

const RUNTIME_ICON: Record<AgentRuntime, typeof IconClaude> = {
  'claude-code': IconClaude,
  codex: IconCodex,
}

export function Lane({
  ticket,
  featureBranch,
  readonly,
  expanded,
  onToggle,
  hadOutput,
  elapsed,
  duration,
  model,
  defectTitle,
  busy,
  terminalBlocked,
  onRetry,
  onRetryFresh,
  onWaive,
  onStop,
  onResolveInTerminal,
  onCopySha,
  children,
}: {
  ticket: LaneRow
  featureBranch: string
  readonly: boolean
  expanded: boolean
  onToggle: () => void
  /** Whether the agent ever spoke — what separates a launch death from a failure. */
  hadOutput?: boolean
  /** Ticking while the lane burns. */
  elapsed?: string
  /** How long the lane took, once it is done. */
  duration?: string
  model?: TicketModelChip | null
  /** The defect this lane exists to fix, when it is one of a review-fix wave. */
  defectTitle?: string
  busy?: boolean
  terminalBlocked?: boolean
  onRetry?: () => void
  onRetryFresh?: () => void
  onWaive?: () => void
  onStop?: () => void
  onResolveInTerminal?: () => void
  onCopySha?: (sha: string) => void
  children?: ReactNode
}) {
  const [confirmingFresh, setConfirmingFresh] = useState(false)
  const state = laneState({ ...ticket, hadOutput })
  const verdict = verdictStrip({ ...ticket, hadOutput })
  // A landing conflict is not a normal failure: the ticket IS implemented and
  // its commits are safe on the attempt branch, so "Retry" means "resolve the
  // conflict", not "write it again".
  const conflict = ticket.status === 'failed' ? ticket.conflictFiles : undefined
  const errorHeadline = ticket.error?.split('\n')[0]
  const bad = state === 'failed' || state === 'launch-failed'
  const retryable = bad || state === 'stopped'
  const Runtime = model ? RUNTIME_ICON[model.runtime] : null
  const sha = state === 'done' ? ticket.commits[0] : undefined

  return (
    <div
      id={`lane-${ticket.id}`}
      className={`rounded-md border border-hairline border-l-2 bg-panel-2 transition-[border-color,background-color] duration-(--dur-2) ease-app ${LANE_EDGE[state]} ${state === 'waived' ? 'opacity-60' : ''} ${state === 'done' || bad ? SETTLE : ''}`}
    >
      <button
        className="flex w-full items-center gap-2 border-0 bg-transparent px-3 py-2.5 text-left"
        aria-expanded={expanded}
        onClick={onToggle}
      >
        <span
          className={`shrink-0 text-text-4 transition-transform duration-(--dur-1) ease-app ${expanded ? 'rotate-90' : ''}`}
        >
          <IconChevronRight size={11} />
        </span>
        <span className="shrink-0 font-mono text-sm text-text-3">#{ticket.seq}</span>
        <span className="min-w-0 flex-1 truncate text-base text-text">{ticket.title}</span>
        {defectTitle && (
          <span
            className={`${CHIP} max-w-60 border-ph-review/40 text-ph-review`}
            title={`Fixes: ${defectTitle}`}
          >
            <span className="truncate">{defectTitle}</span>
          </span>
        )}
        <TicketKindChip kind={ticket.kind} passKind={ticket.passKind} />
        {model && Runtime && (
          <span
            className={`${CHIP} border-hairline text-text-2`}
            title={`Burns on ${model.id} (${model.runtimeLabel})`}
          >
            <Runtime size={11} />
            {model.id} · {model.runtimeLabel}
          </span>
        )}
        {elapsed && state === 'burning' && (
          <span className="shrink-0 font-mono text-xs text-text-3">{elapsed}</span>
        )}
        {duration && state !== 'burning' && (
          <span className="shrink-0 font-mono text-xs text-text-3">{duration}</span>
        )}
        <span className={`${CHIP} ${LANE_CHIP[state]}`}>{LANE_LABEL[state]}</span>
      </button>

      {sha && (
        <div className="px-3 pb-2.5">
          {onCopySha ? (
            <button
              className={`${CHIP} cursor-pointer border-hairline text-text-2`}
              title="copy sha"
              onClick={() => onCopySha(sha)}
            >
              {shortSha(sha)}
            </button>
          ) : (
            <span className={`${CHIP} border-hairline text-text-2`} title={sha}>
              {shortSha(sha)}
            </span>
          )}
        </div>
      )}

      {errorHeadline && !conflict && (
        <div
          className={`px-3 pb-2.5 font-mono text-xs ${bad ? 'text-danger' : 'text-text-3'}`}
          title={ticket.error}
        >
          <MessageWithSettingsLink text={errorHeadline} />
        </div>
      )}

      {conflict && (
        <div className="mx-3 mb-2.5 rounded-sm border border-danger/35 bg-danger/6 px-2.5 py-2">
          <div className="text-sm leading-relaxed text-text-2">
            Merge conflict — the work is committed but could not land on{' '}
            <code className="font-mono text-xs text-text">{featureBranch}</code>
          </div>
          {conflict.length > 0 && (
            <ul className="m-0 mt-1.5 flex list-none flex-col gap-0.5 p-0">
              {conflict.map((f) => (
                <li key={f} className="truncate text-left font-mono text-xs text-danger" title={f}>
                  {f}
                </li>
              ))}
            </ul>
          )}
          {errorHeadline && (
            <div className="mt-1.5 font-mono text-xs text-danger" title={ticket.error}>
              <MessageWithSettingsLink text={errorHeadline} />
            </div>
          )}
        </div>
      )}

      {!readonly && (retryable || state === 'burning') && (
        <div className="flex flex-wrap gap-2 px-3 pb-3">
          {retryable && onRetry && (
            <Button
              disabled={busy}
              title={
                conflict
                  ? 'run an agent that merges the feature branch into this ticket’s branch and resolves the conflict — it gets the ticket, the feature docs, and the commits it is reconciling against'
                  : 'retry this ticket — continues from any commits preserved by previous attempts'
              }
              onClick={onRetry}
            >
              {conflict ? 'Resolve with agent' : 'Retry'}
            </Button>
          )}
          {conflict && onResolveInTerminal && (
            <Button
              disabled={busy || terminalBlocked}
              title={
                terminalBlocked
                  ? 'available once this run finishes and no terminal is open'
                  : 'open a terminal on the feature branch, briefed with this ticket and its conflicting files, and resolve it yourself'
              }
              onClick={onResolveInTerminal}
            >
              Resolve in terminal
            </Button>
          )}
          {retryable && onRetryFresh && (
            <Button
              disabled={busy}
              title={
                conflict
                  ? 'throw away the conflicting branch and re-implement the ticket from the current feature branch tip'
                  : 'discard any preserved commits from previous attempts and redo the ticket from the feature branch tip'
              }
              onClick={() => setConfirmingFresh(true)}
            >
              Retry fresh
            </Button>
          )}
          {retryable && onWaive && (
            <Button
              disabled={busy}
              title="set this ticket aside — it stops asking to be retried and is carried into review as explicitly unfinished work"
              onClick={onWaive}
            >
              Waive
            </Button>
          )}
          {/* One click, deliberately (decision #12c): this is the control reached
              for at the moment an agent is visibly going wrong. */}
          {state === 'burning' && onStop && (
            <Button
              variant="danger"
              disabled={busy}
              title="stop this ticket's agent — other lanes keep burning; committed work is preserved for retry"
              onClick={onStop}
            >
              Stop ticket
            </Button>
          )}
        </div>
      )}

      {expanded && (
        <div className="border-t border-hairline-soft">
          {verdict && (
            <div className="flex flex-col gap-1.5 border-b border-hairline-soft bg-danger/6 px-3 py-2.5">
              <span className="text-sm text-text">{verdict.text}</span>
              {verdict.hint && <span className="text-sm text-text-2">{verdict.hint}</span>}
              {ticket.error && (
                <details className="text-sm text-text-3">
                  <summary className="cursor-pointer">What the engine reported</summary>
                  <pre className="m-0 mt-1.5 overflow-x-auto font-mono text-xs whitespace-pre-wrap text-text-3">
                    {ticket.error}
                  </pre>
                </details>
              )}
            </div>
          )}
          {children}
        </div>
      )}

      {onRetryFresh && (
        <ConfirmDialog
          open={confirmingFresh}
          title={`Start ticket #${ticket.seq} over?`}
          body="Any commits preserved from previous attempts are discarded and the ticket is redone from the feature branch tip."
          confirmLabel="Retry fresh"
          busy={busy}
          onConfirm={onRetryFresh}
          onClose={() => setConfirmingFresh(false)}
        />
      )}
    </div>
  )
}
