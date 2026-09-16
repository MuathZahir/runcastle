import type { FixProgress, ReviewFinding, ReviewFindingInput, Ticket, TicketInput } from '@runcastle/core'
import { ReviewFinding as ReviewFindingSchema, newId } from '@runcastle/core'
import { and, asc, eq, isNotNull } from 'drizzle-orm'
import type { AppCtx } from '../db/types'
import { reviewFindings } from '../db/schema'
import { InvalidInputError, NotFoundError } from '../errors'
import { emit } from './events'
import { getFeatureRow } from './repo'
import { listByFeature as listTickets, storeTickets } from './tickets'

export const AUTO_FIX_CAP = 8
type FindingRow = typeof reviewFindings.$inferSelect

function rowToFinding(row: FindingRow): ReviewFinding {
  return ReviewFindingSchema.parse(row)
}

function getFinding(ctx: AppCtx, id: string): ReviewFinding {
  const row = ctx.db.select().from(reviewFindings).where(eq(reviewFindings.id, id)).get()
  if (!row) throw new NotFoundError(`review finding ${id} not found`)
  return rowToFinding(row)
}

export function listByFeature(ctx: AppCtx, featureId: string): ReviewFinding[] {
  return ctx.db
    .select()
    .from(reviewFindings)
    .where(eq(reviewFindings.featureId, featureId))
    .orderBy(asc(reviewFindings.createdAt), asc(reviewFindings.id))
    .all()
    .map(rowToFinding)
}

export function buildFixTicket(
  finding: Pick<ReviewFinding, 'id' | 'title' | 'location' | 'citation' | 'detail' | 'reproStep'>,
): TicketInput {
  return {
    title: finding.title,
    goal: `Fix: ${finding.title}`,
    context: [
      `Location: ${finding.location}`,
      `Citation: ${finding.citation}`,
      `Detail: ${finding.detail}`,
      `Repro step: ${finding.reproStep}`,
    ].join('\n\n'),
    acceptanceCriteria: [
      `The repro step no longer reproduces / the cited criterion holds: ${finding.reproStep}`,
    ],
    seams: [],
    blockedBy: [],
    kind: 'implementation',
    originFindingId: finding.id,
  }
}

export function reportFinding(
  ctx: AppCtx,
  args: { featureId: string; reviewTicket: Ticket; input: ReviewFindingInput },
): { finding: ReviewFinding; fixTicket: Ticket | null; overCap: boolean } {
  const { featureId, reviewTicket, input } = args
  const feature = getFeatureRow(ctx, featureId)
  const id = newId('finding')
  const ticketCount = ctx.db
    .select({ id: reviewFindings.id })
    .from(reviewFindings)
    .where(
      and(
        eq(reviewFindings.reviewTicketId, reviewTicket.id),
        isNotNull(reviewFindings.fixTicketId),
      ),
    )
    .all().length
  const verification = reviewTicket.passKind === 'verification'
  const overCap = input.kind === 'defect' && !verification && ticketCount >= AUTO_FIX_CAP

  ctx.db
    .insert(reviewFindings)
    .values({
      id,
      featureId,
      lap: feature.lap,
      reviewTicketId: reviewTicket.id,
      ...input,
      reproStep: input.reproStep ?? '',
      status: 'open',
      openReason: verification && input.kind === 'defect' ? 'verification' : overCap ? 'over-cap' : null,
      failureReason: null,
      fixTicketId: null,
      createdAt: Date.now(),
    })
    .run()

  let fixTicket: Ticket | null = null
  if (input.kind === 'defect' && !overCap && !verification) {
    const finding = getFinding(ctx, id)
    fixTicket = storeTickets(ctx, featureId, [
      { ...buildFixTicket(finding), blockedBy: [reviewTicket.seq] },
    ], { blockedByAreGlobal: true })[0]
    ctx.db
      .update(reviewFindings)
      .set({ fixTicketId: fixTicket.id })
      .where(eq(reviewFindings.id, id))
      .run()
  }

  const finding = getFinding(ctx, id)
  emit(ctx, featureId, {
    type: 'finding.reported',
    message: `${input.kind} reported: ${input.title}`,
    ticketId: fixTicket?.id,
    data: { findingId: id, fixTicketId: fixTicket?.id, overCap },
  })
  return { finding, fixTicket, overCap }
}

