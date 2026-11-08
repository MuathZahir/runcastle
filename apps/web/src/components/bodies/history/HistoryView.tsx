import type { ReactNode } from 'react'
import type { ReviewFinding, RoundSummary, Ticket, TicketStatus } from '@runcastle/core'
import { trpc } from '../../../trpc'
import { fmtDuration } from '../../../lib/format'
import { IconAlert, IconCheck, IconChevronRight, IconEye, IconX } from '../../../icons'
import { cx } from '../../../ui'
import { Markdown } from '../../Markdown'

/**
 * The feature's History (burns-become-workers decision 19): the tickets it ran
 * before work went to workers, frozen and read only. Each round folds to one
 * line; open, its tickets, and each ticket's goal, digest and — for a review —
 * what it found. No action, no live transcript: nothing writes these any more.
 * Only a feature with old tickets offers the view.
 */
export function HistoryView({ featureId }: { featureId: string }) {
  const full = trpc.feature.get.useQuery({ id: featureId })
  const rounds = trpc.feature.rounds.useQuery({ featureId })
  const findings = trpc.findings.listByFeature.useQuery({ featureId })
  if (!full.data) return null
  return <TicketHistory tickets={full.data.tickets} rounds={rounds.data ?? []} findings={findings.data?.findings ?? []} />
}

/** The history itself, from what the read queries returned: rounds oldest first, then any ticket no round ran. */
export function TicketHistory({
  tickets,
  rounds,
  findings,
}: {
  tickets: readonly Ticket[]
  rounds: readonly RoundSummary[]
  findings: readonly ReviewFinding[]
}) {
  if (tickets.length === 0) return null
  const ordered = [...rounds].sort((a, b) => a.round - b.round)
  const ran = new Set(ordered.flatMap((r) => r.ticketSeqs))
  const never = tickets.filter((t) => !ran.has(t.seq))
  const of = (r: RoundSummary) => tickets.filter((t) => r.ticketSeqs.includes(t.seq))
  return (
    <div className="flex flex-col gap-4">
      <p className="m-0 text-xs text-text-tertiary">
        Tickets this feature ran before its work went to workers. Kept as a record; none runs again.
      </p>
      <div className="-mx-2.5 flex flex-col gap-0.5">
        {ordered.map((round) => (
          <Fold key={round.runId} title={`Round ${round.round}`} facts={roundFacts(round, of(round))}>
            {of(round).map((t) => (
              <HistoryTicket key={t.id} ticket={t} findings={findings} />
            ))}
          </Fold>
        ))}
        {never.length > 0 && (
          <Fold title="Never run" facts={`${never.length} ${never.length === 1 ? 'ticket' : 'tickets'}`}>
            {never.map((t) => (
              <HistoryTicket key={t.id} ticket={t} findings={findings} />
            ))}
          </Fold>
        )}
      </div>
    </div>
  )
}

/** A round's one line: what landed, what failed, the checks, how long it took. */
function roundFacts(round: RoundSummary, tickets: readonly Ticket[]): string {
  const work = tickets.filter((t) => t.kind !== 'review')
  const parts = [`${round.landed.filter((s) => work.some((t) => t.seq === s)).length} of ${work.length} landed`]
  if (round.failed.length) parts.push(`${round.failed.length} failed`)
  if (round.gates) parts.push(round.gates.ok ? 'checks passed' : 'checks failed')
  if (round.finishedAt) parts.push(fmtDuration(round.startedAt, round.finishedAt))
  return parts.join(' · ')
}

