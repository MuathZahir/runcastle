import type { FindingResolvedBy, FindingStatus, TicketKind } from '@runcastle/core'
import type { ReviewGateRunWire } from '../reviews'

export type CheckTone = 'ok' | 'warn' | 'danger' | 'idle'

/** One labelled figure in the review summary / merge confirmation. */
export interface CheckRow {
  /** Row label, as shown ("tickets", "run", "changes", "test drive"). */
  key: string
  /** The figure itself, as shown. */
  value: string
  tone: CheckTone
}

/** A ticket as the review surfaces read it — the wire row, narrowed. */
interface ReviewTicketFigure {
  kind?: TicketKind
  status: string
  error?: string
  seq?: number
  completedAt?: number | null
  passKind?: 'review' | 'verification'
}

export function latestReview<T extends { seq: number | null; completedAt?: number | null }>(tickets: readonly T[]): T | undefined {
  return [...tickets].sort((a, b) => (a.completedAt ?? -Infinity) - (b.completedAt ?? -Infinity) || (a.seq ?? Infinity) - (b.seq ?? Infinity)).at(-1)
}

/**
 * The pass every evidence surface is stamped against: the latest COMPLETED one
 * (decision 41a). A pass still burning vouches for nothing, and ordering on
 * completion is what makes "latest" mean latest rather than highest-numbered.
 *
 * One implementation, because the review page's stage and the merge dialog's
 * review row must never be stamped against different passes.
 *
 * A pass that finished before `completed_at` existed carries no stamp, so its
 * own ticket says it finished instead — without that, a page whose timeline
 * shows the pass would read "Not reviewed yet" above it. Having no time, it
 * ranks below every stamped pass.
 */
export function stampedReview<T extends { ticketId: string; seq: number | null; completedAt?: number | null }>(
  rows: readonly T[],
  tickets: readonly { id: string; status: string }[],
): T | null {
  const finished = (row: T): boolean => {
    if (row.completedAt !== null) return true
    const status = tickets.find((t) => t.id === row.ticketId)?.status
    return status === 'done' || status === 'failed'
  }
  return latestReview(rows.filter(finished)) ?? null
}

/**
 * What the review agent's pass amounted to (decisions #7). The human's review
 * now starts from the agent's report, so every review surface has to be able to
 * say what that report was — including that there wasn't one.
 */
export type ReviewOutcome =
  /** No review ticket was emitted — today's status quo, and not a fault. */
  | { state: 'none' }
  /** The review ran to completion. Findings are not failure (decisions #6). */
  | { state: 'ran'; findings?: number }
  /** The review could not run; `reason` is whatever the ticket recorded. */
  | { state: 'failed'; reason?: string }
  /** A review ticket exists but has not finished — a burn still in flight. */
  | { state: 'waiting'; status: string }

/**
 * The review agent's outcome, read off the feature's tickets and its findings.
 *
 * Findings are counted from the `review_findings` rows rather than asked of the
 * ticket, because those rows ARE the deliverable: a review that reported four
 * things found four things. All of them count, whatever became of them — a
 * defect that has since been fixed or dismissed was still a finding.
 * `undefined` means the count has not arrived, which reports as unknown rather
 * than as 0: a clean bill of health is a claim, not a default, and this row used
 * to make that claim off a notes list the review no longer writes to.
 *
 * The last review ticket is *the* review: a later pass supersedes an earlier
 * one. If several ever need showing at once, this is the seam that has to
 * aggregate instead of pick.
 */
export function reviewOutcome(input: {
  tickets?: readonly ReviewTicketFigure[]
  /**
   * How many findings the review reported (defects and observations both), or
   * undefined while the findings query is still in flight.
   */
  findings?: number
}): ReviewOutcome {
  const candidates = (input.tickets ?? []).filter((t) => t.kind === 'review')
  const review = latestReview(candidates.map((ticket, index) => ({ ...ticket, seq: ticket.seq ?? index })))
  if (!review) return { state: 'none' }
  if (review.status === 'failed') {
    return { state: 'failed', ...(review.error ? { reason: review.error } : {}) }
  }
  if (review.status !== 'done') return { state: 'waiting', status: review.status }
  return { state: 'ran', ...(input.findings === undefined ? {} : { findings: input.findings }) }
}