/**
 * A transition writes the WHOLE of a finding's mutable state, not a corner of
 * it: the carry and provenance stamps default back to null on every move, so a
 * finding that leaves `carried` cannot keep claiming a lap, and one that leaves
 * `fixed` cannot keep claiming the evidence that put it there.
 */
type StatusPatch = Pick<FindingRow, 'status' | 'openReason' | 'failureReason'> &
  Partial<Pick<FindingRow, 'carriedLap' | 'resolvedBy' | 'resolutionNote'>>

function updateStatus(ctx: AppCtx, findingId: string, patch: StatusPatch): ReviewFinding {
  const current = getFinding(ctx, findingId)
  ctx.db
    .update(reviewFindings)
    .set({ carriedLap: null, resolvedBy: null, resolutionNote: null, ...patch })
    .where(eq(reviewFindings.id, findingId))
    .run()
  emit(ctx, current.featureId, {
    type: 'finding.updated',
    message: `finding ${findingId} marked ${patch.status}`,
    data: { findingId, status: patch.status, reason: patch.failureReason },
  })
  return getFinding(ctx, findingId)
}

export function markFixing(ctx: AppCtx, findingId: string): ReviewFinding {
  return updateStatus(ctx, findingId, {
    status: 'fixing',
    openReason: null,
    failureReason: null,
  })
}

export function markFixed(ctx: AppCtx, findingId: string): ReviewFinding {
  return updateStatus(ctx, findingId, {
    status: 'fixed',
    openReason: null,
    failureReason: null,
    resolvedBy: 'fix-ticket',
  })
}

export function markFailed(ctx: AppCtx, findingId: string, reason?: string): ReviewFinding {
  return updateStatus(ctx, findingId, {
    status: 'failed',
    openReason: 'fix-failed',
    failureReason: reason ?? null,
  })
}

/**
 * Drive a finding through its fix ticket's lifecycle. The burn knows a ticket
 * status and a finding id and nothing else about findings, so the mapping from
 * one to the other lives here rather than in the scheduler.
 */
export function markFixProgress(
  ctx: AppCtx,
  findingId: string,
  progress: FixProgress,
  reason?: string,
): ReviewFinding {
  if (progress === 'fixing') return markFixing(ctx, findingId)
  if (progress === 'fixed') return markFixed(ctx, findingId)
  return markFailed(ctx, findingId, reason)
}

export function dismiss(ctx: AppCtx, findingId: string): ReviewFinding {
  return updateStatus(ctx, findingId, {
    status: 'dismissed',
    openReason: null,
    failureReason: null,
  })
}

/**
 * Where a defect stands, read off the finding AND the fix ticket it minted.
 *
 * The join is what makes the counts unable to lie (decisions #9): the finding's
 * own status is written by the burner, so a burner that landed the fix without
 * getting as far as stamping the row would otherwise leave a fixed defect
 * showing as open — and a click on "Fix the open defects" would mint a second
 * ticket for work that is already on the branch. A live ticket (pending or
 * burning) is `fixing` for the same reason: the fix has not been given up on,
 * so it is not the human's problem yet.
 */
type DefectState = 'fixed' | 'open' | 'fixing' | 'dismissed' | 'carried'

