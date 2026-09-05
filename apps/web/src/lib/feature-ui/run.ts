export interface LaneTicketFigure {
  seq: number
  status: string
  error?: string | null
  hadOutput?: boolean
  orphaned?: boolean
  kind?: string
  reviewFix?: boolean
}

export type LaneState = 'pending' | 'burning' | 'done' | 'failed' | 'stopped' | 'launch-failed' | 'waived'

const stopped = (ticket: LaneTicketFigure) => ticket.error?.toLowerCase().startsWith('stopped by user') || ticket.orphaned || ticket.error?.toLowerCase().includes('orphaned')
const launchError = (error = '') => /\b(?:git|docker|podman|mount|sandbox)\b/i.test(error)

export function laneState(ticket: LaneTicketFigure): LaneState {
  if (ticket.status === 'cancelled') return 'waived'
  if (ticket.status === 'failed') {
    if (stopped(ticket)) return 'stopped'
    if (ticket.hadOutput === false && launchError(ticket.error ?? '')) return 'launch-failed'
    return 'failed'
  }
  if (ticket.status === 'done') return 'done'
  if (ticket.status === 'burning' || ticket.status === 'running') return 'burning'
  return 'pending'
}

export function verdictStrip(ticket: LaneTicketFigure): { text: string; hint?: string } | null {
  if (!['failed', 'launch-failed'].includes(laneState(ticket))) return null
  const error = ticket.error?.trim() || 'The ticket did not complete.'
  const text = /agent made no commits/i.test(error)
    ? 'The burner verifies commits landed on the ticket branch — none did'
    : laneState(ticket) === 'launch-failed' ? 'The agent sandbox never started.' : error
  const hint = /windows|path too long|long path/i.test(error) ? 'A long Windows path may have prevented the sandbox mount.' : undefined
  return { text, ...(hint ? { hint } : {}) }
}

export function summaryCounts(tickets: readonly LaneTicketFigure[]) {
  return {
    done: tickets.filter((t) => laneState(t) === 'done').length,
    failed: tickets.filter((t) => ['failed', 'launch-failed'].includes(laneState(t))).length,
    stopped: tickets.filter((t) => laneState(t) === 'stopped').length,
    waived: tickets.filter((t) => laneState(t) === 'waived').length,
  }
}

export function runHeadline(tickets: readonly LaneTicketFigure[], _run: object = {}, retryOf?: number): string {
  if (retryOf !== undefined) return `Retrying #${retryOf}`
  const implementation = tickets.filter((t) => t.kind !== 'review' && !t.reviewFix).length
  const fixes = tickets.filter((t) => t.reviewFix).length
  const counts = summaryCounts(tickets)
  const parts = [`Burning ${implementation} ticket${implementation === 1 ? '' : 's'}`]
  if (fixes) parts.push(`+${fixes} fixes from review`)
  if (counts.done) parts.push(`${counts.done} done`)
  if (counts.failed) parts.push(`${counts.failed} failed`)
  if (counts.stopped) parts.push(`${counts.stopped} stopped`)
  if (counts.waived) parts.push(`${counts.waived} waived`)
  return parts.join(' · ')
}

/** The burner prompt's completion signal — a marker for the harness, not prose. */
const COMPLETE_TOKEN = /<promise>\s*COMPLETE\s*<\/promise>/i

export function stripProtocolTokens(text: string): string {
  return text.replace(new RegExp(COMPLETE_TOKEN, 'gi'), '').replace(/\n{3,}/g, '\n\n').trim()
}

/** Whether the agent signed off with the completion marker (decision #13a). */
export function reportedComplete(text: string): boolean {
  return COMPLETE_TOKEN.test(text)
}

export function repoRelative(path: string): string {
  return path.replace(/^.*?(?:\/|\\)repo(?:\/|\\)/, '')
}