/** One review ticket's artifacts as the player reads them (see lib/reviews.ts). */
interface WalkthroughFigure {
  ticketId?: string
  seq?: number
  completedAt?: number | null
  hasVideo: boolean
  /** Where to stream the recording, or null when there is none to stream. */
  videoUrl: string | null
}

/**
 * Where the walkthrough to play comes from, or null when this feature's reviews
 * left no recording — which is a normal state, not a fault (decisions #8): a
 * backend review that ran tests and curled endpoints records nothing, and a
 * browser review whose recorder failed still delivered its notes. Null is the
 * signal to render no video UI at all rather than an empty frame.
 *
 * Picks the LAST review with a recording, for exactly the reason
 * {@link reviewOutcome} picks the last review ticket: the last one is *the*
 * review. If several ever need showing, this is the seam that has to show
 * several instead of one.
 */
export function reviewWalkthroughUrl(artifacts?: readonly WalkthroughFigure[]): string | null {
  const rows = (artifacts ?? []).filter((a) => a.hasVideo)
  return latestReview(rows.map((row, index) => ({ ...row, seq: row.seq ?? index })))?.videoUrl ?? null
}

export interface ReviewArtifactFigure {
  ticketId: string
  seq: number
  passKind: 'review' | 'verification'
  reviewedCommit: string | null
  completedAt: number | null
  landedSince: number
  hasVideo: boolean
  videoUrl: string | null
  /** The server's gate run for this pass; null or absent when none was recorded. */
  gateRun?: ReviewGateRunWire | null
}

export type Freshness = { tone: 'fresh' | 'stale' | 'none' | 'verifying' | 'failed'; text: string }

export function freshness(
  artifact: object | null | undefined,
  branch: { landedSince: number },
  verification?: { state: 'running' | 'failed'; reason?: string },
): Freshness {
  if (verification?.state === 'running') return { tone: 'verifying', text: 'Verification running — evidence below predates it' }
  if (verification?.state === 'failed') {
    const reason = verification.reason?.trim()
    return { tone: 'failed', text: `verification could not run${reason ? `: ${reason}` : ''}` }
  }
  if (!artifact) return { tone: 'none', text: 'no review yet' }
  if (branch.landedSince === 0) return { tone: 'fresh', text: 'Reviewed ✓ · this build' }
  return { tone: 'stale', text: `Reviewed earlier · ${branch.landedSince} tickets landed since — evidence may be outdated` }
}

/** A ticket as the verification stamp reads it. */
interface VerificationTicketFigure {
  kind?: TicketKind
  passKind?: 'review' | 'verification'
  status: string
  error?: string
}

/**
 * Whether a verification pass is in flight or failed to run (decision 42b–c) —
 * what turns the review chip amber over evidence the pass already predates.
 *
 * A FINISHED pass is not a state here: its recording and its findings ARE the
 * evidence the page is stamped against, so {@link freshness} takes over from
 * that point and there is nothing left to report.
 */
export function verificationState(
  tickets: readonly VerificationTicketFigure[],
): { state: 'running' | 'failed'; reason?: string } | undefined {
  const last = tickets.filter((t) => t.kind === 'review' && t.passKind === 'verification').at(-1)
  if (!last) return undefined
  if (last.status === 'failed') {
    return { state: 'failed', ...(last.error ? { reason: last.error } : {}) }
  }
  if (last.status === 'done' || last.status === 'cancelled') return undefined
  return { state: 'running' }
}

/** One implementation ticket's own account, as the fallback block lists it. */
export interface FindingCounts {
  found: number
  fixed: number
  open: number
  observations: number
}

