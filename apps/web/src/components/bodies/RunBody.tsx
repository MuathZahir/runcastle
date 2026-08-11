import { useEffect, useMemo, useRef, useState } from 'react'
import type { EventRow, Ticket } from '@runcastle/core'
import { trpc } from '../../trpc'
import { useToast } from '../../lib/toast'
import { eventLevel } from '../../lib/activity'
import { useEventLog } from '../../lib/events'
import { useLivePoll } from '../../lib/live'
import { ticketConflictKickoff } from '../../lib/feature-ui'
import { fmtDuration, fmtTime, shortSha } from '../../lib/format'
import { BURN_EXPLAINER } from '../../lib/vocabulary'
import { DimLine, EmptyState, RunStatusChip, TicketStatusChip } from '../../ui'
import { IconTerminal } from '../../icons'
import { AgentTranscript } from '../AgentTranscript'
import { ErrorBoundary } from '../ErrorBoundary'
import { SessionPanel } from '../SessionPanel'

/**
 * Run / implementation phase-body for the pipeline-first workspace: a lanes|panel
 * split — ticket lanes on the left, a tabbed Agent|Events panel on the right.
 * The Agent tab is the live Claude Code-style transcript of the selected lane's
 * agent (auto-selects the first burning ticket until you click a lane); the
 * Events tab keeps the coarse run timeline. No run header/cancel here (that
 * moved to the workspace next-step bar). `readonly` is accepted but ignored.
 */