function defectState(finding: ReviewFinding, fixTicket: Ticket | undefined): DefectState {
  if (finding.status === 'dismissed') return 'dismissed'
  // Carried outranks the fix-ticket join: a defect is only carriable once its
  // fix attempt has been given up on, so the dead ticket must not drag it back
  // into a state the lap has already answered for.
  if (finding.status === 'carried') return 'carried'
  if (finding.status === 'fixed' || fixTicket?.status === 'done') return 'fixed'
  if (fixTicket && fixTicket.status !== 'failed' && fixTicket.status !== 'cancelled') {
    return 'fixing'
  }
  return finding.status === 'open' || finding.status === 'failed' || fixTicket?.status === 'failed' || fixTicket?.status === 'cancelled'
    ? 'open'
    : 'fixing'
}

/**
 * The counts line the review page leads with (decisions #7): "9 defects found ·
 * 8 fixed automatically · 1 still open · 3 observations". Computed here and
 * never written by an agent, so it cannot disagree with the list beneath it.
 *
 * `found` is every defect the review reported, dismissed ones included — a
 * defect the human waved away was still found.
 */
export interface FindingSummary {
  found: number
  fixed: number
  open: number
  observations: number
}

export interface FindingsView {
  findings: ReviewFinding[]
  /**
   * The rows the page lists — the defects `summary.open` counts, in report order.
   * Sent rather than filtered client-side so the count and the list under it are
   * one derivation: only this side can see the fix tickets they are joined to.
   */
  openDefects: ReviewFinding[]
  /**
   * Everything a lap parked, whatever lap captured or carried it — the review
   * page's own `## Carried, still open` pile. Kept out of the counts and keyed
   * on STATUS rather than a lap number, for the reason `carried-work.ts` spells
   * out: a defect carried into lap 2 and skipped there is still carried at lap
   * 3, so anything asking for "lap 3's carried defects" would lose it.
   */
  carriedFindings: ReviewFinding[]
  summary: FindingSummary
}

/**
 * The findings of a feature with their computed summary — the page's read model.
 *
 * The summary and the open list describe THIS lap's review and nothing else. An
 * all-laps count was the inflated "N still open" that sent the human back to
 * Iterate over defects a later lap had already answered; earlier laps' leftovers
 * reach a lap through {@link openDefectsAcrossLaps} and the carried pile, which
 * are the lap boundary's business rather than the review page's headline.
 */
export function viewByFeature(ctx: AppCtx, featureId: string): FindingsView {
  const feature = getFeatureRow(ctx, featureId)
  const findings = listByFeature(ctx, featureId)
  const tickets = listTickets(ctx, featureId)
  const summary: FindingSummary = { found: 0, fixed: 0, open: 0, observations: 0 }
  const openDefects: ReviewFinding[] = []
  const carriedFindings = findings.filter(isCarried)
  for (const finding of findings) {
    if (finding.lap !== feature.lap) continue
    if (finding.kind === 'observation') {
      summary.observations += 1
      continue
    }
    summary.found += 1
    const state = defectState(finding, fixTicketOf(finding, tickets))
    if (state === 'fixed') summary.fixed += 1
    else if (state === 'open') {
      summary.open += 1
      openDefects.push(finding)
    }
  }
  return { findings, openDefects, carriedFindings, summary }
}

/**
 * Every defect this feature still owes an answer for, on any lap.
 *
 * The same derivation `viewByFeature` counts open from, minus the current-lap
 * narrowing: the carry channel hands a new lap the defects the LAST one left
 * open, and a lap session dispositions defects that are by definition earlier
 * laps'. Both would see nothing at all through the scoped view.
 */
export function openDefectsAcrossLaps(ctx: AppCtx, featureId: string): ReviewFinding[] {
  const tickets = listTickets(ctx, featureId)
  return listByFeature(ctx, featureId).filter(
    (finding) =>
      finding.kind === 'defect' && defectState(finding, fixTicketOf(finding, tickets)) === 'open',
  )
}

function isCarried(finding: ReviewFinding): boolean {
  return finding.status === 'carried'
}

