import type { FindingResolvedBy, FindingStatus, TicketKind } from '@runcastle/core'
import { unverifiedWarning } from './internal'

export type CheckTone = 'ok' | 'warn' | 'danger' | 'idle'

/** One labelled figure in the review summary / merge confirmation. */
export interface CheckRow {
  /** Row label, as shown ("tickets", "run", "changes", "test drive"). */
  key: string
  /** The figure itself, as shown. */
  value: string
  tone: CheckTone
}

/** A run as the summary reads it — the wire row, narrowed to what it paints. */
export interface RunFigure {
  status: string
  summary?: string | null
}

function ticketRow(tickets: readonly { status: string }[]): CheckRow {
  const total = tickets.length
  const done = tickets.filter((t) => t.status === 'done').length
  const failed = tickets.filter((t) => t.status === 'failed').length
  const value = `${done}/${total} done${failed > 0 ? ` · ${failed} failed` : ''}`
  // 0/0 is grey, not green: no tickets means nothing was verified, which is a
  // different thing from everything having passed.
  const tone: CheckTone =
    failed > 0 ? 'danger' : total === 0 ? 'idle' : done === total ? 'ok' : 'warn'
  return { key: 'tickets', value, tone }
}

export function runRow(run: RunFigure | undefined): CheckRow {
  if (!run) return { key: 'run', value: 'no run recorded', tone: 'idle' }
  const tone: CheckTone =
    run.status === 'succeeded' ? 'ok' : run.status === 'failed' ? 'danger' : 'warn'
  return { key: 'run', value: `${run.status}${run.summary ? ` · ${run.summary}` : ''}`, tone }
}

/**
 * The commits row. `count` comes from git (`feature.commitCount`), not from
 * ticket commit rows — a branch a human or an Iterate session committed to has
 * commits and no ticket rows at all, which is how a branch one commit ahead of
 * main reported "0 commits" in green. `undefined` means git could not tell, and
 * says so rather than borrowing zero's certainty.
 */