export function RunBody({
  featureId,
  runId,
  readonly = false,
}: {
  featureId: string
  runId: string | null
  readonly?: boolean
}) {
  const poll = useLivePoll()
  const feature = trpc.feature.get.useQuery({ id: featureId }, { refetchInterval: poll })
  const run = trpc.run.get.useQuery(
    { runId: runId as string },
    { refetchInterval: poll, enabled: !!runId },
  )
  const events = useEventLog(featureId)

  const tickets = feature.data?.tickets ?? []
  const runEvents = useMemo(() => events.filter((e) => e.runId === runId), [events, runId])
  const durations = useMemo(() => ticketDurations(runEvents), [runEvents])

  // Lane selection for the Agent tab. `pinned` is an explicit lane click and
  // sticks; before any click the view follows the burn — first burning ticket,
  // else the most recently terminal one (so a finished burn still shows its
  // last transcript instead of a blank pane).
  const [pinned, setPinned] = useState<string | null>(null)
  const [tab, setTab] = useState<'agent' | 'events'>('agent')
  const autoTicket =
    tickets.find((t) => t.status === 'burning') ??
    [...tickets].reverse().find((t) => t.status === 'done' || t.status === 'failed')
  const selectedId = pinned ?? autoTicket?.id ?? null
  const selected = tickets.find((t) => t.id === selectedId) ?? null

  const done = tickets.filter((t) => t.status === 'done').length
  const total = tickets.length
  const elapsed = run.data
    ? fmtDuration(run.data.startedAt, run.data.endedAt ?? Date.now())
    : ''

  // Same pattern as TicketsBody: a HITL session (a revisit opened between runs)
  // renders as the session panel — without this the session is invisible at the
  // build phase. The empty state keys off a LIVE one only: with nothing running
  // and nothing live there is no run to narrate, and the way back into an old
  // conversation from here is the bar's Revisit (which resumes it), not an
  // ideation terminal reopened three phases late.
  const sessions = feature.data?.sessions ?? []
  const live = sessions.some((s) => s.status === 'live' || s.status === 'launching')
  // A conflict lane's "Resolve in terminal" spawns an HITL session, which the
  // launcher refuses while a run holds the feature branch or another terminal
  // is open — so the lane greys the button rather than offering a certain error.
  const terminalBlocked = live || run.data?.status === 'running'

  if (!runId && !live) {
    return (
      <div className="surface">
        <EmptyState
          icon={<IconTerminal size={16} />}
          title="No run yet"
          hint={`${BURN_EXPLAINER} Every ticket gets its own lane here.`}
        />
      </div>
    )
  }

  return (
    <div>
      {/* A read-only retrospective view is history: it must not offer to reopen
          a conversation from a phase the feature has already left (F10.6). */}
      <SessionPanel
        featureId={featureId}
        sessions={sessions}
        className="tickets-session"
        showResume={!readonly}
      />

      <div className="body-title">
        <span className="section-title">Run</span>
        {run.data && <RunStatusChip status={run.data.status} />}
        <span className="body-meta">
          {done}/{total} done · {elapsed}
        </span>
      </div>

      <div className="run-split">
        <div className="run-lanes-panel">
          <div className="panel-cap">Ticket lanes</div>
          <div className="run-lanes">
            {tickets.length === 0 && <DimLine>no ticket lanes</DimLine>}
            {tickets.map((t) => (
              <Lane
                key={t.id}
                ticket={t}
                featureBranch={feature.data?.feature.branch ?? ''}
                duration={durations.get(t.id)}
                selected={t.id === selectedId}
                readonly={readonly}
                terminalBlocked={terminalBlocked}
                onSelect={() => {
                  setPinned(t.id)
                  setTab('agent')
                }}
              />
            ))}
          </div>
        </div>

        <div className="run-stream-panel">
          <div className="stream-head">
            <div className="panel-tabs">
              <button
                className={`panel-tab${tab === 'agent' ? ' is-active' : ''}`}
                onClick={() => setTab('agent')}
              >
                Agent
                {selected && <span className="panel-tab-ctx">#{selected.seq}</span>}
              </button>
              <button
                className={`panel-tab${tab === 'events' ? ' is-active' : ''}`}
                onClick={() => setTab('events')}
              >
                Events
              </button>
            </div>
            {tab === 'agent' && selected?.status === 'burning' && (
              <span className="agent-live-dot" title="agent running" />
            )}
          </div>
          {tab === 'agent' ? (
            selected ? (
              <ErrorBoundary label="agent transcript">
                <AgentTranscript key={selected.id} ticketId={selected.id} />
              </ErrorBoundary>
            ) : (
              <div className="agent-body">
                <DimLine>No agent yet — lanes light up here as tickets start burning.</DimLine>
              </div>
            )
          ) : (
            <EventStream events={runEvents} />
          )}
        </div>
      </div>
    </div>
  )
}

function Lane({
  ticket,
  featureBranch,
  duration,
  selected,
  readonly,
  terminalBlocked,
  onSelect,
}: {
  ticket: Ticket
  featureBranch: string
  duration?: number
  selected: boolean
  readonly: boolean
  terminalBlocked: boolean
  onSelect: () => void
}) {
  const toast = useToast()
  const utils = trpc.useUtils()
  const onMutated = {
    onSuccess: () => utils.feature.get.invalidate({ id: ticket.featureId }),
    onError: (e: { message: string }) => toast.push(e.message),
  }
  const retry = trpc.ticket.retry.useMutation(onMutated)
  const stop = trpc.ticket.stop.useMutation(onMutated)
  const launch = trpc.feature.launchSession.useMutation(onMutated)
  const copy = (sha: string) => {
    navigator.clipboard?.writeText(sha).then(
      () => toast.push(`copied ${shortSha(sha)}`, 'info'),
      () => toast.push('copy failed'),
    )
  }
  const mod = ['burning', 'done', 'failed'].includes(ticket.status)
    ? ` status-${ticket.status}`
    : ''
  const hasCommits = ticket.commits.length > 0
  const hasDuration = duration !== undefined
  // First line of the failure, so the user never has to dig through the event
  // stream to learn WHY a lane went red.
  const errorHeadline = ticket.status === 'failed' ? ticket.error?.split('\n')[0] : undefined
  const busy = retry.isPending || stop.isPending || launch.isPending
  // A landing conflict is not a normal failure: the ticket IS implemented, its
  // commits are safe on `attemptBranch`, and the only outstanding work is the
  // merge. It gets its own card (with the conflicting files) and its own verbs,
  // because "Retry" here means "resolve the conflict", not "write it again".
  const conflict = ticket.status === 'failed' ? ticket.conflictFiles : undefined
  return (
    <div
      className={`lane is-clickable${mod}${selected ? ' is-selected' : ''}`}
      role="button"
      tabIndex={0}
      title="show this ticket's agent"
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onSelect()
      }}
    >
      <div className="lane-head">
        <span className="lane-seq">#{ticket.seq}</span>
        <span className="lane-title">{ticket.title}</span>
        <TicketStatusChip status={ticket.status} />
      </div>
      {errorHeadline && !conflict && (
        <div className="lane-error" title={ticket.error}>
          {errorHeadline}
        </div>
      )}
      {conflict && (
        <div className="lane-conflict">
          <div className="lane-conflict-head">
            Merge conflict — the work is committed but could not land on{' '}
            <code>{featureBranch}</code>
          </div>
          {conflict.length > 0 && (
            <ul className="lane-conflict-files">
              {conflict.map((f) => (
                <li key={f} title={f}>
                  {f}
                </li>
              ))}
            </ul>
          )}
          {ticket.error && (
            <div className="lane-error" title={ticket.error}>
              {errorHeadline}
            </div>
          )}
        </div>
      )}
      {!readonly && ticket.status === 'failed' && (
        <div className="lane-actions">
          <button
            className="lane-btn"
            disabled={busy}
            title={
              conflict
                ? 'run an agent that merges the feature branch into this ticket’s branch and resolves the conflict — it gets the ticket, the feature docs, and the commits it is reconciling against'
                : 'retry this ticket — continues from any commits preserved by previous attempts'
            }
            onClick={(e) => {
              e.stopPropagation()
              retry.mutate(
                { ticketId: ticket.id },
                {
                  onSuccess: (r) => {
                    if (r.resolvingConflict) {
                      toast.push(`resolving ticket #${ticket.seq}'s conflict with an agent`, 'info')
                    } else if (r.resumedFrom) {
                      toast.push(
                        `resuming ticket #${ticket.seq} from ${r.preservedCommits} preserved commit(s)`,
                        'info',
                      )
                    }
                  },
                },
              )
            }}
          >
            {conflict ? 'Resolve with agent' : 'Retry'}
          </button>
          {conflict && (
            <button
              className="lane-btn"
              disabled={busy || terminalBlocked}
              title={
                terminalBlocked
                  ? 'available once this run finishes and no terminal is open'
                  : 'open a terminal on the feature branch, briefed with this ticket and its conflicting files, and resolve it yourself'
              }
              onClick={(e) => {
                e.stopPropagation()
                launch.mutate({
                  featureId: ticket.featureId,
                  kind: 'revisit',
                  kickoffLine: ticketConflictKickoff({
                    seq: ticket.seq,
                    title: ticket.title,
                    branch: ticket.attemptBranch ?? '',
                    featureBranch,
                    files: conflict,
                  }),
                })
              }}
            >
              Resolve in terminal
            </button>
          )}
          <button
            className="lane-btn lane-btn-danger"
            disabled={busy}
            title={
              conflict
                ? 'throw away the conflicting branch and re-implement the ticket from the current feature branch tip'
                : 'discard any preserved commits from previous attempts and redo the ticket from the feature branch tip'
            }
            onClick={(e) => {
              e.stopPropagation()
              if (confirm(`Discard ticket #${ticket.seq}'s preserved work (if any) and start over?`)) {
                retry.mutate({ ticketId: ticket.id, fresh: true })
              }
            }}
          >
            Retry fresh
          </button>
        </div>
      )}
      {!readonly && ticket.status === 'burning' && (
        <div className="lane-actions">
          <button
            className="lane-btn lane-btn-danger"
            disabled={busy}
            title="stop this ticket's agent — other lanes keep burning; committed work is preserved for retry"
            onClick={(e) => {
              e.stopPropagation()
              // Hook-level onSuccess (invalidate) still runs; this only adds the
              // no-op feedback when the agent already finished.
              stop.mutate(
                { ticketId: ticket.id },
                {
                  onSuccess: (r) => {
                    if (r.swept) {
                      toast.push('no live agent — the lane was orphaned; marked failed, retry to resume it', 'info')
                    } else if (!r.stopped) {
                      toast.push('no live agent for this ticket (already finishing?)', 'info')
                    }
                  },
                },
              )
            }}
          >
            Stop ticket
          </button>
        </div>
      )}
      {(hasCommits || hasDuration) && (
        <div className="lane-foot">
          <span className="lane-commits">
            {ticket.commits.map((c) => (
              <button
                key={c}
                className="commit-sha"
                onClick={(e) => {
                  e.stopPropagation()
                  copy(c)
                }}
                title="copy sha"
              >
                {shortSha(c)}
              </button>
            ))}
          </span>
          {hasDuration && <span className="lane-dur">{fmtDuration(0, duration)}</span>}
        </div>
      )}
    </div>
  )
}

