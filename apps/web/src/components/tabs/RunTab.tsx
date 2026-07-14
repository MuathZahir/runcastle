import { useEffect, useMemo, useRef, useState } from 'react'
import type { EventRow, Ticket } from '@runcastle/core'
import { trpc } from '../../trpc'
import { useToast } from '../../lib/toast'
import { useEventLog } from '../../lib/events'
import { fmtDuration, shortSha } from '../../lib/format'
import { DimLine, RunStatusChip, TicketStatusChip } from '../../ui'

/**
 * Run tab (UI-SPEC §3): 40/60 split — ticket lanes on the left, a live event
 * stream (auto-follow with pause-on-scroll) on the right. Header shows run
 * status + X/Y done + elapsed + a Cancel ghost button wired to `run.cancel`.
 */
export function RunTab({ featureId, runId }: { featureId: string; runId: string }) {
  const toast = useToast()
  const utils = trpc.useUtils()
  const run = trpc.run.get.useQuery({ runId }, { refetchInterval: 1500 })
  const full = trpc.feature.get.useQuery({ id: featureId }, { refetchInterval: 1500 })
  const events = useEventLog(featureId)

  const cancel = trpc.run.cancel.useMutation({
    onSuccess: () => {
      utils.feature.get.invalidate({ id: featureId })
      utils.feature.list.invalidate()
      toast.push('cancel requested', 'info')
    },
    onError: (e) => toast.push(e.message),
  })

  const runEvents = useMemo(() => events.filter((e) => e.runId === runId), [events, runId])
  const tickets = full.data?.tickets ?? []
  const durations = useMemo(() => ticketDurations(events), [events])

  const status = run.data?.status ?? 'running'
  const done = tickets.filter((t) => t.status === 'done').length
  const total = tickets.length
  const elapsed = run.data
    ? fmtDuration(run.data.startedAt, run.data.endedAt ?? Date.now())
    : '—'

  return (
    <div className="run">
      <div className="run-header">
        <div className="run-header-left">
          <RunStatusChip status={status} />
          <span className="mono run-count">{done}/{total} done</span>
          <span className="mono run-elapsed">{elapsed}</span>
          {run.data?.summary && <span className="run-summary">{run.data.summary}</span>}
        </div>
        <button
          className="btn btn-ghost btn-xs"
          disabled={status !== 'running' || cancel.isPending}
          onClick={() => cancel.mutate({ runId })}
        >
          {cancel.isPending ? 'Cancelling…' : 'Cancel'}
        </button>
      </div>

      <div className="run-split">
        <div className="run-lanes">
          <div className="section-title">Lanes</div>
          {tickets.length === 0 && <DimLine>no ticket lanes</DimLine>}
          {tickets.map((t) => (
            <Lane key={t.id} ticket={t} duration={durations.get(t.id)} />
          ))}
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
  return (
    <div className={`lane status-${ticket.status}`}>
      <div className="lane-head">
        <span className="lane-seq mono">#{ticket.seq}</span>
        <span className="lane-title">{ticket.title}</span>
        <TicketStatusChip status={ticket.status} />
      </div>
      <div className="lane-foot mono">
        {ticket.commits.length > 0 ? (
          <span className="lane-commits">
            {ticket.commits.map((c) => (
              <button key={c} className="commit-sha" onClick={() => copy(c)} title="copy sha">
                {shortSha(c)}
              </button>
            ))}
          </span>
        ) : (
          <span className="dim-line">no commits</span>
        )}
        {duration !== undefined && <span className="lane-dur">{fmtDuration(0, duration)}</span>}
      </div>
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
    <div className="run-stream">
      <div className="stream-head">
        <span className="section-title">Events</span>
        {!following && (
          <button className="follow-pill" onClick={() => setFollowing(true)}>
            Follow ⇣
          </button>
        )}
      </div>
      <div className="stream-body mono" ref={scrollRef} onScroll={onScroll}>
        {events.length === 0 && <DimLine>waiting for events…</DimLine>}
        {events.map((e) => (
          <div key={e.id} className={`stream-line level-${eventLevel(e.type)}`}>
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