export function commitRow(count: number | undefined): CheckRow {
  if (count === undefined) return { key: 'changes', value: 'commit count unknown', tone: 'idle' }
  return {
    key: 'changes',
    value: `${count} commit${count === 1 ? '' : 's'}`,
    tone: count > 0 ? 'ok' : 'warn',
  }
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

export function latestReview<T extends { seq: number; completedAt?: number | null }>(tickets: readonly T[]): T | undefined {
  return [...tickets].sort((a, b) => (a.completedAt ?? -Infinity) - (b.completedAt ?? -Infinity) || a.seq - b.seq).at(-1)
}

/**
 * The pass every evidence surface is stamped against: the latest COMPLETED one
 * (decision 41a). A pass still burning vouches for nothing, and ordering on
 * completion is what makes "latest" mean latest rather than highest-numbered.
 *
 * One implementation, because the review page's stage and the merge dialog's
 * review row must never be stamped against different passes.
 */
export function stampedReview<T extends { seq: number; completedAt?: number | null }>(
  rows: readonly T[],
): T | null {
  return latestReview(rows.filter((row) => row.completedAt !== null)) ?? null
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
 * Lap 1 emits at most one review ticket per feature (spec, "Later laps"), so
 * the last review ticket in the batch is *the* review. If multiplicity ever
 * lands, this is the seam that has to aggregate instead of pick.
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
 * {@link reviewOutcome} picks the last review ticket: lap 1 emits one review per
 * feature, so the last one is *the* review. If multiplicity ever lands, this is
 * the seam that has to show several instead of one.
 */
export function reviewWalkthroughUrl(artifacts?: readonly WalkthroughFigure[]): string | null {
  const rows = (artifacts ?? []).filter((a) => a.hasVideo)
  return latestReview(rows.map((row, index) => ({ ...row, seq: row.seq ?? index })))?.videoUrl ?? null
}

export interface ReviewArtifactFigure {
  ticketId: string
  seq: number
  lap: number
  passKind: 'review' | 'verification'
  reviewedCommit: string | null
  completedAt: number | null
  landedSince: number
  hasVideo: boolean
  videoUrl: string | null
}

export type Freshness = { tone: 'fresh' | 'stale' | 'none' | 'verifying' | 'failed'; text: string }

export function freshness(
  artifact: Pick<ReviewArtifactFigure, 'lap'> | null | undefined,
  branch: { landedSince: number; lap?: number },
  verification?: { state: 'running' | 'failed'; reason?: string },
): Freshness {
  if (verification?.state === 'running') return { tone: 'verifying', text: 'Verification running — evidence below predates it' }
  if (verification?.state === 'failed') {
    const reason = verification.reason?.trim()
    return { tone: 'failed', text: `verification could not run${reason ? `: ${reason}` : ''}` }
  }
  if (!artifact) return { tone: 'none', text: 'no review yet' }
  if (branch.landedSince === 0) return { tone: 'fresh', text: 'Reviewed ✓ · this build' }
  const age = branch.lap !== undefined && branch.lap > artifact.lap
    ? `${branch.lap - artifact.lap} ${branch.lap - artifact.lap === 1 ? 'lap' : 'laps'} ago`
    : 'earlier this lap'
  return { tone: 'stale', text: `Reviewed ${age} · ${branch.landedSince} tickets landed since — evidence may be outdated` }
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

export interface StatusChip {
  key: 'review' | 'checks' | 'unverified' | 'lap' | 'drive' | 'run'
  label: string
  tone: CheckTone
  /** What the chip opens on, where the whole caveat does not fit on one. */
  detail?: string
}
export function statusChips(input: {
  artifact?: Pick<ReviewArtifactFigure, 'lap'> | null
  currentLap: number
  landedSince: number
  tickets: readonly { kind?: TicketKind; status: string; lap?: number; landedLap?: number }[]
  checks: { passed: number; total: number }
  runState: string
  verification?: { state: 'running' | 'failed'; reason?: string }
  /**
   * The lap the branch was last test-driven in, null when it never was, and
   * undefined where the drive is not this strip's to report — the review page
   * has the stage for that, the shipped record has only this (decision 33a).
   */
  driveLap?: number | null
  /**
   * The drive-loop keys a test drive is about to depend on that no dry run has
   * ever proven (decision 8) — the caveat rides beside the Test drive control
   * it is about, as a chip, and only when there is one.
   */
  unverifiedKeys?: readonly string[]
  /** The feature has shipped: the lap chip is a record, not a position. */
  shipped?: boolean
}): StatusChip[] {
  const stamp = freshness(input.artifact, { landedSince: input.landedSince, lap: input.currentLap }, input.verification)
  const unverified = input.unverifiedKeys ?? []
  const implementation = input.tickets.filter((t) => t.kind !== 'review' && (t.landedLap ?? t.lap) === input.currentLap)
  const landed = implementation.filter((t) => t.status === 'done').length
  const waived = implementation.filter((t) => t.status === 'cancelled').length
  const lapLabel = input.shipped
    ? `Shipped after ${input.currentLap} lap${input.currentLap === 1 ? '' : 's'}`
    : `Lap ${input.currentLap} · ${landed} of ${implementation.length} tickets landed · ${waived} waived`
  return [
    { key: 'review', label: stamp.text, tone: stamp.tone === 'fresh' ? 'ok' : stamp.tone === 'none' ? 'idle' : 'warn' },
    { key: 'checks', label: `${input.checks.passed}/${input.checks.total} checks passed`, tone: input.checks.total > 0 && input.checks.passed === input.checks.total ? 'ok' : 'warn' },
    ...(unverified.length === 0
      ? []
      : [
          {
            key: 'unverified' as const,
            label: `${unverified.length} check${unverified.length === 1 ? '' : 's'} unverified in drive`,
            tone: 'warn' as const,
            detail: unverifiedWarning([...unverified]),
          },
        ]),
    { key: 'lap', label: lapLabel, tone: waived ? 'warn' : 'idle' },
    ...(input.driveLap === undefined
      ? []
      : [
          input.driveLap === null
            ? { key: 'drive' as const, label: 'never test-driven', tone: 'warn' as const }
            : { key: 'drive' as const, label: `test drive taken · lap ${input.driveLap}`, tone: 'ok' as const },
        ]),
    { key: 'run', label: input.runState, tone: input.runState === 'succeeded' ? 'ok' : input.runState === 'failed' ? 'danger' : 'warn' },
  ]
}

/** A drive as the review surfaces read it — only whose it is matters here. */
export function reviewRow(outcome: ReviewOutcome): CheckRow | null {
  const key = 'review agent'
  switch (outcome.state) {
    case 'none':
      return null
    case 'waiting':
      return { key, value: `ticket ${outcome.status}`, tone: 'warn' }
    case 'failed':
      return {
        key,
        value: `could not run${outcome.reason ? ` · ${outcome.reason}` : ''}`,
        tone: 'warn',
      }
    case 'ran': {
      const n = outcome.findings
      if (n === undefined) return { key, value: 'ran · findings unknown', tone: 'idle' }
      if (n === 0) return { key, value: 'no findings', tone: 'ok' }
      return { key, value: `${n} finding${n === 1 ? '' : 's'}`, tone: 'warn' }
    }
  }
}

/**
 * The review row when no review ticket ran at all (decisions #9). A review is a
 * constant of the pipeline now — every lap gets one of the two modes, a browser
 * drive when there is a surface to walk and the gates-and-diff read otherwise —
 * so its absence is a fact about THIS lap rather than a feature that never asked
 * for one. Amber for the same reason
 * "never test-driven" is: nothing was checked for the human, and the card that
 * used to omit the row entirely is how "no review happened" stayed silent.
 */
const NO_REVIEW_ROW: CheckRow = {
  key: 'review agent',
  value: 'no review ran this lap',
  tone: 'warn',
}

/** The review SUMMARY card's rows, in the order the card shows them. */
export function reviewChecks(input: {
  tickets?: readonly ReviewTicketFigure[]
  run?: RunFigure
  commitCount?: number
  /** How many findings the review reported ({@link reviewOutcome}). */
  findings?: number
}): CheckRow[] {
  // The agent's report LEADS the card (decisions #7). The human arrives at this
  // screen to read it, and a line appended under the commit count is exactly the
  // "easy to miss" that decision exists to prevent.
  const review = reviewRow(reviewOutcome({ tickets: input.tickets, findings: input.findings }))
  return [
    review ?? NO_REVIEW_ROW,
    ticketRow(input.tickets ?? []),
    runRow(input.run),
    commitRow(input.commitCount),
  ]
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
  lap: number
  status: FindingStatus
  carriedLap: number | null
  resolvedBy: FindingResolvedBy | null
  resolutionNote: string | null
}

export interface FindingStanding {
  /** What became of the defect, in the row's own vocabulary. */
  text: string
  /**
   * What the claim rests on — a lap parked it, a session attested it was
   * addressed, or a fix ticket landed and proved it.
   */
  evidence: 'carried' | 'attested' | 'verified'
  /** The carry's rationale or the attestation's evidence, when there is one. */
  note?: string
}

/**
 * Where a defect that is no longer open ended up, as a statement rather than a
 * control — the finding's half of the line a carried note gets.
 *
 * A session attestation and a landed fix ticket are the SAME status (`fixed`,
 * decisions #2: addressed is fixed), so the row is the only place the difference
 * can still be seen: one was verified by work that landed on the branch, the
 * other is a session's word plus the note it wrote. Nothing to say about a
 * defect still open or being fixed — the rest of the row already says it.
 */
export function findingStanding(finding: FindingStandingFigure): FindingStanding | null {
  const note = finding.resolutionNote?.trim() || undefined
  if (finding.status === 'carried') {
    return {
      text: `captured lap ${finding.lap}, carried into lap ${finding.carriedLap}`,
      evidence: 'carried',
      ...(note ? { note } : {}),
    }
  }
  if (finding.status !== 'fixed') return null
  if (finding.resolvedBy === 'session') {
    return {
      text: 'closed by a lap session as addressed — no fix ticket verified it',
      evidence: 'attested',
      ...(note ? { note } : {}),
    }
  }
  if (finding.resolvedBy === 'fix-ticket') {
    return { text: 'fixed by its fix ticket', evidence: 'verified' }
  }
  return null
}

// --- the lap trail ----------------------------------------------------------

/** One review pass as the trail reads it — the artifacts feed row, narrowed. */
export interface ReviewPassFigure {
  ticketId: string
  seq: number
  lap: number
  passKind: 'review' | 'verification'
  /** What the pass actually ran; null on a pass that recorded no declaration. */
  reviewMode: 'drive' | 'gates' | null
  reviewVerdict: 'verified' | 'unverified' | null
  reviewVerdictReason: string | null
  completedAt: number | null
  videoUrl: string | null
}

/** A ticket as the trail reads it — what the feed cannot say about a pass. */
interface TrailTicketFigure {
  id: string
  lap: number
  kind?: TicketKind
  status: string
  digest?: string
}

/** A finding as the trail counts it — its lap, its kind and where it ended. */
interface TrailFindingFigure {
  lap: number
  kind: 'defect' | 'observation'
  status: FindingStatus
}

/**
 * What a lap's review amounted to, as its trail entry's chip states it.
 *
 * Read off the LATEST COMPLETED pass of the lap, for the same reason every
 * other evidence surface is ({@link stampedReview}): a pass still burning
 * vouches for nothing. `none` covers both a lap no pass has finished in and a
 * pass that predates the verdict columns — neither has a verdict to show, and
 * inventing one is the green lie this feature exists to stop.
 */
export type TrailOutcome =
  | { kind: 'verified'; mode: 'drive' | 'gates' | null }
  /** The templated line runcastle filled, and the reason it does not carry. */
  | { kind: 'unverified'; line: string | null; reason: string | null }
  | { kind: 'could-not-run' }
  | { kind: 'none' }

/** One review pass in a lap's entry, as the compact row renders it. */
export interface TrailPass {
  ticketId: string
  seq: number
  passKind: 'review' | 'verification'
  mode: 'drive' | 'gates' | null
  verdict: 'verified' | 'unverified' | null
  /** The pass never ran at all — its ticket failed (`couldNotReview`). */
  couldNotRun: boolean
  /** Where to stream its recording, or null when it left none. */
  videoUrl: string | null
}

/** One lap in the trail: what burned, how the review went, what it found. */
export interface TrailEntry {
  lap: number
  /** When the lap's latest completed pass finished; null while none has. */
  completedAt: number | null
  outcome: TrailOutcome
  /** Implementation tickets the lap burned — the run view holds the detail. */
  burned: number
  /** Every review pass of the lap, in the order they ran. */
  passes: TrailPass[]
  /** Defects only: observations render in the Full account and nowhere else. */
  defects: { found: number; fixed: number; carried: number }
  /** Test notes taken in the lap. */
  notes: number
}

interface TrailInput {
  passes?: readonly ReviewPassFigure[]
  tickets?: readonly TrailTicketFigure[]
  findings?: readonly TrailFindingFigure[]
  notes?: readonly { lap: number }[]
  currentLap: number
}

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

/**
 * The feature's laps as the trail band renders them — newest first, ALL of
 * them, one entry per lap (decisions 4–5).
 *
 * Newest first and undisclosed, which is the whole point: the popover this
 * replaces hid "lap 2 found six defects, lap 3 verified nothing" behind a
 * click. The current lap is always an entry even before anything has landed in
 * it, so a fresh lap reads as a lap that has not been reviewed yet rather than
 * as a lap that does not exist.
 *
 * A lap can hold several passes — the review, its verification, and any agentic
 * re-reviews — so the entry is the LAP and the passes are rows inside it.
 */
export function lapTrail(input: TrailInput): TrailEntry[] {
  const passes = input.passes ?? []
  const tickets = input.tickets ?? []
  const findings = input.findings ?? []
  const notes = input.notes ?? []
  const laps = [
    ...new Set([
      input.currentLap,
      ...passes.map((p) => p.lap),
      ...tickets.map((t) => t.lap),
      ...findings.map((f) => f.lap),
      ...notes.map((n) => n.lap),
    ]),
  ].sort((a, b) => b - a)

  return laps.map((lap) => {
    const lapPasses = passes.filter((p) => p.lap === lap)
    const stamp = stampedReview(lapPasses)
    const defects = findings.filter((f) => f.lap === lap && f.kind === 'defect')
    return {
      lap,
      completedAt: stamp?.completedAt ?? null,
      outcome: passOutcome(stamp, tickets),
      burned: tickets.filter((t) => t.lap === lap && t.kind !== 'review' && t.status !== 'cancelled')
        .length,
      passes: lapPasses.map((pass) => ({
        ticketId: pass.ticketId,
        seq: pass.seq,
        passKind: pass.passKind,
        mode: pass.reviewMode,
        verdict: pass.reviewVerdict,
        couldNotRun: tickets.find((t) => t.id === pass.ticketId)?.status === 'failed',
        videoUrl: pass.videoUrl,
      })),
      defects: {
        found: defects.length,
        fixed: defects.filter((d) => d.status === 'fixed').length,
        carried: defects.filter((d) => d.status === 'carried').length,
      },
      notes: notes.filter((n) => n.lap === lap).length,
    }
  })
}

/** The unverified half of {@link TrailOutcome}, as the arrival banner reads it. */
export type UnverifiedLap = Extract<TrailOutcome, { kind: 'unverified' }>

/**
 * The CURRENT lap's review verified nothing (decisions 3, 5) — what makes the
 * page arrive loudly and what keeps Merge from being the primary action.
 *
 * Null for every other outcome, including a pass that could not run at all:
 * `couldNotReview` is a pass that never happened, which the page already says
 * elsewhere, and this line is about one that ran and verified nothing.
 */
export function unverifiedLap(input: {
  passes?: readonly ReviewPassFigure[]
  tickets?: readonly TrailTicketFigure[]
  currentLap: number
}): UnverifiedLap | null {
  const lapPasses = (input.passes ?? []).filter((p) => p.lap === input.currentLap)
  const outcome = passOutcome(stampedReview(lapPasses), input.tickets ?? [])
  return outcome.kind === 'unverified' ? outcome : null
}

/** How much of a note or finding its one-line headline may carry. */
