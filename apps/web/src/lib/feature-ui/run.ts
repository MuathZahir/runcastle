export interface BurnInterruption {
  runId: string
  landedTickets: number
  pendingTickets: number
}

/** The restart alert applies only until a newer run supersedes the reconciled burn. */
export function burnInterruption(
  events: readonly { type: string; runId?: string | null; data?: unknown }[],
  latestRunId?: string,
): BurnInterruption | undefined {
  if (!latestRunId) return undefined
  const event = [...events]
    .reverse()
    .find((entry) => entry.type === 'run.reconciled' && entry.runId === latestRunId)
  if (!event?.runId || typeof event.data !== 'object' || event.data === null) return undefined
  const { workflow, landedTickets, pendingTickets } = event.data as Record<string, unknown>
  if (
    workflow !== 'ticket-burner' ||
    typeof landedTickets !== 'number' ||
    typeof pendingTickets !== 'number'
  ) return undefined
  return { runId: event.runId, landedTickets, pendingTickets }
}

export interface LaneTicketFigure {
  seq: number
  status: string
  error?: string | null
  hadOutput?: boolean
  orphaned?: boolean
  kind?: string
  reviewFix?: boolean
  /** A review pass's verdict; null on the passes that predate it being recorded. */
  reviewVerdict?: 'verified' | 'unverified' | null
}

export type LaneState = 'pending' | 'burning' | 'done' | 'failed' | 'stopped' | 'launch-failed' | 'waived'

// Both stops read as stopped, not failed: the human's, and the run halt that
// aborts a doomed lane when the account dies mid-burn ("stopped: run halted").
// Either way the lane's commits are preserved and the ticket is retryable.
const stopped = (ticket: LaneTicketFigure) => ticket.error?.toLowerCase().startsWith('stopped') || ticket.orphaned || ticket.error?.toLowerCase().includes('orphaned')
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

/** The project's own ticket history, as `ticket.durationStats` reports it. */
export interface BurnDurationStats {
  medianMs: number
  sampleSize: number
}

/** A median rendered at the coarseness a time expectation is actually read at. */
function coarseDuration(ms: number): string {
  const minutes = ms / 60_000
  if (minutes < 1) return 'under a minute'
  if (minutes < 60) return `~${Math.round(minutes)} min`
  const hours = minutes / 60
  return `~${hours < 10 ? String(Math.round(hours * 10) / 10) : Math.round(hours)}h`
}

/**
 * What the pre-burn bar says a burn is about to cost (decision #16b).
 *
 * The number comes from this project's own finished tickets, never from a
 * constant: a hardcoded "a few minutes" was written once against one machine and
 * one model, and it rots the moment either changes. With no history to quote the
 * copy stays honestly generic rather than inventing a figure.
 */
export function burnExpectation(stats?: BurnDurationStats): string {
  if (!stats || stats.sampleSize === 0 || stats.medianMs <= 0)
    return 'Typically a few minutes per ticket.'
  return `Tickets have been taking ${coarseDuration(stats.medianMs)} each.`
}

/** The burner prompt's completion signal — a marker for the harness, not prose. */
const COMPLETE_TOKEN = /<promise>\s*COMPLETE\s*<\/promise>/i
const COMPLETE_TOKENS = new RegExp(COMPLETE_TOKEN, 'gi')

export function stripProtocolTokens(text: string): string {
  return text.replace(COMPLETE_TOKENS, '').replace(/\n{3,}/g, '\n\n').trim()
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

/** One chunk of the agent stream, as the transcript poll delivers it. */
export interface TranscriptChunkFigure {
  kind: string
  text: string
  name?: string | null
}

/** A transcript line as the lane renders it. */
export type TranscriptBlock =
  | { kind: 'text'; text: string }
  | { kind: 'tool'; name: string; args: string }

/**
 * The agent stream as displayable lines, with decision #13's hygiene applied
 * (a–b).
 *
 * Consecutive raw text chunks merge into one prose block — the stream slices
 * text arbitrarily — while tool calls stay one line each, their sandbox paths
 * rewritten repo-relative and their payload cut to something a lane can show.
 * The burner's completion marker is swallowed and reported as `completed`
 * instead: it is a signal to the harness, not the agent's last words, and a text
 * block that was nothing else disappears with it.
 */
export function transcriptBlocks(chunks: readonly TranscriptChunkFigure[]): {
  blocks: TranscriptBlock[]
  completed: boolean
} {
  const out: TranscriptBlock[] = []
  for (const chunk of chunks) {
    if (chunk.kind === 'tool') {
      out.push({ kind: 'tool', name: chunk.name ?? 'tool', args: toolArgs(chunk.text) })
      continue
    }
    const last = out[out.length - 1]
    if (last && last.kind === 'text') last.text += chunk.text
    else out.push({ kind: 'text', text: chunk.text })
  }
  let completed = false
  const blocks = out
    .map((block) => {
      if (block.kind !== 'text') return block
      if (reportedComplete(block.text)) completed = true
      return { ...block, text: stripProtocolTokens(block.text) }
    })
    .filter((block) => (block.kind === 'text' ? block.text.length > 0 : true))
  return { blocks, completed }
}

/** Collapse a tool-arg payload to one repo-relative displayable line. */
function toolArgs(text: string): string {
  const flat = repoRelativeLine(text.replace(/\s+/g, ' ').trim())
  return flat.length > 300 ? `${flat.slice(0, 300)}…` : flat
}

// --- what the feed says about the lanes ------------------------------------

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