/**
 * What the lap did to its findings, in one line (decisions #7): "9 defects found
 * · 8 fixed automatically · 1 still open".
 *
 * The review page renders it where the digest's own one-liner would be
 * (decision 8), so it is what a lap whose review wrote no digest says for
 * itself. Every clause is dropped when its count is zero, so a clean lap says
 * "no defects found" and nothing else rather than parading two zeroes. Null when
 * the review reported nothing at all — there is no verdict to render, and a line
 * claiming "no defects found" over a review that never ran is the same green lie
 * the summary row is careful not to tell.
 *
 * Observations are counted here and NOT said (decision 2): a lap that saw only
 * observations still had a review, so they keep the line alive — but naming them
 * on arrival is the noise this feature demoted them out of.
 */
export function findingCountsLine(summary?: FindingCounts): string | null {
  if (!summary || summary.found + summary.observations === 0) return null
  const parts = [
    summary.found === 0
      ? 'no defects found'
      : `${summary.found} defect${summary.found === 1 ? '' : 's'} found`,
  ]
  if (summary.fixed > 0) parts.push(`${summary.fixed} fixed automatically`)
  if (summary.open > 0) parts.push(`${summary.open} still open`)
  return parts.join(' · ')
}

/** A finding as the open-defects list reads it — only why it is still open. */
interface OpenFindingFigure {
  openReason?: 'over-cap' | 'fix-failed' | 'verification' | null
  failureReason?: string | null
}

/**
 * Why a defect is still the human's problem, in one line (decisions #7). A
 * defect with no reason recorded is one the burn never reached, so there is
 * nothing honest to say about it and the row shows its title alone.
 */
export function findingOpenReason(finding: OpenFindingFigure): string | null {
  if (finding.openReason === 'over-cap') return 'over the auto-fix cap'
  if (finding.openReason === 'fix-failed') {
    const why = finding.failureReason?.trim()
    return why ? `fix failed: ${why}` : 'fix failed'
  }
  if (finding.openReason === 'verification') {
    return 'found by the verification pass — not auto-fixed'
  }
  return null
}

/** A finding as its standing line reads it — where it went, and on whose word. */
interface FindingStandingFigure {
  status: FindingStatus
  resolvedBy: FindingResolvedBy | null
  resolutionNote: string | null
}

export interface FindingStanding {
  /** What became of the defect, in the row's own vocabulary. */
  text: string
  /**
   * What the claim rests on — a session attested it was addressed, or a fix
   * ticket landed and proved it.
   */
  evidence: 'attested' | 'verified'
  /** The attestation's evidence, when there is one. */
  note?: string
}

/**
 * Where a defect that is no longer open ended up, as a statement rather than a
 * control.
 *
 * A session attestation and a landed fix ticket are the SAME status (`fixed`,
 * decisions #2: addressed is fixed), so the row is the only place the difference
 * can still be seen: one was verified by work that landed on the branch, the
 * other is a session's word plus the note it wrote. Nothing to say about a
 * defect still open or being fixed — the rest of the row already says it.
 */
export function findingStanding(finding: FindingStandingFigure): FindingStanding | null {
  const note = finding.resolutionNote?.trim() || undefined
  if (finding.status !== 'fixed') return null
  if (finding.resolvedBy === 'session') {
    return {
      text: 'closed in a chat as addressed — no fix ticket verified it',
      evidence: 'attested',
      ...(note ? { note } : {}),
    }
  }
  if (finding.resolvedBy === 'fix-ticket') {
    return { text: 'fixed by its fix ticket', evidence: 'verified' }
  }
  return null
}

// --- review passes -------------------------------------------------------------