/** A row that opens in place, with no state of its own: the browser's disclosure. */
function Fold({ title, facts, children }: { title: ReactNode; facts: string; children: ReactNode }) {
  return (
    <details className="group/fold rounded-lg open:card">
      <summary className="flex h-9 cursor-pointer list-none items-center gap-2 rounded-[inherit] px-2.5 hover:bg-surface-hover [&::-webkit-details-marker]:hidden">
        <IconChevronRight
          size={12}
          className="shrink-0 text-icon transition-transform duration-(--dur-2) ease-app group-open/fold:rotate-90"
        />
        <span className="shrink-0 text-sm font-medium text-text-secondary">{title}</span>
        <span className="min-w-0 truncate text-xs text-text-tertiary">{facts}</span>
      </summary>
      <div className="flex flex-col gap-0.5 p-1 pt-0">{children}</div>
    </details>
  )
}

/** How a ticket ended, as a 12px glyph and a word. */
const STATUS: Record<TicketStatus, { glyph: ReactNode; word: string }> = {
  pending: { glyph: <span className="size-2.5 rounded-full border border-dashed border-text-tertiary" />, word: 'Not run' },
  burning: { glyph: <IconAlert size={12} className="text-warning" />, word: 'Cut off' },
  done: { glyph: <IconCheck size={12} className="text-success" />, word: 'Landed' },
  failed: { glyph: <IconAlert size={12} className="text-danger" />, word: 'Failed' },
  cancelled: { glyph: <IconX size={12} className="text-text-disabled" />, word: 'Cancelled' },
}

/** One old ticket: its number, title and how it ended; open, its goal, what its worker said, and what a review found. */
function HistoryTicket({ ticket, findings }: { ticket: Ticket; findings: readonly ReviewFinding[] }) {
  const review = ticket.kind === 'review'
  const found = findings.filter((f) => f.reviewTicketId === ticket.id)
  const look = review && ticket.status === 'done' ? { ...STATUS.done, word: 'Reviewed' } : STATUS[ticket.status]
  return (
    <details data-ticket-status={ticket.status} className="rounded-md open:card">
      <summary className="flex cursor-pointer list-none flex-col gap-0.5 rounded-[inherit] px-2.5 py-2 hover:bg-surface-hover [&::-webkit-details-marker]:hidden">
        <span className="flex min-w-0 items-center gap-2">
          <span className="w-6 shrink-0 text-xs text-text-tertiary tabular-nums">#{ticket.seq}</span>
          <span className={cx('min-w-0 flex-1 truncate text-md', ticket.status === 'cancelled' ? 'text-text-tertiary line-through' : 'text-text')}>
            {ticket.title}
          </span>
          {review && <IconEye size={14} className="shrink-0 text-icon" aria-label="Review" />}
        </span>
        <span className="flex min-w-0 items-center gap-1.5 pl-8 text-xs text-text-tertiary">
          <span className="inline-flex size-3 shrink-0 items-center justify-center">{look.glyph}</span>
          <span className="min-w-0 flex-1 truncate">{look.word}</span>
        </span>
      </summary>
      <div className="flex flex-col gap-4 pt-1 pr-3 pb-4 pl-10.5">
        {ticket.error && ticket.status === 'failed' && (
          <Part title="What went wrong">
            <p className="m-0 text-sm whitespace-pre-wrap text-text-secondary">{ticket.error}</p>
          </Part>
        )}
        {ticket.goal && (
          <Part title="Goal">
            <Markdown source={ticket.goal} />
          </Part>
        )}
        {ticket.digest && !review && (
          <Part title="What the worker said">
            <Markdown source={ticket.digest} />
          </Part>
        )}
        {found.length > 0 && (
          <Part title="Findings">
            <ul className="m-0 flex list-none flex-col gap-1 p-0">
              {found.map((f) => (
                <li key={f.id} className="text-sm text-text-secondary">
                  <span className="text-text">{f.title}</span>
                  <span className="text-xs text-text-tertiary">
                    {' '}
                    · {f.kind} · {f.status}
                  </span>
                </li>
              ))}
            </ul>
          </Part>
        )}
      </div>
    </details>
  )
}

/** One part of an opened ticket: a quiet 12px heading, then its content. */
function Part({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1">
      <h4 className="m-0 text-xs font-medium text-text-tertiary">{title}</h4>
      {children}
    </section>
  )
}
