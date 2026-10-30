import { useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import type { AgentRuntime, EventRow, ModelEntry, ReviewFinding, RoundSummary, Ticket } from '@runcastle/core'
import { trpc } from '../../../trpc'
import { useEventLog } from '../../../lib/events'
import { useLandOnChat } from '../../../lib/land-on-chat'
import {
  laneFacts,
  laneState,
  sessionActive,
  ticketConflictKickoff,
  ticketDurations,
  ticketModelChip,
  type LaneFacts,
  type LaneState,
} from '../../../lib/feature-ui'
import { fmtDuration, shortSha } from '../../../lib/format'
import { useLivePoll } from '../../../lib/live'
import { useReviewArtifacts, type ReviewArtifacts } from '../../../lib/reviews'
import { effectiveStepModel, rosterFromView } from '../../../lib/settings'
import { useToast } from '../../../lib/toast'
import { STOP_TIMEOUT } from '../../../lib/vocabulary'
import { SANDBOX_MODE } from '../../../lib/env'
import { Button, Dialog, EmptyState, IconButton, Spinner, cx } from '../../../ui'
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
  IconDoc,
  IconEye,
  IconMore,
  IconPencil,
  IconPlay,
  IconStop,
  IconTerminal,
  IconX,
} from '../../../icons'
import { ErrorBoundary } from '../../ErrorBoundary'
import { Markdown } from '../../Markdown'
import { EvidenceStage } from '../../review/EvidenceStage'
import { LaneTranscript } from '../../run/LaneTranscript'
import { MessageWithSettingsLink } from '../../settings/MessageWithSettingsLink'
import { ModelMenu } from './ModelMenu'
import { TicketEditor, type TicketPatch } from './TicketEditor'

/**
 * The panel's Tickets view (the-feature-s-right-panel decisions 17–19): one
 * list. Earlier rounds sit folded at the top, one line each; below them, the
 * current round's tickets as sidebar rows — the running round, or the tickets
 * waiting to run next. No Run section, no run timeline, no history picker:
 * the round is the list, and Stop is the page header's.
 */
