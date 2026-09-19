import { join } from 'node:path'
import type { ReviewFinding, TicketStatus } from '@runcastle/core'
import { reviewDir } from '@runcastle/core/paths'
import { and, eq } from 'drizzle-orm'
import type { AppCtx } from '../db/types'
import { testNotes } from '../db/schema'
import { getFeatureRow } from './repo'
import { carriedDefectsAcrossLaps, openDefectsAcrossLaps } from './review-findings'
import { listByFeature as listTickets } from './tickets'

/**
 * What a lap carries into the next one — the notes the human parked, the defects
 * the review left open, and where that review left its evidence on disk.
 *
 * This is the carry CHANNEL, read-only and computed on demand: the lap's
 * kickoff line, its injected system prompt and `get_feature_context` all state
 * the same work, from one query rather than three guesses. Nothing here mutates,
 * so nothing here emits; carrying itself is `carryNotes`' job and already emits.
 *
 * Everything is keyed on STATUS, never on a lap number. A note carried into lap
 * 2 and then skipped there keeps `carriedLap: 2` while the feature moves to lap
 * 3, so anything that asked for "the notes carried into lap 3" would lose it
 * permanently — which is exactly how the previous pointers ("the `## Lap N-1`
 * section") lost skipped notes.
 */
export interface CarriedWork {
  /** Notes carried and not yet done, whatever lap captured or carried them. */
  carriedNotes: number
  /** The defects this feature's review left open, as the next lap meets them. */
  openDefects: CarriedDefect[]
  /**
   * The defects a lap has already parked — this lap's agenda rather than its
   * obligation (decisions #5). They are out of {@link carriedWorkSummary}'s
   * counts for exactly that reason: a lap may link or close one, and none is
   * forced to re-carry what an earlier one parked.
   */
  carriedDefects: CarriedDefect[]
  /**
   * Where the previous lap's review passes left their evidence on disk — the
   * third thing a lap carries, beside the notes and the defects.
   */
  reviewEvidence: ReviewEvidence[]
}

/**
 * One review pass's evidence, as PATHS rather than content.
 *
 * A review agent works in host scratch space outside the repo
 * ({@link reviewDir}), and `get_feature_context` strips every ticket's `digest`
 * out of its payload — so a lap session that is not handed these paths has no
 * channel to the review at all. That was the gap: a lap planned from the human's
 * summary of a build whose own review nobody had read, which is how one lap
 * answered "did you test the app?" with "No, I moved too quickly to Burn".
 *
 * Nothing here is stat'ed. The paths are stated and the session reads what is
 * there, the same contract the notes and `## Later laps` pointers already have.
 */
export interface ReviewEvidence {
  /** The review ticket whose pass produced it — {@link reviewDir} is keyed by this. */
  ticketId: string
  /** The ticket's seq, which is how the human and the cards refer to it. */
  seq: number
  /** How the pass itself ended — the review OUTCOME, `done` or `failed`. */
  status: TicketStatus
  reviewMode: 'drive' | 'gates' | null
  reviewVerdict: 'verified' | 'unverified' | null
  reviewVerdictReason: string | null
  /** The lap the pass ran on: the lap before the one reading this. */
  lap: number
  /** `~/.runcastle/reviews/<ticketId>/` — screenshots and `walkthrough.webm`. */
  dir: string
  /** `<dir>/DIGEST.md` — the review agent's own account of what it found. */
  digestPath: string
}

/** A review pass that got far enough to leave something behind. */
const BURNED_REVIEW: readonly TicketStatus[] = ['done', 'failed']

/**
 * A defect in the fields a session needs to act on it — the same four
 * `buildFixTicket` serialises onto a fix ticket, minus the citation, which
 * points at the criterion the review argued from rather than at the problem,
 * plus the id every disposition verb names it by.
 */
export interface CarriedDefect {
  /** What a ticket's `originFindingId` and `resolve_finding`'s `findingId` take. */
  id: string
  title: string
  location: string
  detail: string
  reproStep: string
}

export function carriedWork(ctx: AppCtx, featureId: string): CarriedWork {
  // `carried` is a terminal status of its own: a carried note cannot be toggled
  // done (`toggleNote` refuses it) and only `reopenNote` moves it back to open,
  // so "carried and not done" is precisely this one predicate.
  const carried = ctx.db
    .select({ id: testNotes.id })
    .from(testNotes)
    .where(and(eq(testNotes.featureId, featureId), eq(testNotes.status, 'carried')))
    .all()

  return {
    carriedNotes: carried.length,
    // Across laps, for the same reason the note query is keyed on status: the
    // defects a lap has to answer for are the ones EARLIER laps left open, and
    // the review page's own view is scoped to the current lap.
    openDefects: openDefectsAcrossLaps(ctx, featureId).map(toCarriedDefect),
    carriedDefects: carriedDefectsAcrossLaps(ctx, featureId).map(toCarriedDefect),
    reviewEvidence: previousLapReviewEvidence(ctx, featureId),
  }
}