/** Path-shaped runs of a tool line, so a line rewrites without losing its prose. */
const PATH_IN_LINE = /[^\s"'`,)]*[/\\]repo[/\\][^\s"'`,)]*/g

/**
 * A tool line with its sandbox-internal paths rewritten repo-relative
 * (decision #13b) — `/home/agent/cache/slots/1/repo/src/App.tsx` reads as
 * `src/App.tsx`. The container's own layout means nothing to the human reading
 * the lane, and repeated at the head of every path it crowds out the part that
 * does.
 */
export function repoRelativeLine(line: string): string {
  return line.replace(PATH_IN_LINE, repoRelative)
}

// --- how the lanes are grouped and what the feed says about them ------------

/** A ticket as {@link laneBands} orders it. */
export interface LaneBandTicket {
  seq: number
  kind?: string
  passKind?: string
  originFindingId?: string
}

export type LaneBandKind = 'plain' | 'review-fixes' | 'verification'

export interface LaneBand<T> {
  kind: LaneBandKind
  /** Header over the band. Absent on `plain`, which is just the run's tickets. */
  title?: string
  rows: T[]
}

/**
 * The run's lanes in bands (decisions #14b, #42b). A run that fixes its own
 * review findings grows mid-flight: the review lane mints fix tickets and the
 * scheduler appends a verification pass behind them. Rendered flat those arrive
 * as unlabelled extra lanes, so they are banded — the fix wave under the review
 * lane that minted it, the verification pass after the wave it verifies.
 *
 * A fix ticket is one carrying an `originFindingId` emitted AFTER the review
 * lane; a promotion from an earlier lap's triage has the same marker but a lower
 * seq, and belongs with the ordinary lanes it burns alongside.
 */
export function laneBands<T extends LaneBandTicket>(tickets: readonly T[]): LaneBand<T>[] {
  const ordered = [...tickets].sort((a, b) => a.seq - b.seq)
  const review = ordered.filter((t) => t.kind === 'review' && t.passKind !== 'verification').at(-1)
  const verification = ordered.filter((t) => t.kind === 'review' && t.passKind === 'verification')
  const fixes = review ? ordered.filter((t) => t.originFindingId && t.seq > review.seq) : []
  const banded = new Set<T>([...verification, ...fixes])
  const plain = ordered.filter((t) => !banded.has(t))
  // What the pass verifies: the wave it follows, or — after a batch-promote that
  // never ran a review of its own — the implementation tickets that landed.
  const verifying = fixes.length || plain.filter((t) => t.kind !== 'review').length

  const bands: LaneBand<T>[] = []
  if (plain.length > 0) bands.push({ kind: 'plain', rows: plain })
  if (fixes.length > 0) bands.push({ kind: 'review-fixes', title: 'Review fixes', rows: fixes })
  if (verification.length > 0) {
    bands.push({
      kind: 'verification',
      title: `Verifying ${verifying} fixes — recording a fresh walkthrough`,
      rows: verification,
    })
  }
  return bands
}

/** One event as the lane derivations read it. */
interface LaneEvent {
  type: string
  ticketId?: string
  ts: number
}

/** What the feed knows about a lane that the ticket row cannot say. */
export interface LaneFacts {
  /** The agent emitted at least one line — so a failure here is not a launch death. */
  hadOutput: boolean
  /** First event for this lane, which is when its container started coming up. */
  startedAt: number
}

/**
 * Per-lane facts from the run's event feed, in one pass.
 *
 * `hadOutput` is what separates {@link laneState}'s `launch-failed` from an
 * ordinary failure: a sandbox that never started emits its boot narrative
 * (`burn.setup`) and then a git/docker error, and never a single `burn.text` or
 * `burn.tool`. `startedAt` is what the burning lane's elapsed timer counts from.
 */
export function laneFacts(events: readonly LaneEvent[]): Map<string, LaneFacts> {
  const facts = new Map<string, LaneFacts>()
  for (const event of events) {
    if (!event.ticketId) continue
    const known = facts.get(event.ticketId)
    const hadOutput = event.type === 'burn.text' || event.type === 'burn.tool'
    if (!known) facts.set(event.ticketId, { hadOutput, startedAt: event.ts })
    else if (hadOutput) known.hadOutput = true
  }
  return facts
}

/**
 * The seq the header names when this run is one ticket's retry rather than a
 * whole burn (decision #14c) — `retryTicket` resets only its target (plus that
 * target's failed blockers) and burns again, so a solo retry is a run with
 * exactly one lane still to finish beside lanes that already have.
 *
 * The `ticket.retry` event is what distinguishes it from an ordinary burn's
 * last lane: it is emitted by the retry verb and by nothing else.
 */
export function soloRetrySeq(
  tickets: readonly (LaneTicketFigure & { id: string })[],
  events: readonly LaneEvent[],
): number | undefined {
  if (tickets.length < 2) return undefined
  const unfinished = tickets.filter((t) => ['pending', 'burning'].includes(laneState(t)))
  if (unfinished.length !== 1) return undefined
  const retried = events.some(
    (e) => e.type === 'ticket.retry' && e.ticketId === unfinished[0].id,
  )
  return retried ? unfinished[0].seq : undefined
}