export function TicketsView({ featureId, onOpenDoc }: { featureId: string; onOpenDoc: (relPath: string) => void }) {
  const poll = useLivePoll()
  const toast = useToast()
  const utils = trpc.useUtils()
  const full = trpc.feature.get.useQuery({ id: featureId }, { refetchInterval: poll })
  const roundsQ = trpc.feature.rounds.useQuery({ featureId }, { refetchInterval: poll })
  const projectId = full.data?.feature.projectId
  const settings = trpc.settings.get.useQuery({ projectId: projectId ?? '' }, { enabled: !!projectId })
  // What a done review ticket's card says it found, and the walkthrough it recorded.
  const findings = trpc.findings.listByFeature.useQuery({ featureId })
  const recordings = useReviewArtifacts(featureId)
  const events = useEventLog(featureId)
  const attempts = useMemo(() => latestAttempts(events), [events])
  const durations = useMemo(() => ticketDurations(attempts), [attempts])
  const facts = useMemo(() => laneFacts(attempts), [attempts])
  const roster = rosterFromView(settings.data)
  const defaultModel = effectiveStepModel(settings.data, 'implement')
  const [watching, setWatching] = useState<ReviewArtifacts | null>(null)

  const onMutated = {
    onSuccess: () => utils.feature.get.invalidate({ id: featureId }),
    onError: (e: { message: string }) => toast.push(e.message),
  }
  // Reassignment's one door. The scheduler launches each ticket from the live
  // row, so a model chosen here reaches every ticket a run has not started yet.
  const edit = trpc.ticket.edit.useMutation(onMutated)
  const stop = trpc.ticket.stop.useMutation(onMutated)
  // The server kills a live agent first.
  const cancel = trpc.ticket.cancel.useMutation(onMutated)
  // Resolve in terminal lands on the Chat tab, where the session it opens is.
  const landOnChat = useLandOnChat(featureId)
  const launch = trpc.feature.launchSession.useMutation({
    ...onMutated,
    onSuccess: () => {
      void onMutated.onSuccess()
      landOnChat()
    },
  })
  const busy = edit.isPending || stop.isPending || cancel.isPending || launch.isPending

  if (!full.data) return null
  const feature = full.data.feature
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
  // A conflict's "Resolve in terminal" opens a session, which the launcher
  // refuses while a run holds the feature branch or another terminal is open.
  const terminalBlocked = !!runningRun || full.data.sessions.some(sessionActive)

  const onStopped = (r: { stopped: boolean; swept: boolean; confirmed: boolean }) => {
    if (r.swept) toast.push('no live agent — the lane was orphaned; marked failed', 'info')
    else if (!r.stopped) toast.push('no live agent for this ticket (already finishing?)', 'info')
    // The kill ran out of time: the ticket still reads stopped, so this is the
    // only place the human hears that it may not be.
    else if (!r.confirmed) toast.push(STOP_TIMEOUT)
  }
  const controls: TicketControls = {
    roster,
    busy,
    terminalBlocked,
    featureBranch: feature.branch,
    stopping: stop.isPending ? stop.variables?.ticketId : undefined,
    cancelling: cancel.isPending ? cancel.variables?.ticketId : undefined,
    stop: (ticket) => stop.mutate({ ticketId: ticket.id }, { onSuccess: onStopped }),
    setModel: (ticket, model) => edit.mutate({ ticketId: ticket.id, model }),
    // Awaited by the card so the editor stays open, with the human's text, when
    // the save fails; the mutation's own handler raises the error toast.
    save: async (ticket, patch) => {
      await edit.mutateAsync({ ticketId: ticket.id, ...patch })
      toast.push('ticket updated', 'success')
    },
    // A failed ticket is the agent's to retry (the-feature-s-right-panel
    // decision 22), so the human's one way to drop it is the same Cancel.
    cancel: (ticket) =>
      cancel.mutate(
        { ticketId: ticket.id },
        {
          onSuccess: (r) => {
            toast.push('ticket cancelled', 'success')
            // The cancel killed a live agent and the kill ran out of time.
            if (!r.confirmed) toast.push(STOP_TIMEOUT)
          },
        },
      ),
    resolveInTerminal: (ticket, files) =>
      launch.mutate({
        featureId,
        kind: 'chat',
        kickoffLine: ticketConflictKickoff({
          seq: ticket.seq,
          title: ticket.title,
          branch: ticket.attemptBranch ?? '',
          featureBranch: feature.branch,
          files,
        }),
        // This merge lands the ticket branch on the feature branch.
        purpose: 'resolve-conflict',
        purposeData: { mergeFrom: ticket.attemptBranch ?? '', mergeInto: feature.branch },
      }),
    copySha: (sha) =>
      navigator.clipboard?.writeText(sha).then(
        () => toast.push(`copied ${shortSha(sha)}`, 'info'),
        () => toast.push('copy failed'),
      ),
    watch: setWatching,
    facts,
    durations,
    bootEvents: (ticket) => attempts.filter((e) => e.ticketId === ticket.id),
    // An unassigned ticket burns on the project's step model, which is who speaks in its log.
    runtime: (ticket) =>
      (
        ticketModelChip(ticket, roster) ??
        ticketModelChip({ model: effectiveStepModel(settings.data, ticket.kind === 'review' ? 'review' : 'implement') }, roster)
      )?.runtime,
    findings: (ticket) => (findings.data?.findings ?? []).filter((f) => f.reviewTicketId === ticket.id),
    recording: (ticket) => recordings.data?.find((r) => r.ticketId === ticket.id && r.videoUrl),
  }

  // One edit per ticket, in sequence: the wire takes a single ticket at a time
  // and a burst of parallel writes would race the invalidation below.
  const bulkModel = async (model: string) => {
    try {
      for (const ticket of waiting) await utils.client.ticket.edit.mutate({ ticketId: ticket.id, model })
      await utils.feature.get.invalidate({ id: featureId })
      toast.push(`${waiting.length} tickets set to ${model || 'the default model'}`, 'success')
    } catch (error) {
      toast.push(error instanceof Error ? error.message : 'could not update ticket models')
    }
  }

  return (
    <div className="flex flex-col">
      {folded.length > 0 && (
        <div className="-mx-2.5 mb-6 flex flex-col">
          {folded.map((group) => (
            <RoundFold key={group.round.round} round={group.round} tickets={group.tickets} controls={controls} />
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
          <ListMenu
            roster={roster}
            defaultModel={defaultModel}
            waiting={waiting.length}
            onModel={(model) => void bulkModel(model)}
            docs={full.data.docs}
            onOpenDoc={onOpenDoc}
          />
        </span>
      </div>
      <div className="-mx-2.5 flex flex-col gap-0.5">
        {current.tickets.map((ticket, i) => (
          <TicketItem key={ticket.id} ticket={ticket} index={i} tickets={tickets} controls={controls} />
        ))}
      </div>
      <Dialog
        open={!!watching}
        onClose={() => setWatching(null)}
        labelledBy="walkthrough-full-title"
        size="full"
        className="flex h-[86vh] flex-col overflow-hidden"
      >
        <div className="flex h-(--topbar-h) shrink-0 items-center gap-2 border-b border-border-subtle pr-2 pl-5">
          <h2 id="walkthrough-full-title" className="m-0 min-w-0 flex-1 truncate text-sm font-medium text-text">
            Walkthrough{watching ? ` · #${watching.seq}` : ''}
          </h2>
          <IconButton label="Close" size="sm" icon={<IconX />} onClick={() => setWatching(null)} />
        </div>
        {watching && (
          <div className="flex min-h-0 flex-1 flex-col p-5">
            <EvidenceStage
              featureId={featureId}
              branch={feature.branch}
              recordings={[watching]}
              notes={[]}
              readonly
              driveState="idle"
              dryRun={false}
              failure={null}
            />
          </div>
        )}
      </Dialog>
    </div>
  )
}

/** What an opened ticket can do and read — every call and read lives in `TicketsView`. */
interface TicketControls {
  roster: readonly ModelEntry[]
  /** Any mutation is in flight: every action waits for it. */
  busy: boolean
  terminalBlocked: boolean
  featureBranch: string
  /** The ticket whose stop is in flight — it resolves once the agent is confirmed dead. */
  stopping: string | undefined
  /** The ticket whose cancel is in flight — a live agent is killed first. */
  cancelling: string | undefined
  stop: (ticket: Ticket) => void
  setModel: (ticket: Ticket, model: string) => void
  save: (ticket: Ticket, patch: TicketPatch) => Promise<void>
  cancel: (ticket: Ticket) => void
  resolveInTerminal: (ticket: Ticket, files: string[]) => void
  copySha: (sha: string) => void
  watch: (recording: ReviewArtifacts) => void
  facts: Map<string, LaneFacts>
  durations: Map<string, number>
  bootEvents: (ticket: Ticket) => EventRow[]
  runtime: (ticket: Ticket) => AgentRuntime | undefined
  findings: (ticket: Ticket) => ReviewFinding[]
  recording: (ticket: Ticket) => ReviewArtifacts | undefined
}

/**
 * The run events of each ticket's latest attempt: those of the last run that
 * spoke of it. A retried ticket's boot narrative, elapsed time and duration are
 * its new attempt's, not a span over every run that ever burned it.
 */
function latestAttempts(events: readonly EventRow[]): EventRow[] {
  const lastRun = new Map<string, string>()
  for (const e of events) if (e.ticketId && e.runId) lastRun.set(e.ticketId, e.runId)
  return events.filter((e) => e.ticketId !== undefined && e.runId !== undefined && lastRun.get(e.ticketId) === e.runId)
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
  controls,
}: {
  round: RoundSummary
  tickets: Ticket[]
  controls: TicketControls
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
            <TicketItem key={ticket.id} ticket={ticket} tickets={tickets} controls={controls} nested />
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
  tickets,
  controls,
  nested = false,
}: {
  ticket: Ticket
  index?: number
  tickets: readonly Ticket[]
  controls: TicketControls
  nested?: boolean
}) {
  const [open, setOpen] = useState(false)
  const fact = controls.facts.get(ticket.id)
  const duration = controls.durations.get(ticket.id)
  // Whether the agent ever spoke is what tells a launch death from a failure.
  const state = laneState({ ...ticket, hadOutput: fact?.hadOutput })
  const waitsOn = state === 'pending' ? ticket.blockedBy.filter((s) => tickets.find((t) => t.seq === s)?.status !== 'done') : []
  const look = STATE[state]
  const model = ticketModelChip(ticket, controls.roster)
  const review = ticket.kind === 'review'
  const words = [
    review && state === 'pending'
      ? 'Review · waits for the work'
      : review && state === 'done'
        ? 'Reviewed'
        : waitsOn.length
          ? `Waits on #${waitsOn.join(', #')}`
          : look.word,
    state === 'burning' && fact ? fmtDuration(fact.startedAt, Date.now()) : null,
    // A review lands no code: its row says what it did, not a commit.
    state === 'done' && !review && ticket.commits[0] ? shortSha(ticket.commits[0]) : null,
    state === 'done' && duration ? `${Math.round(duration / 60_000)}m` : null,
    // Open, the card says the failure in full; not twice.
    !open && (state === 'failed' || state === 'launch-failed') && ticket.error ? ticket.error.split('\n')[0] : null,
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
      {open && <TicketDetail ticket={ticket} state={state} controls={controls} />}
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
function TicketDetail({ ticket, state, controls }: { ticket: Ticket; state: LaneState; controls: TicketControls }) {
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [confirming, setConfirming] = useState(false)
  // The server's own editable set (`assertMutable`): a stopped ticket is a failed row.
  const editable = ticket.status === 'pending' || ticket.status === 'failed'
  // A landing conflict is not a normal failure: the ticket IS implemented and
  // its commits are safe on the attempt branch, waiting to be resolved.
  const conflict = ticket.status === 'failed' ? ticket.conflictFiles : undefined
  const { busy } = controls
  const review = ticket.kind === 'review' && state === 'done'
  const recording = review ? controls.recording(ticket) : undefined
  const findings = review ? controls.findings(ticket) : []

  if (editing)
    return (
      <TicketEditor
        ticket={ticket}
        busy={saving}
        onCancel={() => setEditing(false)}
        onSave={(patch) => {
          setSaving(true)
          void controls
            .save(ticket, patch)
            .then(
              () => setEditing(false),
              () => undefined,
            )
            .finally(() => setSaving(false))
        }}
      />
    )

  return (
    <div className="flex flex-col gap-4 pt-1 pr-3 pb-4 pl-10.5 animate-fade-in">
      {confirming ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md bg-danger-subtle px-3 py-2 text-sm text-text-secondary">
          <span className="mr-auto">
            Cancel #{ticket.seq}? Tickets that depend on it treat it as done. Its text stays in the list.
          </span>
          <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
            Keep it
          </Button>
          <Button
            size="sm"
            variant="danger"
            disabled={busy}
            onClick={() => {
              controls.cancel(ticket)
              setConfirming(false)
            }}
          >
            Cancel
          </Button>
        </div>
      ) : (
        <div className="-ml-2 flex flex-wrap items-center gap-1">
          {/* One click, deliberately: this is the control reached for at the
              moment an agent is visibly going wrong. */}
          {state === 'burning' && (
            <Button
              size="sm"
              variant="danger-ghost"
              icon={<IconStop />}
              loading={controls.stopping === ticket.id}
              disabled={busy}
              onClick={() => controls.stop(ticket)}
            >
              {controls.stopping === ticket.id ? 'Stopping…' : 'Stop'}
            </Button>
          )}
          {conflict && (
            <Button
              size="sm"
              variant="ghost"
              icon={<IconTerminal />}
              disabled={busy || controls.terminalBlocked}
              title={
                controls.terminalBlocked
                  ? 'available once this run finishes and no terminal is open'
                  : 'open a terminal on the feature branch, briefed with this ticket and its conflicting files, and resolve it yourself'
              }
              onClick={() => controls.resolveInTerminal(ticket, conflict)}
            >
              Resolve in terminal
            </Button>
          )}
          {recording && (
            <Button size="sm" variant="ghost" icon={<IconPlay />} onClick={() => controls.watch(recording)}>
              Watch the walkthrough
            </Button>
          )}
          {editable && (
            <>
              <ModelMenu
                value={ticket.model ?? ''}
                roster={controls.roster}
                ticketKind={ticket.kind}
                disabled={busy}
                onChange={(model) => controls.setModel(ticket, model)}
              />
              <Button size="sm" variant="ghost" icon={<IconPencil />} disabled={busy} onClick={() => setEditing(true)}>
                Edit
              </Button>
            </>
          )}
          {editable && (
            <Button
              size="sm"
              variant="ghost"
              icon={<IconX />}
              loading={controls.cancelling === ticket.id}
              disabled={busy}
              onClick={() => setConfirming(true)}
            >
              Cancel
            </Button>
          )}
        </div>
      )}
      {conflict && (
        <Part title="Merge conflict">
          <p className="m-0 text-sm text-text-secondary">
            The work is committed but could not land on{' '}
            <code className="font-mono text-xs text-text">{controls.featureBranch}</code>
          </p>
          {conflict.length > 0 && (
            <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
              {conflict.map((f) => (
                <li key={f} className="truncate font-mono text-xs text-text-secondary" title={f}>
                  {f}
                </li>
              ))}
            </ul>
          )}
        </Part>
      )}
      {(state === 'failed' || state === 'launch-failed' || state === 'stopped') && ticket.error && (
        <Part title="What went wrong">
          <p className="m-0 text-sm whitespace-pre-wrap text-text-secondary">
            <MessageWithSettingsLink text={ticket.error} />
          </p>
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
      {findings.length > 0 && <FindingsPart findings={findings} />}
      {state === 'done' && ticket.kind !== 'review' && ticket.commits.length > 0 && (
        <Part title="Commits">
          <div className="flex flex-wrap gap-1">
            {ticket.commits.map((sha) => (
              <button
                key={sha}
                type="button"
                title="Copy the full SHA"
                className="cursor-pointer rounded-sm bg-surface-inset px-1.5 py-0.5 font-mono text-xs text-text-secondary transition-colors duration-(--dur-1) hover:text-text"
                onClick={() => controls.copySha(sha)}
              >
                {shortSha(sha)}
              </button>
            ))}
          </div>
        </Part>
      )}
      {state === 'burning' ? (
        <Part title="Live log">
          <ErrorBoundary label="agent transcript">
            <LaneTranscript ticketId={ticket.id} bootEvents={controls.bootEvents(ticket)} runtime={controls.runtime(ticket)} />
          </ErrorBoundary>
        </Part>
      ) : ticket.digest && ticket.digest.trim() !== ticket.error?.trim() ? (
        <Part title={ticket.kind === 'review' ? 'What the review found' : 'What the worker said'}>
          <Markdown source={ticket.digest} />
        </Part>
      ) : null}
    </div>
  )
}

/** A done review's findings: its defects by title, its observations quieter. */
function FindingsPart({ findings }: { findings: readonly ReviewFinding[] }) {
  const ordered = [...findings].sort((a, b) => Number(a.kind === 'observation') - Number(b.kind === 'observation'))
  return (
    <Part title="Findings">
      <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-sm marker:text-text-tertiary">
        {ordered.map((f) => (
          <li key={f.id} className={f.kind === 'defect' ? 'text-text-secondary' : 'text-text-tertiary'}>
            {f.title}
          </li>
        ))}
      </ul>
    </Part>
  )
}

/**
 * The list's own controls (decision 19), out of the rows' way: the sandbox
 * and default model as facts, one model for every waiting ticket, and the
 * feature's docs, each read in place in this view (decision 7).
 */
function ListMenu({
  roster,
  defaultModel,
  waiting,
  onModel,
  docs,
  onOpenDoc,
}: {
  roster: readonly ModelEntry[]
  defaultModel: string | undefined
  waiting: number
  onModel: (model: string) => void
  docs: readonly { relPath: string; title: string }[]
  onOpenDoc: (relPath: string) => void
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
              <DropdownMenuItem key={m.id} icon={<IconCube />} onSelect={() => onModel(m.id)}>
                <span className="font-mono">{m.id}</span>
              </DropdownMenuItem>
            ))}
          </>
        )}
        {docs.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Docs</DropdownMenuLabel>
            {docs.map((doc) => (
              <DropdownMenuItem key={doc.relPath} icon={<IconDoc />} onSelect={() => onOpenDoc(doc.relPath)}>
                {doc.title || doc.relPath.split(/[\\/]/).pop()}
              </DropdownMenuItem>
            ))}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
