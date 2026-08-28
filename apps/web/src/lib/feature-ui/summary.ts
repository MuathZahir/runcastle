import type { FeatureFull } from '../api'
import { parseMapSections } from './map'
import {
  commitRow,
  reviewRow,
  runRow,
  type CheckRow,
  type ReviewOutcome,
  type RunFigure,
} from './review'

const HEADLINE_MAX = 80

/**
 * A block of text split into the line a list row shows and the rest, which the
 * row hides behind a disclosure (decisions #4).
 *
 * This is what stops the notes panel being a wall — for the human's own notes as
 * much as for anything an agent wrote. The cut prefers the text's own first
 * line, then a word boundary, so a headline never ends mid-word; `rest` is empty
 * when the whole thing already fits, and the row renders plain text.
 */
export function headline(text: string): { head: string; rest: string } {
  const trimmed = text.trim()
  const firstBreak = trimmed.indexOf('\n')
  const firstLine = firstBreak === -1 ? trimmed : trimmed.slice(0, firstBreak)
  if (firstLine.length <= HEADLINE_MAX) {
    return { head: firstLine, rest: trimmed.slice(firstLine.length).trim() }
  }
  const lastSpace = firstLine.lastIndexOf(' ', HEADLINE_MAX)
  const cut = lastSpace > HEADLINE_MAX / 2 ? lastSpace : HEADLINE_MAX
  return { head: `${firstLine.slice(0, cut).trimEnd()}…`, rest: trimmed.slice(cut).trim() }
}

/**
 * The spec's path, or undefined until it is written. Same shape as {@link
 * mapDocPath} and for the same reason: the review body's Planned-next-lap card
 * and the next-step bar both read the spec, and one implementation is what makes
 * them resolve the SAME `docs.read` query key and share a single fetch.
 */
export function specDocPath(full: FeatureFull): string | undefined {
  return full.docs.find((d) => d.relPath.endsWith('spec.md'))?.relPath
}

/**
 * The scope this feature's spec has deliberately left for a later lap — the body
 * of its `## Later laps` section, verbatim — or null when the spec lists none.
 *
 * This is the fact the review page never knew (decisions #7): a spec written as
 * a thin lap 1 reached review, and with nothing on screen aware of the planned
 * lap 2, the human shipped half a feature by clicking the main button. Null is
 * the ordinary case and means review behaves exactly as it always has.
 */
export function deferredScope(specContent?: string): string | null {
  if (!specContent) return null
  return parseMapSections(specContent)['Later laps']?.trim() || null
}

/** What the merge confirmation shows: the figures, and every gap in them. */
export interface MergeSummary {
  rows: CheckRow[]
  /**
   * One sentence per missing or unhappy figure, shown as warnings above the
   * confirm button. Empty when everything checks out.
   */
  warnings: string[]
}

/** How much of the deferred scope a one-line warning can carry. */
const SCOPE_QUOTE_MAX = 180

/**
 * A spec section as a warning line: its markdown flattened to one line, cut to
 * something a dialog can hold. Verbatim belongs to the Planned-next-lap card,
 * which has the room for it; this is the catch, and a catch has to be readable
 * at a glance.
 */
function quoteScope(scope: string): string {
  const flat = scope.replace(/\s+/g, ' ').trim()
  return flat.length > SCOPE_QUOTE_MAX ? `${flat.slice(0, SCOPE_QUOTE_MAX).trimEnd()}…` : flat
}

/**
 * The merge confirmation's summary (findings F21): what is about to be merged,
 * and what is missing from that picture. Merging is the pipeline's most
 * irreversible action and fired on a single unconfirmed click — this is the text
 * that click now has to be read past.
 *
 * Every gap is reported, not just the first: "no commits" and "never
 * test-driven" are two different reasons to stop, and the human deserves both
 * before deciding.
 */
export function mergeSummary(input: {
  commitCount?: number
  run?: RunFigure
  driveTaken: boolean
  /** Notes captured during the test drive that were never ticked off. */
  openNotes?: number
  /** What the review agent made of this branch, when the caller knows. */
  review?: ReviewOutcome
  /** Scope the spec left for a later lap ({@link deferredScope}). */
  laterLaps?: string | null
}): MergeSummary {
  const drive: CheckRow = input.driveTaken
    ? { key: 'test drive', value: 'taken', tone: 'ok' }
    : { key: 'test drive', value: 'never test-driven', tone: 'warn' }

  // Unlike the review card, this dialog says so when no review ticket ran: it
  // reports every gap in the picture it is painting ("no run recorded", "commit
  // count unknown"), and an unreviewed branch is one of them. Advisory only —
  // it is a row, not a warning, because most branches will never have asked for
  // a review and nagging every merge is not what decisions #7 asked for.
  const reviewLine: CheckRow | null = input.review
    ? (reviewRow(input.review) ?? {
        key: 'review agent',
        value: 'no review ticket',
        tone: 'idle',
      })
    : null

  const warnings: string[] = []
  if (input.commitCount === undefined) {
    // Covers both "git could not tell" and "the count has not arrived yet" —
    // either way the honest line is that this dialog cannot vouch for it.
    warnings.push('The commit count for this branch is unknown — check it before merging.')
  } else if (input.commitCount === 0) {
    warnings.push('This branch carries no commits — merging it changes nothing.')
  }
  if (!input.run) warnings.push('No run was recorded — no burn has run on this branch.')
  else if (input.run.status !== 'succeeded') {
    warnings.push(`The last run ${input.run.status} rather than succeeding.`)
  }
  if (!input.driveTaken) warnings.push('This branch was never test-driven.')
  // A review that could not run is a gap in this picture, same family as "never
  // test-driven": nothing was verified for the human, and they should know that
  // before clicking. Findings themselves get no warning — the open-notes line
  // below already counts the ones still outstanding, agent-written included.
  if (input.review?.state === 'failed') {
    const reason = input.review.reason
    warnings.push(`The review agent could not run${reason ? `: ${reason}` : ''}.`)
  }
  // Informational, never blocking (decisions #7): shipping over findings the
  // human logged and never handled is the moment worth catching, but someone who
  // judged their open notes shippable must not be stopped.
  const open = input.openNotes ?? 0
  if (open > 0) warnings.push(`${open} open test-drive note${open === 1 ? '' : 's'}.`)
  // The last catch (decisions #7). The bar has already stopped recommending this
  // merge, so anyone reading this line came here deliberately — which is exactly
  // why it quotes the scope rather than just naming it: what was deferred is the
  // thing they have to weigh, and it is not on screen behind this dialog.
  if (input.laterLaps) {
    warnings.push(`The spec still lists deferred scope: ${quoteScope(input.laterLaps)}`)
  }

  return {
    rows: [
      commitRow(input.commitCount),
      runRow(input.run),
      drive,
      ...(reviewLine ? [reviewLine] : []),
    ],
    warnings,
  }
}

/** Why a session's briefing is flagged in the session strip. */
