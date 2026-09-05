import type { TicketKind } from '@runcastle/core'

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

export interface StatusChip { key: 'review' | 'checks' | 'lap' | 'run'; label: string; tone: CheckTone }
export function statusChips(input: {
  artifact?: Pick<ReviewArtifactFigure, 'lap'> | null
  currentLap: number
  landedSince: number
  tickets: readonly { kind?: TicketKind; status: string; lap?: number; landedLap?: number }[]
  checks: { passed: number; total: number }
  runState: string
  verification?: { state: 'running' | 'failed'; reason?: string }
}): StatusChip[] {
  const stamp = freshness(input.artifact, { landedSince: input.landedSince, lap: input.currentLap }, input.verification)
  const implementation = input.tickets.filter((t) => t.kind !== 'review' && (t.landedLap ?? t.lap) === input.currentLap)
  const landed = implementation.filter((t) => t.status === 'done').length
  const waived = implementation.filter((t) => t.status === 'cancelled').length
  return [
    { key: 'review', label: stamp.text, tone: stamp.tone === 'fresh' ? 'ok' : stamp.tone === 'none' ? 'idle' : 'warn' },
    { key: 'checks', label: `${input.checks.passed}/${input.checks.total} checks passed`, tone: input.checks.total > 0 && input.checks.passed === input.checks.total ? 'ok' : 'warn' },
    { key: 'lap', label: `Lap ${input.currentLap} · ${landed} of ${implementation.length} tickets landed · ${waived} waived`, tone: waived ? 'warn' : 'idle' },
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
 * The line the human reads on arrival at review (decisions #7): "9 defects found
 * · 8 fixed automatically · 1 still open · 3 observations".
 *
 * Every clause is dropped when its count is zero, so a clean lap says "no
 * defects found" and nothing else rather than parading three zeroes. Null when
 * the review reported nothing at all — there is no verdict to render, and a card
 * claiming "no defects found" over a review that never ran is the same green lie
 * the summary row is careful not to tell.
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
  if (summary.observations > 0) {
    parts.push(`${summary.observations} observation${summary.observations === 1 ? '' : 's'}`)
  }
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
  if (finding.openReason === 'verification') return 'found during verification'
  return null
}

/** How much of a note or finding its one-line headline may carry. */
