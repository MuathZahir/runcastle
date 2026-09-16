import type { TicketKind } from '@runcastle/core'
import type { FeatureFull } from '../api'
import type { MergeConflictState } from './gates'
import { noun } from './laps'
import { parseMapSections } from './map'
import type { CheckRow, Freshness } from './review'

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
 * The outcome doc's path, or undefined until the merge writes it (decision 32a).
 * Same shape as {@link specDocPath}, and there for the same reason: the shipped
 * hero links the doc and the peek that opens it resolves one `docs.read` key.
 */
export function outcomeDocPath(full: FeatureFull): string | undefined {
  return full.docs.find((d) => d.relPath.endsWith('outcome.md'))?.relPath
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
  /**
   * The red row that tops "what lands" while a merge conflict is standing
   * (decision 29), or null when none is. The loudest thing in the dialog: the
   * walked bug was an all-green summary over a branch that will re-conflict.
   */
  conflictRow: string | null
  /**
   * The figures, in reading order, each one always present — a row that omits
   * itself when it has nothing good to say is how "no review ran" stayed silent
   * (decision 31a).
   */
  rows: CheckRow[]
  /**
   * One sentence per thing the human is shipping over, shown as warnings above
   * the confirm button. Empty when everything checks out.
   */
  warnings: string[]
  /** What the button does, said once at the bottom (decision 31c). */
  next: string
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

/** A ticket as the merge confirmation reads it: whose lap, and how it ended. */
interface MergeTicketFigure {
  kind?: TicketKind
  status: string
  lap: number
}

/**
 * What actually lands (decision 31a). Commits AND files, because the scale a
 * human senses is "nine files changed", not a commit count — and because a
 * branch whose count git could not take must not borrow zero's certainty.
 */
function landsRow(delta: { commits?: number; files?: number } | undefined): CheckRow {
  const key = 'what lands'
  if (delta?.commits === undefined) return { key, value: 'scale unknown', tone: 'warn' }
  const files = delta.files === undefined ? [] : [noun(delta.files, 'file')]
  return {
    key,
    value: [noun(delta.commits, 'commit'), ...files].join(' · '),
    tone: delta.commits > 0 ? 'ok' : 'warn',
  }
}

/**
 * What the burn delivered, never green over set-aside work (decision 31a). A
 * waived ticket (decision 11) is a cancelled one: work the human deliberately
 * stopped, which is exactly what an all-green row used to hide at the last door.
 */
function landedRow(tickets: readonly MergeTicketFigure[]): CheckRow {
  const key = 'run'
  // Review tickets are the pass, not the delivery — counting one as landed work
  // is the same overcount the lap chip stopped making (decision 27a).
  const implementation = tickets.filter((ticket) => ticket.kind !== 'review')
  if (implementation.length === 0) return { key, value: 'no tickets burned', tone: 'warn' }
  const done = implementation.filter((ticket) => ticket.status === 'done').length
  const waived = implementation.filter((ticket) => ticket.status === 'cancelled').length
  const failed = implementation.filter((ticket) => ticket.status === 'failed').length
  const parts = [`${done}/${implementation.length} tickets done`]
  if (waived > 0) parts.push(`${waived} waived`)
  if (failed > 0) parts.push(`${failed} failed`)
  return {
    key,
    value: parts.join(' · '),
    tone: done === implementation.length ? 'ok' : 'warn',
  }
}

/** The unburned fix tickets earlier laps left standing, newest lap first. */
function standingFixTickets(
  tickets: readonly MergeTicketFigure[],
  lap: number,
): { lap: number; count: number }[] {
  const pending = tickets.filter(
    (ticket) => ticket.kind !== 'review' && ticket.status === 'pending' && ticket.lap < lap,
  )
  return [...new Set(pending.map((ticket) => ticket.lap))]
    .sort((a, b) => b - a)
    .map((earlier) => ({ lap: earlier, count: pending.filter((t) => t.lap === earlier).length }))
}

/**
 * The warning the review row earns whenever it is not green (decision 31b) —
 * the row most likely to lie, because the evidence behind it can describe a
 * build that fix tickets have already replaced (decision 19).
 */
function staleEvidenceWarning(stamp: Freshness): string | null {
  switch (stamp.tone) {
    case 'fresh':
      return null
    case 'none':
      return 'No review has run on this branch — nothing was checked for you.'
    case 'verifying':
      return 'A verification pass is still running — this summary predates it.'
    case 'failed':
      return `The review evidence is not fresh: ${stamp.text}.`
    case 'stale':
      return `${stamp.text}.`
  }
}

/**
 * The merge confirmation's summary (findings F21, decisions 29 and 31): what is
 * about to be merged, what the human is shipping over, and — when a conflict is
 * standing — that this merge will fail unless it has been resolved.
 *
 * Merging is the pipeline's most irreversible action and used to fire on a
 * single unconfirmed click; this is the text that click has to be read past.
 * Every row is always present and stamped with its own tone, so the reader never
 * has to notice an absence, and every gap is reported rather than just the first.
 *
 * The conflict comes from the same {@link unresolvedMergeConflict} the next-step
 * bar reads, which is what makes it impossible to read this dialog and not know
 * about a conflict the bar is already shouting about.
 */
export function mergeSummary(input: {
  branch: string
  /** The branch this merges into, as git reported it. */
  base?: string
  /** Commit and file scale over the base (`feature.mergeDelta`). */
  delta?: { commits?: number; files?: number }
  /** The feature's tickets — what landed, what was waived, what still stands. */
  tickets?: readonly MergeTicketFigure[]
  /** The lap the feature is on; earlier laps' pending tickets are the debt. */
  lap?: number
  driveTaken: boolean
  /** Notes captured during the test drive that were never ticked off. */
  openNotes?: number
  /** How fresh the review evidence is — the same stamp the status strip shows. */
  freshness: Freshness
  /** The standing merge conflict, or null when the branch merges cleanly. */
  conflict?: MergeConflictState | null
  /** Scope the spec left for a later lap ({@link deferredScope}). */
  laterLaps?: string | null
  /** A burn is running on this feature right now (decision 7). */
  burning?: boolean
}): MergeSummary {
  const tickets = input.tickets ?? []
  const drive: CheckRow = input.driveTaken
    ? { key: 'test drive', value: 'taken', tone: 'ok' }
    : { key: 'test drive', value: 'never test-driven', tone: 'warn' }
  const review: CheckRow = {
    key: 'review',
    value: input.freshness.text,
    tone: input.freshness.tone === 'fresh' ? 'ok' : 'warn',
  }

  const warnings: string[] = []
  // Merging mid-burn is a warning, never the third hard rule (decision 7): git
  // takes what has landed, and the operator may want exactly those commits.
  // What they cannot see from here is that the agents are still committing.
  if (input.burning) {
    warnings.push(
      'A burn is live — work landing after this merge stays unshipped on the branch.',
    )
  }
  // Informational, never blocking (decisions #7): shipping over findings the
  // human logged and never handled is the moment worth catching, but someone who
  // judged their open notes shippable must not be stopped.
  const open = input.openNotes ?? 0
  if (open > 0) warnings.push(`${noun(open, 'open test-drive note')}.`)
  const waived = tickets.filter((t) => t.kind !== 'review' && t.status === 'cancelled').length
  if (waived > 0) {
    warnings.push(`${noun(waived, 'ticket')} waived — set aside unfinished, not delivered.`)
  }
  // The debt decision 26(d) surfaces at triage, surfaced again at the last door:
  // these tickets exist, have never burned, and merging leaves them behind.
  for (const debt of standingFixTickets(tickets, input.lap ?? 1)) {
    warnings.push(
      `${noun(debt.count, 'unburned fix ticket')} from lap ${debt.lap} — merging leaves them behind.`,
    )
  }
  const stale = staleEvidenceWarning(input.freshness)
  if (stale) warnings.push(stale)
  // The last catch (decisions #7). The bar has already stopped recommending this
  // merge, so anyone reading this line came here deliberately — which is exactly
  // why it quotes the scope rather than just naming it: what was deferred is the
  // thing they have to weigh, and it is not on screen behind this dialog.
  if (input.laterLaps) {
    warnings.push(`The spec still lists deferred scope: ${quoteScope(input.laterLaps)}`)
  }

  return {
    conflictRow: input.conflict
      ? `⚠ A merge conflict is standing (${input.conflict.files.join(', ') || input.conflict.base}) — this merge will fail unless it’s been resolved.`
      : null,
    rows: [landsRow(input.delta), landedRow(tickets), drive, review],
    warnings,
    next: `Merges ${input.branch} into ${input.base ?? 'its base branch'}, writes the outcome doc, and moves the feature to Shipped.`,
  }
}

/** What the burn confirmation shows: the figures, and the server's warnings. */
export interface BurnSummary {
  /** The figures, in reading order — what burns, the lap it stamps, on what. */
  rows: CheckRow[]
  /**
   * One sentence per thing the human is burning over, verbatim from
   * `feature.burnWarnings`. Never re-derived here: the same three sentences
   * reach the ticket-writing session through `complete_phase("tickets")`, and
   * two implementations of one policy is how they would drift apart.
   */
  warnings: readonly string[]
  /** What the button does, said once at the bottom. */
  next: string
}

/** A ticket as the burn confirmation reads it: whose lap, and on which model. */
interface BurnTicketFigure {
  lap: number
  model?: string | null
}

/** The lap a Burn click stamps — derived from the runs, never managed by hand. */
export function burnLap(runs: readonly { workflow: string }[]): number {
  return runs.filter((run) => run.workflow === 'ticket-burner').length + 1
}

/**
 * What burns, on which model. Unassigned tickets burn on the project's own
 * model, so the row names that rather than going quiet — "on what" is the one
 * figure the ledger behind this dialog may have been edited ticket by ticket.
 */
function modelRow(
  tickets: readonly BurnTicketFigure[],
  defaultModel: string | undefined,
): CheckRow {
  const assigned = [...new Set(tickets.map((ticket) => ticket.model?.trim()).filter(Boolean))]
  const unassigned = tickets.some((ticket) => !ticket.model?.trim())
  const fallback = defaultModel || 'the project model'
  const names = [...assigned, ...(unassigned || assigned.length === 0 ? [fallback] : [])]
  return { key: 'model', value: names.join(' · '), tone: 'ok' }
}

/**
 * The burn confirmation's summary (decision 5): what is about to burn, the lap
 * it stamps, and every warning the server computed for it.
 *
 * Deliberately the same grammar as {@link mergeSummary} — figures, then a warn
 * box, then one line saying what the button does — because the operator should
 * learn ONE confirmation pattern. What it never does is disable anything: the
 * friction at Burn is reading, and the only two things that refuse a burn are
 * physics (a run already burning this feature, and git safety).
 */
export function burnSummary(input: {
  branch: string
  /** The non-terminal tickets the burn would run. */
  pendingTickets: readonly BurnTicketFigure[]
  /** The lap this click stamps ({@link burnLap}). */
  lap: number
  /** The project's own model, for tickets that carry no assignment of their own. */
  defaultModel?: string
  /** `feature.burnWarnings`, verbatim; empty while the query is still in flight. */
  warnings?: readonly string[]
}): BurnSummary {
  const tickets = input.pendingTickets
  const carried = tickets.filter((ticket) => ticket.lap !== input.lap).length
  return {
    rows: [
      {
        key: 'what burns',
        value:
          carried > 0
            ? `${noun(tickets.length, 'ticket')} · ${carried} carried from earlier laps`
            : noun(tickets.length, 'ticket'),
        tone: tickets.length > 0 ? 'ok' : 'warn',
      },
      { key: 'lap', value: `lap ${input.lap} — stamped by this click`, tone: 'ok' },
      modelRow(tickets, input.defaultModel),
    ],
    warnings: input.warnings ?? [],
    next: `Burns ${noun(tickets.length, 'ticket')} in parallel sandboxes, each committing to ${input.branch}, and moves the feature to Building.`,
  }
}

/** Why a session's briefing is flagged in the session strip. */
