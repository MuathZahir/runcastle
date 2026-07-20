import { useEffect, useMemo, useRef, useState } from 'react'
import type { EventRow, Ticket } from '@runcastle/core'
import { trpc } from '../../trpc'
import { useToast } from '../../lib/toast'
import { useEventLog } from '../../lib/events'
import { fmtDuration, fmtTime, shortSha } from '../../lib/format'
import { DimLine, RunStatusChip, SessionStatusDot, TicketStatusChip } from '../../ui'
import { EndSessionButton } from '../EndSessionButton'
import { ErrorBoundary } from '../ErrorBoundary'
import { TerminalView } from '../TerminalView'

/**
 * Run / implementation phase-body for the pipeline-first workspace: a lanes|stream
 * split — ticket lanes on the left, a live auto-following event stream on the
 * right. No run header/cancel here (that moved to the workspace next-step bar);
 * this body renders only the split. `readonly` is accepted but ignored (a log).
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
  void readonly
  const feature = trpc.feature.get.useQuery({ id: featureId }, { refetchInterval: 1500 })
  const run = trpc.run.get.useQuery(
    { runId: runId as string },
    { refetchInterval: 1500, enabled: !!runId },
  )
  const events = useEventLog(featureId)

  const tickets = feature.data?.tickets ?? []
  const runEvents = useMemo(() => events.filter((e) => e.runId === runId), [events, runId])
  const durations = useMemo(() => ticketDurations(runEvents), [runEvents])

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
              <Lane key={t.id} ticket={t} duration={durations.get(t.id)} />
            ))}
          </div>
        </div>

        <EventStream events={runEvents} />
      </div>
    </div>
  )
}

function Lane({ ticket, duration }: { ticket: Ticket; duration?: number }) {
  const toast = useToast()
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
  return (
    <div className={`lane${mod}`}>
      <div className="lane-head">
        <span className="lane-seq">#{ticket.seq}</span>
        <span className="lane-title">{ticket.title}</span>
        <TicketStatusChip status={ticket.status} />
      </div>
      {(hasCommits || hasDuration) && (
        <div className="lane-foot">
          <span className="lane-commits">
            {ticket.commits.map((c) => (
              <button
                key={c}
                className="commit-sha"
                onClick={() => copy(c)}
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
    <div className="run-stream-panel">
      <div className="stream-head">
        <span className="panel-cap">Event stream</span>
        {!following && (
          <button className="follow-pill" onClick={() => setFollowing(true)}>
            Follow ⇣
          </button>
        )}
      </div>
      <div className="stream-body" ref={scrollRef} onScroll={onScroll}>
        {events.length === 0 && <DimLine>waiting for events…</DimLine>}
        {events.map((e) => (
          <div key={e.id} className={`stream-line level-${eventLevel(e.type)}`}>
            <span className="sl-time">{fmtTime(e.ts)}</span>
            <span className="sl-type">{e.type}</span>
            <span className="sl-msg">{e.message}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/** Colour class from the event type keyword. */
function eventLevel(type: string): 'error' | 'ok' | 'active' | 'info' {
  if (/(error|fail|conflict|cancel)/i.test(type)) return 'error'
  if (/(done|succeed|finished|shipped|merged)/i.test(type)) return 'ok'
  if (/(start|burn|launch|advance|running)/i.test(type)) return 'active'
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
