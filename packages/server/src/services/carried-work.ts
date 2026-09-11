import type { ReviewFinding } from '@runcastle/core'
import { and, eq } from 'drizzle-orm'
import type { AppCtx } from '../db/types'
import { testNotes } from '../db/schema'
import { carriedDefectsAcrossLaps, openDefectsAcrossLaps } from './review-findings'

/**
 * What a lap carries into the next one — the notes the human parked and the
 * defects the review left open.
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
}

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
  }
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
