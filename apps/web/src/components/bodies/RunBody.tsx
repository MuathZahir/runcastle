import { useEffect, useMemo, useRef, useState } from 'react'
import type { EventRow, Ticket } from '@runcastle/core'
import { trpc } from '../../trpc'
import { useToast } from '../../lib/toast'
import { useEventLog } from '../../lib/events'
import { fmtDuration, fmtTime, shortSha } from '../../lib/format'
import { DimLine, RunStatusChip, SessionStatusDot, TicketStatusChip } from '../../ui'
import { AgentTranscript } from '../AgentTranscript'
import { EndSessionButton } from '../EndSessionButton'
import { ErrorBoundary } from '../ErrorBoundary'
import { TerminalView } from '../TerminalView'

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
  const feature = trpc.feature.get.useQuery({ id: featureId }, { refetchInterval: 1500 })
  const run = trpc.run.get.useQuery(
    { runId: runId as string },
    { refetchInterval: 1500, enabled: !!runId },
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

  // Same pattern as TicketsBody: a live HITL session (a revisit opened between
  // runs) renders as an inline terminal — without this the session is invisible
  // at the build phase.
  const session = [...(feature.data?.sessions ?? [])]
    .reverse()
    .find((s) => s.status === 'live' || s.status === 'launching')

  if (!runId && !session) {
    return <DimLine>no run yet — start the burn from the workspace.</DimLine>
  }

  return (
    <div className="ws-body-inner">
      {session && (
        <div className="grill-panel tickets-session">
          <div className="grill-strip">
            <span className="grill-kind">{session.kind}</span>
            <span className="grill-sid">{session.ccSessionId ?? session.id}</span>
            <SessionStatusDot status={session.status} />
            <span className="grill-strip-spacer" />
            <EndSessionButton featureId={featureId} sessionId={session.id} />
          </div>
          <div className="grill-term" id="grill-term">
            <ErrorBoundary label="terminal">
              <TerminalView sessionId={session.id} />
            </ErrorBoundary>
          </div>
        </div>
      )}

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
                duration={durations.get(t.id)}
                selected={t.id === selectedId}
                readonly={readonly}
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
                <DimLine>no agent yet — lanes light up here as tickets start burning.</DimLine>
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
  duration,
  selected,
  readonly,
  onSelect,
}: {
  ticket: Ticket
  duration?: number
  selected: boolean
  readonly: boolean
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
  const busy = retry.isPending || stop.isPending
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
      {errorHeadline && (
        <div className="lane-error" title={ticket.error}>
          {errorHeadline}
        </div>
      )}
      {!readonly && ticket.status === 'failed' && (
        <div className="lane-actions">
          <button
            className="lane-btn"
            disabled={busy}
            title="retry this ticket — continues from any commits preserved by previous attempts"
            onClick={(e) => {
              e.stopPropagation()
              retry.mutate(
                { ticketId: ticket.id },
                {
                  onSuccess: (r) => {
                    if (r.resumedFrom) {
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
            Retry
          </button>
          <button
            className="lane-btn lane-btn-danger"
            disabled={busy}
            title="discard any preserved commits from previous attempts and redo the ticket from the feature branch tip"
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
                    if (!r.stopped) toast.push('no live agent for this ticket (already finishing?)', 'info')
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
        <div key={e.id} className={`stream-line level-${eventLevel(e.type)}`}>
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

/** Colour class from the event type keyword. */
function eventLevel(type: string): 'error' | 'ok' | 'active' | 'info' {
  if (/(error|fail|conflict|cancel|stopped)/i.test(type)) return 'error'
  if (/(done|succeed|finished|shipped|merged)/i.test(type)) return 'ok'
  if (/(start|burn|launch|advance|running|retry|resum)/i.test(type)) return 'active'
  return 'info'
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