/** One review pass as the trail reads it — the artifacts feed row, narrowed. */
export interface ReviewPassFigure {
  ticketId: string
  /** The review ticket's number; null for a Review worker's pass. */
  seq: number | null
  passKind: 'review' | 'verification'
  /** What the pass actually ran; null on a pass that recorded no declaration. */
  reviewMode: 'drive' | 'gates' | null
  reviewVerdict: 'verified' | 'unverified' | null
  reviewVerdictReason: string | null
  completedAt: number | null
  videoUrl: string | null
  /** The server's gate run for this pass; null or absent when none was recorded. */
  gateRun?: ReviewGateRunWire | null
}

/** A ticket as the trail reads it — what the feed cannot say about a pass. */
interface TrailTicketFigure {
  id: string
  kind?: TicketKind
  status: string
  digest?: string
}

/**
 * What a review amounted to, as its trail entry's chip states it.
 *
 * Read off the LATEST COMPLETED pass, for the same reason every other
 * evidence surface is ({@link stampedReview}): a pass still burning vouches
 * for nothing. `none` covers both a feature no pass has finished on and a
 * pass that predates the verdict columns — neither has a verdict to show, and
 * inventing one is the green lie this feature exists to stop.
 */
export type TrailOutcome =
  | { kind: 'verified'; mode: 'drive' | 'gates' | null }
  /** The templated line runcastle filled, and the reason it does not carry. */
  | { kind: 'unverified'; line: string | null; reason: string | null }
  | { kind: 'could-not-run' }
  | { kind: 'none' }

/** The first line of an agent-or-runcastle digest, or null when there is none. */
function firstLine(text: string | undefined): string | null {
  const [first] = (text ?? '').trim().split('\n')
  return first?.trim() || null
}

/**
 * What one pass amounted to. The verdict columns are the pass's own word; the
 * ticket beside them says whether it ran at all, which is a different fact and
 * the one the feed has no column for.
 *
 * An unverified pass states the line runcastle composed into its digest — never
 * the agent's prose (decision 5) — and the declared reason under it, dropped
 * when the template already carries it.
 */
function passOutcome(
  pass: ReviewPassFigure | null,
  tickets: readonly TrailTicketFigure[],
): TrailOutcome {
  if (!pass) return { kind: 'none' }
  const ticket = tickets.find((t) => t.id === pass.ticketId)
  if (ticket?.status === 'failed') return { kind: 'could-not-run' }
  if (pass.reviewVerdict === 'verified') return { kind: 'verified', mode: pass.reviewMode }
  if (pass.reviewVerdict === 'unverified') {
    const line = firstLine(ticket?.digest)
    const reason = pass.reviewVerdictReason?.trim() || null
    return { kind: 'unverified', line, reason: line && reason && line.includes(reason) ? null : reason }
  }
  return { kind: 'none' }
}

/** The unverified half of {@link TrailOutcome}, as the arrival banner reads it. */
export type UnverifiedReview = Extract<TrailOutcome, { kind: 'unverified' }>

/**
 * The latest review verified nothing (decisions 3, 5) — what makes the page
 * arrive loudly and what keeps Merge from being the primary action.
 *
 * Null for every other outcome, including a pass that could not run at all:
 * `couldNotReview` is a pass that never happened, which the page already says
 * elsewhere, and this line is about one that ran and verified nothing.
 */
export function unverifiedReview(input: {
  passes?: readonly ReviewPassFigure[]
  tickets?: readonly TrailTicketFigure[]
}): UnverifiedReview | null {
  const outcome = stampedOutcome(input)
  return outcome.kind === 'unverified' ? outcome : null
}

/**
 * What the pass the page is stamped against amounted to — the latest completed
 * one, the same pass {@link freshness} ages. The Review row states
 * it beside that age, so the verdict and the freshness describe ONE pass.
 */
export function stampedOutcome(input: {
  passes?: readonly ReviewPassFigure[]
  tickets?: readonly TrailTicketFigure[]
}): TrailOutcome {
  const tickets = input.tickets ?? []
  return passOutcome(stampedReview(input.passes ?? [], tickets), tickets)
}

/** How much of a note or finding its one-line headline may carry. */