/**
 * Every defect a lap parked, on any lap — the same pile {@link FindingsView}
 * renders as its own section, read on its own for the callers that want the
 * agenda without the rest of the view.
 */
export function carriedDefectsAcrossLaps(ctx: AppCtx, featureId: string): ReviewFinding[] {
  return listByFeature(ctx, featureId).filter(isCarried)
}

/**
 * The defects an earlier lap's review left open that nothing has answered for —
 * the middle of the three Burn warnings (decisions §5).
 *
 * `lapBeingBurned` is the lap the click is ABOUT to start, which the caller
 * knows and this cannot read: the old model bumped the lap on the way OUT of
 * review (`rethink`), so the stored lap was already the new one by the time
 * anything asked; `burn` stamps it after the warnings have been computed, and
 * reading `feature.lap` here compared the review's defects against their own lap
 * and never returned one. "Answered for" is `defectState`'s business — a defect
 * with a live fix ticket, carried, dismissed or fixed is not open and never
 * reaches this filter.
 */
export function undispositionedDefects(
  ctx: AppCtx,
  featureId: string,
  lapBeingBurned: number,
): ReviewFinding[] {
  return openDefectsAcrossLaps(ctx, featureId).filter((finding) => finding.lap < lapBeingBurned)
}

function fixTicketOf(finding: ReviewFinding, tickets: Ticket[]): Ticket | undefined {
  return finding.fixTicketId ? tickets.find((t) => t.id === finding.fixTicketId) : undefined
}

/**
 * The guard every session-side disposition shares (mirroring the one
 * {@link promoteOpenDefects} applies to the human's quick-fix selection): the
 * finding must be this feature's, and either still open on some lap or already
 * carried — carrying parks a defect, it does not freeze it, so a carried one can
 * still be carried on, linked or closed.
 */
function requireDispositionable(ctx: AppCtx, featureId: string, findingId: string): ReviewFinding {
  const finding = getFinding(ctx, findingId)
  const eligible =
    finding.featureId === featureId &&
    (finding.status === 'carried' ||
      openDefectsAcrossLaps(ctx, featureId).some((defect) => defect.id === findingId))
  if (!eligible) {
    throw new InvalidInputError(`finding ${findingId} is not an open or carried defect of this feature`)
  }
  return finding
}

/**
 * Park a defect for a later lap. `carriedLap` is the feature's CURRENT lap —
 * the lap doing the carrying is the one the defect is being carried into, which
 * is what "captured lap 2, carried into lap 3" reads off.
 */
export function carryFinding(
  ctx: AppCtx,
  featureId: string,
  findingId: string,
  note?: string,
): ReviewFinding {
  requireDispositionable(ctx, featureId, findingId)
  return updateStatus(ctx, findingId, {
    status: 'carried',
    openReason: null,
    failureReason: null,
    carriedLap: getFeatureRow(ctx, featureId).lap,
    resolutionNote: note?.trim() || null,
  })
}

/**
 * Close a defect a later lap's work already dealt with. Addressed IS fixed —
 * a status of its own would make every consumer handle two names for one
 * outcome — so the evidence is what distinguishes it: `resolvedBy: 'session'`
 * and the attestation the note carries, which is required for exactly that
 * reason.
 */
export function closeAsAddressed(
  ctx: AppCtx,
  featureId: string,
  findingId: string,
  note: string,
): ReviewFinding {
  const attestation = note.trim()
  if (!attestation) {
    throw new InvalidInputError('closing a defect as addressed requires a note saying what addressed it')
  }
  requireDispositionable(ctx, featureId, findingId)
  return updateStatus(ctx, findingId, {
    status: 'fixed',
    openReason: null,
    failureReason: null,
    resolvedBy: 'session',
    resolutionNote: attestation,
  })
}