function EventStream({ events }: { events: EventRow[] }) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [following, setFollowing] = useState(true)

  useEffect(() => {
    if (!following) return
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [events, following])

  const onScroll = () => {
    const el = scrollRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24
    setFollowing(atBottom)
  }

  return (
    <div className="stream-body" ref={scrollRef} onScroll={onScroll}>
      {events.length === 0 && <DimLine>waiting for events…</DimLine>}
      {events.map((e) => (
        <div key={e.id} className={`stream-line level-${eventLevel(e)}`}>
          <span className="sl-time">{fmtTime(e.ts)}</span>
          <span className="sl-type">{e.type}</span>
          <span className="sl-msg">{e.message}</span>
        </div>
      ))}
      {!following && (
        <button className="follow-pill agent-follow" onClick={() => setFollowing(true)}>
          Follow ⇣
        </button>
      )}
    </div>
  )
}

/** Best-effort per-ticket duration from its first→last event timestamps. */
function ticketDurations(events: EventRow[]): Map<string, number> {
  const span = new Map<string, { min: number; max: number }>()
  for (const e of events) {
    if (!e.ticketId) continue
    const s = span.get(e.ticketId)
    if (!s) span.set(e.ticketId, { min: e.ts, max: e.ts })
    else {
      s.min = Math.min(s.min, e.ts)
      s.max = Math.max(s.max, e.ts)
    }
  }
  const out = new Map<string, number>()
  for (const [id, s] of span) if (s.max > s.min) out.set(id, s.max - s.min)
  return out
}
