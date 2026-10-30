import { useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import type { ModelEntry, RoundSummary, Ticket } from '@runcastle/core'
import { trpc } from '../../../trpc'
import { useEventLog } from '../../../lib/events'
import { laneState, ticketDurations, ticketModelChip, type LaneState } from '../../../lib/feature-ui'
import { fmtDuration, shortSha } from '../../../lib/format'
import { useLivePoll } from '../../../lib/live'
import { effectiveStepModel, rosterFromView } from '../../../lib/settings'
import { SANDBOX_MODE } from '../../../lib/env'
import { Button, EmptyState, IconButton, Spinner, cx } from '../../../ui'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../../ui/dropdown-menu'
import {
  IconAlert,
  IconCheck,
  IconChevronRight,
  IconCube,
  IconEye,
  IconMore,
  IconPencil,
  IconPlay,
  IconRefresh,
  IconStop,
  IconX,
} from '../../../icons'
import { Markdown } from '../../Markdown'
import { LaneTranscript } from '../../run/LaneTranscript'

/**
 * The panel's Tickets view (the-feature-s-right-panel decisions 17–19): one
 * list. Earlier rounds sit folded at the top, one line each; below them, the
 * current round's tickets as sidebar rows — the running round, or the tickets
 * waiting to run next. No Run section, no run timeline, no history picker:
 * the round is the list, and Stop is the page header's.
 */
export function TicketsView({ featureId }: { featureId: string }) {
  const poll = useLivePoll()
  const full = trpc.feature.get.useQuery({ id: featureId }, { refetchInterval: poll })
  const roundsQ = trpc.feature.rounds.useQuery({ featureId }, { refetchInterval: poll })
  const projectId = full.data?.feature.projectId
  const settings = trpc.settings.get.useQuery({ projectId: projectId ?? '' }, { enabled: !!projectId })
  const events = useEventLog(featureId)
  const durations = useMemo(() => ticketDurations(events), [events])
  const roster = rosterFromView(settings.data)
  const defaultModel = effectiveStepModel(settings.data, 'implement')

  if (!full.data) return null
  const tickets = full.data.tickets
  if (tickets.length === 0)
    return (
      <EmptyState
        compact
        icon={<IconCube />}
        title="No tickets yet"
        hint="The agent breaks the work into tickets when it is worth handing to workers. They appear here."
      />
    )

  const { folded, current } = splitRounds(tickets, roundsQ.data ?? [])
  const waiting = tickets.filter((t) => t.status === 'pending')
  const runningRun = full.data.runs.find((r) => r.status === 'running')

  return (
    <div className="flex flex-col">
      {folded.length > 0 && (
        <div className="-mx-2.5 mb-6 flex flex-col">
          {folded.map((group) => (
            <RoundFold key={group.round.round} round={group.round} tickets={group.tickets} roster={roster} durations={durations} />
          ))}
        </div>
      )}

      <div className="mb-2 flex min-h-7 items-center gap-2">
        <h2 className="m-0 text-sm font-medium text-text">
          {current.round ? `Round ${current.round.round}` : current.number > 1 ? `Round ${current.number}` : 'Round 1'}
        </h2>
        <span className={cx('min-w-0 truncate text-xs', current.running ? 'text-shimmer text-text-secondary' : 'text-text-tertiary')}>
          {roundWords(current)}
        </span>
        <span className="ml-auto flex items-center gap-1">
          {runningRun && (
            <span className="text-xs text-text-tertiary tabular-nums">{fmtDuration(runningRun.startedAt, Date.now())}</span>
          )}
          <ListMenu roster={roster} defaultModel={defaultModel} waiting={waiting.length} />
        </span>
      </div>
      <div className="-mx-2.5 flex flex-col gap-0.5">
        {current.tickets.map((ticket, i) => (
          <TicketItem
            key={ticket.id}
            ticket={ticket}
            index={i}
            roster={roster}
            duration={durations.get(ticket.id)}
            runStartedAt={current.running ? runningRun?.startedAt : undefined}
            tickets={tickets}
          />
        ))}
      </div>
    </div>
  )
}

interface RoundGroup {
  round: RoundSummary
  tickets: Ticket[]
}

interface CurrentRound {
  /** The round on show, or null for tickets no round has run yet. */
  round: RoundSummary | null
  /** The number the waiting tickets will run as. */
  number: number
  running: boolean
  tickets: Ticket[]
}

/**
 * Which round is the current one (decision 18): the running round; else the
 * tickets waiting to run, as the next round; else the latest round. Every
 * other round folds.
 */
export function splitRounds(
  tickets: readonly Ticket[],
  rounds: readonly RoundSummary[],
): { folded: RoundGroup[]; current: CurrentRound } {
  const ordered = [...rounds].sort((a, b) => a.round - b.round)
  const ran = new Set(ordered.flatMap((r) => r.ticketSeqs))
  const of = (r: RoundSummary) => tickets.filter((t) => r.ticketSeqs.includes(t.seq))
  const unrun = tickets.filter((t) => !ran.has(t.seq) && t.status !== 'cancelled')
  const running = ordered.find((r) => r.status === 'running')
  const last = ordered[ordered.length - 1]
  const current: CurrentRound = running
    ? { round: running, number: running.round, running: true, tickets: of(running) }
    : unrun.length > 0 || !last
      ? { round: null, number: (last?.round ?? 0) + 1, running: false, tickets: unrun }
      : { round: last, number: last.round, running: false, tickets: of(last) }
  const folded = ordered.filter((r) => r !== current.round).map((round) => ({ round, tickets: of(round) }))
  return { folded, current }
}

/** The current round in words: what it is doing, or what it holds. */
function roundWords(current: CurrentRound): string {
  const work = current.tickets.filter((t) => t.kind !== 'review')
  const landed = work.filter((t) => t.status === 'done').length
  if (current.running) return `Running · ${landed} of ${work.length} landed`
  if (!current.round) return `${work.length} ${work.length === 1 ? 'ticket waits' : 'tickets wait'} to run`
  return roundFacts(current.round, current.tickets)
}

/** A finished round's one line: what landed, what failed, the gates. */
function roundFacts(round: RoundSummary, tickets: readonly Ticket[]): string {
  const work = tickets.filter((t) => t.kind !== 'review')
  const parts = [`${round.landed.filter((s) => work.some((t) => t.seq === s)).length} of ${work.length} landed`]
  if (round.failed.length) parts.push(`${round.failed.length} failed`)
  if (round.gates) parts.push(round.gates.ok ? 'checks passed' : 'checks failed')
  return parts.join(' · ')
}

/** An earlier round, folded to one line; open, its tickets as quiet rows. */
function RoundFold({
  round,
  tickets,
  roster,
  durations,
}: {
  round: RoundSummary
  tickets: Ticket[]
  roster: readonly ModelEntry[]
  durations: Map<string, number>
}) {
  const [open, setOpen] = useState(false)
  const took = round.finishedAt ? fmtDuration(round.startedAt, round.finishedAt) : null
  return (
    <div className={cx('rounded-lg transition-colors duration-(--dur-1) ease-app', open && 'card')}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className={cx(
          'flex h-9 w-full cursor-pointer items-center gap-2 rounded-[inherit] px-2.5 text-left',
          !open && 'hover:bg-surface-hover',
        )}
      >
        <IconChevronRight
          size={12}
          className={cx('shrink-0 text-icon transition-transform duration-(--dur-2) ease-app', open && 'rotate-90')}
        />
        <span className="shrink-0 text-sm font-medium text-text-secondary">Round {round.round}</span>
        <span className="min-w-0 truncate text-xs text-text-tertiary">{roundFacts(round, tickets)}</span>
        {took && <span className="ml-auto shrink-0 text-xs text-text-tertiary tabular-nums">{took}</span>}
      </button>
      {open && (
        <div className="flex flex-col gap-0.5 p-1 pt-0 animate-fade-in">
          {tickets.map((ticket) => (
            <TicketItem key={ticket.id} ticket={ticket} roster={roster} duration={durations.get(ticket.id)} tickets={tickets} nested />
          ))}
        </div>
      )}
    </div>
  )
}

/** How a ticket's state is said: a 12px glyph and words (DESIGN.md: facts are text). */
const STATE: Record<LaneState, { glyph: ReactNode; word: string; tone?: string }> = {
  pending: { glyph: <span className="size-2.5 rounded-full border border-dashed border-text-tertiary" />, word: 'Waiting' },
  burning: { glyph: <Spinner size="sm" />, word: 'Running' },
  done: { glyph: <IconCheck size={12} className="text-success" />, word: 'Landed' },
  failed: { glyph: <IconAlert size={12} className="text-danger" />, word: 'Failed', tone: 'text-danger-text' },
  'launch-failed': { glyph: <IconAlert size={12} className="text-danger" />, word: 'Could not start', tone: 'text-danger-text' },
  stopped: { glyph: <IconStop size={12} className="text-warning" />, word: 'Stopped', tone: 'text-warning-text' },
  waived: { glyph: <IconX size={12} className="text-text-disabled" />, word: 'Set aside' },
}

/**
 * One ticket as a sidebar row (decision 19): the number and the title at
 * 14px, then a 12px line saying its state in words, and its model. A running
 * ticket's words shimmer, as a working sidebar row's do. Opened, the row
 * becomes a card: its actions, the goal and acceptance, then the worker's live
 * log or its digest.
 */
function TicketItem({
  ticket,
  index,
  roster,
  duration,
  runStartedAt,
  tickets,
  nested = false,
}: {
  ticket: Ticket
  index?: number
  roster: readonly ModelEntry[]
  duration?: number | undefined
  runStartedAt?: number | undefined
  tickets: readonly Ticket[]
  nested?: boolean
}) {
  const [open, setOpen] = useState(false)
  const state = laneState(ticket)
  const waitsOn = state === 'pending' ? ticket.blockedBy.filter((s) => tickets.find((t) => t.seq === s)?.status !== 'done') : []
  const look = STATE[state]
  const model = ticketModelChip(ticket, roster)
  const review = ticket.kind === 'review'
  const words = [
    review && state === 'pending'
      ? 'Review · waits for the work'
      : review && state === 'done'
        ? 'Reviewed'
        : waitsOn.length
          ? `Waits on #${waitsOn.join(', #')}`
          : look.word,
    state === 'burning' && runStartedAt ? fmtDuration(runStartedAt, Date.now()) : null,
    // A review lands no code: its row says what it did, not a commit.
    state === 'done' && !review && ticket.commits[0] ? shortSha(ticket.commits[0]) : null,
    state === 'done' && duration ? `${Math.round(duration / 60_000)}m` : null,
    (state === 'failed' || state === 'launch-failed') && ticket.error ? ticket.error.split('\n')[0] : null,
  ]
    .filter(Boolean)
    .join(' · ')
  const staggered = index !== undefined && index < 8

  return (
    <article
      data-ticket-state={state}
      style={staggered ? ({ '--i': index } as CSSProperties) : undefined}
      className={cx(
        'group/ticket relative transition-colors duration-(--dur-1) ease-app',
        nested ? 'rounded-md' : 'rounded-lg',
        open ? 'card' : 'hover:bg-surface-hover',
        staggered && 'animate-rise-in [animation-delay:calc(var(--i)*20ms)] [animation-fill-mode:both]',
      )}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex w-full cursor-pointer flex-col gap-0.5 rounded-[inherit] px-2.5 py-2 text-left"
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="w-6 shrink-0 text-xs text-text-tertiary tabular-nums">#{ticket.seq}</span>
          <span
            className={cx(
              'min-w-0 flex-1 truncate text-md',
              state === 'waived' ? 'text-text-tertiary line-through' : open ? 'font-medium text-text' : 'text-text',
            )}
          >
            {ticket.title}
          </span>
          {review && <IconEye size={14} className="shrink-0 text-icon" aria-label="Review" />}
        </span>
        <span className="flex min-w-0 items-center gap-1.5 pl-8 text-xs text-text-tertiary">
          <span className="inline-flex size-3 shrink-0 items-center justify-center">{look.glyph}</span>
          <span className={cx('min-w-0 flex-1 truncate', state === 'burning' && 'text-shimmer', look.tone)}>{words}</span>
          {model && <span className="shrink-0 font-mono">{model.id}</span>}
        </span>
      </button>
      {open && <TicketDetail ticket={ticket} state={state} />}
    </article>
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

/** An opened ticket: what its state allows, then what it is, then what its worker said. */
function TicketDetail({ ticket, state }: { ticket: Ticket; state: LaneState }) {
  const editable = ticket.status === 'pending' || ticket.status === 'failed'
  const retryable = state === 'failed' || state === 'launch-failed' || state === 'stopped'
  return (
    <div className="flex flex-col gap-4 pt-1 pr-3 pb-4 pl-10.5 animate-fade-in">
      <div className="-ml-2 flex flex-wrap gap-1">
        {state === 'burning' && (
          <Button size="sm" variant="danger-ghost" icon={<IconStop />}>
            Stop
          </Button>
        )}
        {retryable && (
          <Button size="sm" variant="ghost" icon={<IconRefresh />}>
            Retry
          </Button>
        )}
        {ticket.kind === 'review' && state === 'done' && (
          <Button size="sm" variant="ghost" icon={<IconPlay />}>
            Watch the walkthrough
          </Button>
        )}
        {editable && (
          <>
            <Button size="sm" variant="ghost" icon={<IconPencil />}>
              Edit
            </Button>
            <Button size="sm" variant="ghost" icon={<IconX />}>
              Cancel
            </Button>
          </>
        )}
      </div>
      {(state === 'failed' || state === 'launch-failed' || state === 'stopped') && ticket.error && (
        <Part title="What went wrong">
          <p className="m-0 text-sm whitespace-pre-wrap text-text-secondary">{ticket.error}</p>
        </Part>
      )}
      {ticket.goal && (
        <Part title="Goal">
          <Markdown source={ticket.goal} />
        </Part>
      )}
      {ticket.acceptanceCriteria.length > 0 && (
        <Part title="Done when">
          <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-sm text-text-secondary marker:text-text-tertiary">
            {ticket.acceptanceCriteria.map((criterion, i) => (
              <li key={i}>{criterion}</li>
            ))}
          </ul>
        </Part>
      )}
      {state === 'burning' ? (
        <Part title="Live log">
          <LaneTranscript ticketId={ticket.id} bootEvents={[]} />
        </Part>
      ) : ticket.digest ? (
        <Part title={ticket.kind === 'review' ? 'What the review found' : 'What the worker said'}>
          <Markdown source={ticket.digest} />
        </Part>
      ) : null}
    </div>
  )
}

/**
 * The list's own controls (decision 19), out of the rows' way: the sandbox
 * and default model as facts, and one model for every waiting ticket.
 */
function ListMenu({
  roster,
  defaultModel,
  waiting,
}: {
  roster: readonly ModelEntry[]
  defaultModel: string | undefined
  waiting: number
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton label="Ticket list options" size="sm" icon={<IconMore />} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-64">
        <DropdownMenuLabel>
          Sandbox {SANDBOX_MODE} · default model <span className="font-mono">{defaultModel ?? 'unset'}</span>
        </DropdownMenuLabel>
        {waiting > 0 && roster.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Run every waiting ticket on</DropdownMenuLabel>
            {roster.map((m) => (
              <DropdownMenuItem key={m.id} icon={<IconCube />}>
                <span className="font-mono">{m.id}</span>
              </DropdownMenuItem>
            ))}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