/**
 * The review passes of the lap BEFORE this one, as paths a session can read.
 *
 * Scoped to that one lap on purpose: an older lap's evidence is two builds
 * stale, so naming it would point a session at screenshots of a UI that has
 * since changed. What the CURRENT lap's own review left behind is a different
 * question, asked by a different reader — see {@link currentLapReviewEvidence}.
 * A pass still `pending` or `burning` wrote no digest, and a `cancelled` one
 * never ran; only {@link BURNED_REVIEW} left evidence behind.
 */
function previousLapReviewEvidence(ctx: AppCtx, featureId: string): ReviewEvidence[] {
  const { lap } = getFeatureRow(ctx, featureId)
  if (lap <= 1) return []
  return lapReviewEvidence(ctx, featureId, lap - 1)
}

/**
 * The review passes of the lap the feature is ON, which is what a conversation
 * held in the review state is looking at: the burn has run, the review agent has
 * left its digest, and the chat is being asked about that pass (decisions.md
 * #7). The carry channel above cannot answer it — carrying is what happens to a
 * lap once the NEXT one starts.
 */
export function currentLapReviewEvidence(ctx: AppCtx, featureId: string): ReviewEvidence[] {
  return lapReviewEvidence(ctx, featureId, getFeatureRow(ctx, featureId).lap)
}

function lapReviewEvidence(ctx: AppCtx, featureId: string, lap: number): ReviewEvidence[] {
  return listTickets(ctx, featureId)
    .filter(
      (ticket) =>
        ticket.kind === 'review' && ticket.lap === lap && BURNED_REVIEW.includes(ticket.status),
    )
    .map((ticket) => {
      const dir = reviewDir(ticket.id)
      return {
        ticketId: ticket.id,
        seq: ticket.seq,
        status: ticket.status,
        reviewMode: ticket.reviewMode ?? null,
        reviewVerdict: ticket.reviewVerdict ?? null,
        reviewVerdictReason: ticket.reviewVerdictReason ?? null,
        lap: ticket.lap,
        dir,
        digestPath: join(dir, 'DIGEST.md'),
      }
    })
}

function toCarriedDefect(defect: ReviewFinding): CarriedDefect {
  return {
    id: defect.id,
    title: defect.title,
    location: defect.location,
    detail: defect.detail,
    reproStep: defect.reproStep,
  }
}

/** True when this lap has anything to hand the next one. */
export function hasCarriedWork(carried: CarriedWork | undefined): carried is CarriedWork {
  return carried !== undefined && (carried.carriedNotes > 0 || carried.openDefects.length > 0)
}

/**
 * The one sentence the kickoff line and the system prompt both open with —
 * counts and nothing else, so the session is told what it is here for before it
 * is told where to read it. `undefined` when there is nothing carried.
 *
 * It names no source lap. Carried notes accumulate across laps (see
 * {@link CarriedWork}), so "from lap 2's review" would be false for any note
 * lap 2 skipped.
 */
export function carriedWorkSummary(carried: CarriedWork | undefined): string | undefined {
  if (!hasCarriedWork(carried)) return undefined
  const parts: string[] = []
  if (carried.carriedNotes > 0) {
    parts.push(`${carried.carriedNotes} note${carried.carriedNotes === 1 ? '' : 's'} carried`)
  }
  const defects = carried.openDefects.length
  if (defects > 0) parts.push(`${defects} defect${defects === 1 ? '' : 's'} open`)
  return `${parts.join(' and ')} from earlier laps`
}

/**
 * The clause a lap's kickoff line carries about the previous lap's review
 * evidence — the paths, and the instruction to read them before planning.
 * `undefined` when there is none (lap 1, or a review pass that never burned),
 * which is the one case a lap may plan from the interview alone.
 *
 * One sentence, no newline: the kickoff is typed into a PTY as a single line.
 */
export function reviewEvidenceSentence(carried: CarriedWork | undefined): string | undefined {
  const evidence = carried?.reviewEvidence ?? []
  const first = evidence[0]
  if (!first) return undefined
  const where = evidence
    .map(
      (one) =>
        `ticket ${one.seq} (pass ${one.status}) wrote ${one.digestPath}, and its screenshots ` +
        `and walkthrough.webm sit beside it in ${one.dir}` +
        (one.reviewVerdict === 'unverified'
          ? `; nothing verified: ${one.reviewVerdictReason ?? 'no reason recorded'}`
          : ''),
    )
    .join('; ')
  return (
    `BEFORE you plan anything, read lap ${first.lap}'s review evidence — ${where}. That ` +
    "DIGEST.md is the review agent's own account of the build I drove. "
  )
}