/**
 * Vet the finding ids a batch of tickets links to BEFORE anything is stored, so
 * one bad id fails the whole batch rather than leaving half of it linked — the
 * same all-or-nothing the model-id check gives `storeTickets`.
 *
 * Duplicates are refused for the reason {@link promoteOpenDefects} refuses them:
 * a finding holds one `fixTicketId`, so a second ticket naming it would silently
 * overwrite the first link and leave that ticket answering for nothing.
 */
export function requireLinkableFindings(
  ctx: AppCtx,
  featureId: string,
  findingIds: readonly string[],
): void {
  if (new Set(findingIds).size !== findingIds.length) {
    throw new InvalidInputError('two tickets in this batch link to the same finding')
  }
  for (const findingId of findingIds) requireDispositionable(ctx, featureId, findingId)
}

/**
 * Link a defect to the ticket a lap emitted to answer it: stamp the fix ticket
 * and flip the finding to `fixing`. Nothing else happens here — the shipped
 * burner lifecycle (`markFixProgress`) drives the finding to `fixed`/`failed`
 * when that ticket lands, exactly as it does for an in-run fix.
 */
export function linkFixTicket(
  ctx: AppCtx,
  featureId: string,
  findingId: string,
  fixTicketId: string,
): ReviewFinding {
  requireDispositionable(ctx, featureId, findingId)
  ctx.db.update(reviewFindings).set({ fixTicketId }).where(eq(reviewFindings.id, findingId)).run()
  return markFixing(ctx, findingId)
}

/** Return a carried finding to the open pile — the human's verb, never a session's. */
export function reopenFinding(ctx: AppCtx, findingId: string): ReviewFinding {
  const finding = getFinding(ctx, findingId)
  if (finding.status !== 'carried') throw new InvalidInputError('only a carried finding can be reopened')
  return updateStatus(ctx, findingId, { status: 'open', openReason: null, failureReason: null })
}

/**
 * "Fix N open defects" (decisions #7): mint one fix ticket per open defect on
 * the CURRENT lap and flip each finding to `fixing`. The tickets are built by
 * the same mechanical {@link buildFixTicket} the auto-fix path uses — the
 * finding already contains everything a ticket needs (decisions #8) — and carry
 * no `blockedBy`: the review that would have blocked them is long done.
 *
 * Minting only. The burn that runs them is the Fix verb the feature service
 * owns, and the router fires it right after this returns.
 */
export function promoteOpenDefects(
  ctx: AppCtx,
  featureId: string,
  findingIds?: string[],
): { findings: ReviewFinding[]; tickets: Ticket[] } {
  // The scheduler appends the verification pass after this fix-only burn drains (decision 40a).
  const open = viewByFeature(ctx, featureId).openDefects
  const defects = findingIds ? findingIds.map((id) => {
    const finding = open.find((candidate) => candidate.id === id)
    if (!finding) throw new InvalidInputError(`finding ${id} is not an open defect of this feature`)
    return finding
  }) : open
  if (findingIds && new Set(findingIds).size !== findingIds.length) throw new InvalidInputError('duplicate finding selected')
  if (defects.length === 0) throw new InvalidInputError('no open defects to fix')

  const tickets = storeTickets(ctx, featureId, defects.map(buildFixTicket))
  const findings = defects.map((defect, index) => {
    ctx.db
      .update(reviewFindings)
      .set({
        status: 'fixing',
        openReason: null,
        failureReason: null,
        fixTicketId: tickets[index].id,
      })
      .where(eq(reviewFindings.id, defect.id))
      .run()
    return getFinding(ctx, defect.id)
  })

  emit(ctx, featureId, {
    type: 'finding.fixing',
    message: `${findings.length} open defect${findings.length === 1 ? '' : 's'} promoted to fix ticket${
      tickets.length === 1 ? ` ${tickets[0].seq}` : `s ${tickets.map((t) => t.seq).join(', ')}`
    }`,
    data: { findingIds: findings.map((f) => f.id), seqs: tickets.map((t) => t.seq) },
  })
  return { findings, tickets }
}
