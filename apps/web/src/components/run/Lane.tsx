import { useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type { AgentRuntime, ModelEntry, TicketKind, TicketStatus } from '@runcastle/core'
import { laneState, verdictStrip } from '../../lib/feature-ui/run'
import type { LaneState } from '../../lib/feature-ui/run'
import type { TicketModelChip } from '../../lib/feature-ui'
import { shortSha } from '../../lib/format'
import { Button, StatusLabel, TicketKindChip, Tooltip, cx } from '../../ui'
import type { StatusTone } from '../../ui'
import {
  IconAlert,
  IconCheck,
  IconChevronRight,
  IconClaude,
  IconCodex,
  IconRefresh,
  IconStop,
  IconTerminal,
  IconUndo,
  IconX,
} from '../../icons'
import { ModelMenu } from '../bodies/tickets/ModelMenu'
import { MessageWithSettingsLink } from '../settings/MessageWithSettingsLink'
import { ConfirmDialog } from './ConfirmDialog'
import { DANGER_GHOST } from './actions'

/** A ticket as its lane reads it. Every stored `Ticket` satisfies this. */
export interface LaneRow {
  id: string
  seq: number
  title: string
  kind: TicketKind
  passKind?: 'review' | 'verification'
  status: TicketStatus
  /** The model this ticket is assigned to, unset while it burns on the default. */
  model?: string
  error?: string
  conflictFiles?: string[]
  commits: readonly string[]
}

/**
 * The statuses a model reassignment is offered on — the server's own editable
 * set (`assertMutable`), so the lane offers exactly what `ticket.edit` accepts.
 * A stopped lane is a failed row and is covered; a burning lane is committed to
 * the model it launched with, and done/waived are history.
 */
const REASSIGNABLE: readonly TicketStatus[] = ['pending', 'failed']

/**
 * How each lane state is said: a dot or glyph and a sentence-case word
 * (DESIGN.md: facts are text, not boxes). `burning` is the live dot — it
 * breathes; `stopped` is amber, never the red of a failure; `waived` is muted.
 */
const LANE_STATUS: Record<LaneState, { tone: StatusTone; word: string; icon?: ReactNode; muted?: boolean }> = {
  pending: { tone: 'neutral', word: 'Pending' },
  burning: { tone: 'live', word: 'Burning' },
  done: { tone: 'success', word: 'Done', icon: <IconCheck /> },
  failed: { tone: 'danger', word: 'Failed' },
  'launch-failed': { tone: 'danger', word: 'Launch failed' },
  stopped: { tone: 'warning', word: 'Stopped' },
  waived: { tone: 'neutral', word: 'Set aside', muted: true },
}

const RUNTIME_ICON: Record<AgentRuntime, typeof IconClaude> = {
  'claude-code': IconClaude,
  codex: IconCodex,
}

/** The quiet trailing facts of a lane row: 12px tertiary, tabular. */
const TRAILING = 'shrink-0 text-xs text-text-tertiary tabular-nums'

/**
 * One ticket lane — the spine of the run view (decision #10).
 *
 * Everything it shows arrives as a prop: the tRPC reads and the mutations live
 * in `RunBody`, so this file is the whole of what a lane LOOKS like in each
 * state and can be tested as the markup it emits.
 *
 * A lane is one ruled row: chevron, `#seq`, title, then the trailing facts in
 * `text-tertiary` (commit, model, time) and the status word in a fixed column so
 * the words line up down the run. What needs the human — a failure's one-line
 * reason and its ghost actions — sits under the title, indented to it. Opening
 * the lane reveals its verdict, digest and transcript beneath, rising into
 * place.
 *
 * The states are the point. `stopped` is a deliberate human stop or a lane
 * orphaned by a dead run and reads amber, never the red failure; `waived` is
 * work explicitly set aside and reads muted, carried into review as unfinished
 * rather than hidden; `launch-failed` is a sandbox that never started, which is
 * a different problem from an agent that failed and says so (decisions #12b,
 * #11a, #16c).
 */
export function Lane({
  ticket,
  featureBranch,
  readonly,
  expanded,
  onToggle,
  index,
  hadOutput,
  elapsed,
  duration,
  model,
  roster,
  defectTitle,
  busy,
  stopping,
  waiving,
  terminalBlocked,
  onModel,
  onRetry,
  onRetryWithModel,
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
  /**
   * Position in the run's first render: the first eight lanes rise in with a
   * 20ms stagger. A lane that mounts later (a fix wave admitted mid-run) rises
   * in on its own; one that re-renders on a poll never re-animates.
   */
  index?: number
  /** Whether the agent ever spoke — what separates a launch death from a failure. */
  hadOutput?: boolean
  /** Ticking while the lane burns. */
  elapsed?: string
  /** How long the lane took, once it is done. */
  duration?: string
  model?: TicketModelChip | null
  /** The configured models a reassignment picks from; absent withholds the menu. */
  roster?: readonly ModelEntry[]
  /** The defect this lane exists to fix, when it is one of a review-fix wave. */
  defectTitle?: string
  busy?: boolean
  /**
   * This lane's stop is in flight. It resolves only once the agent's process is
   * confirmed dead, so the wait is the honest state to show: the button says
   * what is happening rather than reading "stopped" over a process still alive.
   */
  stopping?: boolean
  /**
   * This lane's waive is in flight. A ticket can read terminal while its agent
   * carries on, so a waive kills first and only then sets the ticket aside — the
   * wait is that kill, and the button says so instead of settling instantly.
   */
  waiving?: boolean
  terminalBlocked?: boolean
  /** Reassign this ticket's model — `''` clears it back to the project default. */
  onModel?: (model: string) => void
  onRetry?: () => void
  /**
   * Retry on a model chosen in the same gesture. Absent while a run is live,
   * where `ticket.retry` is refused (ADR-0006) and the menu alone is the control.
   */
  onRetryWithModel?: (model: string) => void
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
  // The mid-run control: a queued lane is launched from the live row, so a model
  // chosen here takes effect in this same run.
  const reassign = !readonly && roster && onModel && REASSIGNABLE.includes(ticket.status)
    ? { roster, onChange: onModel }
    : null
  const Runtime = model ? RUNTIME_ICON[model.runtime] : null
  const sha = state === 'done' ? ticket.commits[0] : undefined
  const status = LANE_STATUS[state]
  const time = state === 'burning' ? elapsed : duration
  const staggered = index !== undefined && index < 8
  const actions = !readonly && (retryable || state === 'burning' || reassign)
  const panelId = `lane-${ticket.id}-detail`
  // Open, the verdict below says the failure in full — not twice.
  const reason = errorHeadline && !conflict && !(expanded && verdict)

  return (
    <div
      id={`lane-${ticket.id}`}
      data-lane-state={state}
      style={staggered ? ({ '--i': index } as CSSProperties) : undefined}
      className={cx(
        'border-b border-border-subtle animate-rise-in',
        staggered && '[animation-delay:calc(var(--i)*20ms)]',
      )}
    >
      <div
        className={cx(
          'group/lane flex min-h-10 items-center gap-3 rounded-md pr-2',
          'transition-colors duration-(--dur-1) ease-app hover:bg-surface-hover',
          status.muted && 'opacity-60',
        )}
      >
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={expanded ? panelId : undefined}
          onClick={onToggle}
          className="flex min-h-10 min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-md py-2 pl-2 text-left"
        >
          <IconChevronRight
            size={14}
            className={cx(
              'shrink-0 text-icon transition-transform duration-(--dur-2) ease-app',
              expanded && 'rotate-90',
            )}
          />
          <span className="w-7 shrink-0 text-xs text-text-tertiary tabular-nums">#{ticket.seq}</span>
          <span
            className={cx('min-w-0 flex-1 truncate text-sm text-text', status.muted && 'line-through')}
            title={defectTitle ? `${ticket.title} — fixes: ${defectTitle}` : ticket.title}
          >
            {ticket.title}
          </span>
          {defectTitle && (
            // Only where the row has room to spare: the lane's own title comes first.
            <span className="hidden max-w-60 min-w-0 shrink truncate text-xs text-text-tertiary @3xl:block" title={`Fixes: ${defectTitle}`}>
              fixes “{defectTitle}”
            </span>
          )}
          <span className="hidden shrink-0 @lg:inline-flex">
            <TicketKindChip kind={ticket.kind} passKind={ticket.passKind} />
          </span>
        </button>

        {sha &&
          (onCopySha ? (
            <Tooltip label="Copy commit SHA">
              <button
                type="button"
                className={cx(
                  TRAILING,
                  'hidden cursor-pointer rounded-sm px-1 font-mono transition-colors duration-(--dur-1) hover:bg-surface-selected hover:text-text @xl:inline',
                )}
                onClick={() => onCopySha(sha)}
              >
                {shortSha(sha)}
              </button>
            </Tooltip>
          ) : (
            <span className={cx(TRAILING, 'hidden font-mono @xl:inline')} title={sha}>
              {shortSha(sha)}
            </span>
          ))}
        {model && Runtime && (
          <span
            className={cx(TRAILING, 'hidden max-w-40 items-center gap-1.5 font-mono @2xl:inline-flex')}
            title={`Burns on ${model.id} (${model.runtimeLabel})`}
          >
            <Runtime size={12} className="shrink-0 text-icon" />
            <span className="truncate">{model.id}</span>
          </span>
        )}
        {time && <span className={cx(TRAILING, 'hidden w-14 text-right @md:block')}>{time}</span>}
        {/* Keyed on the state, so a lane that changes status cross-fades its
            word — and one that merely re-renders on a poll does not. */}
        <span key={state} className="flex shrink-0 animate-fade-in @md:w-28">
          <StatusLabel tone={status.tone} icon={status.icon} className={status.muted ? 'text-text-tertiary' : undefined}>
            {status.word}
          </StatusLabel>
        </span>
      </div>

      {(reason || conflict || actions) && (
        <div className="flex flex-col gap-2 pr-2 pb-3 pl-17.5">
          {reason && (
            <div
              className={cx('min-w-0 truncate text-xs', bad ? 'text-danger' : 'text-text-tertiary')}
              title={ticket.error}
            >
              <MessageWithSettingsLink text={errorHeadline} />
            </div>
          )}

          {conflict && (
            <div className="flex flex-col gap-1">
              <p className="m-0 flex items-start gap-1.5 text-sm text-text-secondary">
                <IconAlert size={14} className="mt-[3px] shrink-0 text-danger" />
                <span className="min-w-0">
                  Merge conflict — the work is committed but could not land on{' '}
                  <code className="font-mono text-xs text-text">{featureBranch}</code>
                </span>
              </p>
              {conflict.length > 0 && (
                <ul className="m-0 flex list-none flex-col gap-0.5 p-0 pl-5">
                  {conflict.map((f) => (
                    <li key={f} className="truncate font-mono text-xs text-text-secondary" title={f}>
                      {f}
                    </li>
                  ))}
                </ul>
              )}
              {errorHeadline && (
                <div className="truncate pl-5 text-xs text-text-tertiary" title={ticket.error}>
                  <MessageWithSettingsLink text={errorHeadline} />
                </div>
              )}
            </div>
          )}

          {actions && (
            <div className="-ml-2 flex flex-wrap items-center gap-1">
              {retryable && onRetry && (
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<IconRefresh />}
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
              {/* One gesture, two existing calls: the reassignment lands and the
                  burn it starts resolves the fresh row (decision 4). */}
              {retryable && roster && onRetryWithModel && (
                <ModelMenu
                  value=""
                  roster={roster}
                  label="Retry on…"
                  ticketKind={ticket.kind}
                  onChange={onRetryWithModel}
                />
              )}
              {conflict && onResolveInTerminal && (
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<IconTerminal />}
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
                  variant="ghost"
                  size="sm"
                  icon={<IconUndo />}
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
                  variant="ghost"
                  size="sm"
                  icon={<IconX />}
                  loading={waiving}
                  disabled={busy}
                  title="set this ticket aside — it stops asking to be retried and is carried into review as explicitly unfinished work"
                  onClick={onWaive}
                >
                  {waiving ? 'Waiving…' : 'Waive'}
                </Button>
              )}
              {/* One click, deliberately (decision #12c): this is the control reached
                  for at the moment an agent is visibly going wrong. */}
              {state === 'burning' && onStop && (
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<IconStop />}
                  loading={stopping}
                  disabled={busy}
                  className={DANGER_GHOST}
                  title="stop this ticket's agent — other lanes keep burning; committed work is preserved for retry"
                  onClick={onStop}
                >
                  {stopping ? 'Stopping…' : 'Stop ticket'}
                </Button>
              )}
              {reassign && (
                <ModelMenu
                  value={ticket.model ?? ''}
                  roster={reassign.roster}
                  ticketKind={ticket.kind}
                  onChange={reassign.onChange}
                />
              )}
            </div>
          )}
        </div>
      )}

      {expanded && (
        <div
          id={panelId}
          className={cx(
            'flex flex-col gap-3 overflow-hidden pr-2 pb-4 pl-17.5',
            // Height and opacity grow from nothing as the detail mounts (the
            // root's `interpolate-size` lets `auto` be a transition target).
            'h-auto transition-[height,opacity] duration-(--dur-2) ease-out-app starting:h-0 starting:opacity-0',
          )}
        >
          {verdict && (
            <div className="flex flex-col gap-1">
              <p className="m-0 flex items-start gap-1.5 text-sm text-text">
                <IconAlert size={14} className="mt-[3px] shrink-0 text-danger" />
                <span className="min-w-0 break-words">{verdict.text}</span>
              </p>
              {verdict.hint && <p className="m-0 pl-5 text-sm text-text-secondary">{verdict.hint}</p>}
              {ticket.error && (
                <details data-disclosure="" className="group/raw pl-5">
                  <summary className="flex h-7 cursor-pointer list-none items-center gap-1.5 text-xs text-text-tertiary transition-colors duration-(--dur-1) select-none hover:text-text [&::-webkit-details-marker]:hidden">
                    <IconChevronRight
                      size={12}
                      className="shrink-0 transition-transform duration-(--dur-2) ease-app group-open/raw:rotate-90"
                    />
                    What the engine reported
                  </summary>
                  <pre className="m-0 mt-1 overflow-x-auto rounded-md bg-surface-inset px-3 py-2 font-mono text-xs whitespace-pre-wrap text-text-secondary">
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
          confirmIcon={<IconUndo />}
          busy={busy}
          onConfirm={onRetryFresh}
          onClose={() => setConfirmingFresh(false)}
        />
      )}
    </div>
  )
}
