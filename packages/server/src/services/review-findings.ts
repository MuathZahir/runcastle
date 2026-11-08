import type { ReviewFinding, ReviewFindingInput, Ticket, WorkerRow } from '@runcastle/core'
import { ReviewFinding as ReviewFindingSchema, newId } from '@runcastle/core'
import { asc, eq } from 'drizzle-orm'
import type { AppCtx } from '../db/types'
import { reviewFindings } from '../db/schema'
import { InvalidInputError, NotFoundError } from '../errors'
import { emit } from './events'
import { listByFeature as listTickets } from './tickets'

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

/**
 * How a defect is recognised as one this review already reported: the same
 * problem named in the same place. Detail and repro step are deliberately out
 * of the identity — the review agent writes them fresh on every attempt, so
 * requiring them to match would make every re-report a new defect.
 */
function defectKey(finding: Pick<ReviewFinding, 'title' | 'location'>): string {
  return [finding.title, finding.location].map((part) => part.trim().toLowerCase()).join(' @ ')
}

/** Who reports a finding: a Review worker (burns-become-workers decision 4), or an older review ticket. */
export type FindingReporter = { reviewTicket: Ticket } | { reviewWorker: WorkerRow }

/** The reporter as its finding records it: the column that keys it, its id, and whether it verifies fixes. */
interface ReportingPass {
  column: 'reviewTicketId' | 'reviewWorkerId'
  id: string
  verification: boolean
}

function passOf(reporter: FindingReporter): ReportingPass {
  return 'reviewWorker' in reporter
    ? { column: 'reviewWorkerId', id: reporter.reviewWorker.id, verification: reporter.reviewWorker.reviewVerify !== null }
    : { column: 'reviewTicketId', id: reporter.reviewTicket.id, verification: reporter.reviewTicket.passKind === 'verification' }
}

/**
 * Re-report a defect onto the finding an earlier attempt of the same review
 * already recorded, or `null` when it is new.
 *
 * The case this exists for is a review ticket that was retried: its earlier
 * attempt reported these defects, and a second row for the same defect would
 * hand the lead two findings answering for one problem. The finding is
 * refreshed from the fresh report instead and reopened.
 *
 * A finding that was dismissed is a decision this report has no business
 * overturning.
 */
function refreshEarlierReport(
  ctx: AppCtx,
  args: { featureId: string; pass: ReportingPass; input: ReviewFindingInput },
): ReviewFinding | null {
  const { featureId, pass, input } = args
  const key = defectKey(input)
  const prior = listByFeature(ctx, featureId).find(
    (finding) =>
      finding[pass.column] === pass.id &&
      finding.kind === 'defect' &&
      finding.status !== 'dismissed' &&
      defectKey(finding) === key,
  )
  if (!prior) return null

  ctx.db
    .update(reviewFindings)
    .set({ ...input, reproStep: input.reproStep ?? '' })
    .where(eq(reviewFindings.id, prior.id))
    .run()
  // Through the transition, so the fresh report resets the whole of the
  // finding's mutable state exactly as any other move does.
  return updateStatus(ctx, prior.id, {
    status: 'open',
    openReason: null,
    failureReason: null,
  })
}

/**
 * Record one finding a review agent reported. A defect mints NO fix ticket
 * (`the-feature-lead-runs-rounds` decision 10): it stays an open finding, the
 * round-end wake lists it for the feature's lead, and the lead decides what it
 * becomes — a ticket in a later round, its own fix, or a note to the human.
 * `fixTicket` and `overCap` stay in the reply for the tool's wire shape.
 */
export function reportFinding(
  ctx: AppCtx,
  args: { featureId: string; input: ReviewFindingInput } & FindingReporter,
): { finding: ReviewFinding; fixTicket: Ticket | null; overCap: boolean } {
  const { featureId, input } = args
  const pass = passOf(args)
  const verification = pass.verification

  const refreshed =
    input.kind === 'defect' && !verification
      ? refreshEarlierReport(ctx, { featureId, pass, input })
      : null
  if (refreshed) {
    emit(ctx, featureId, {
      type: 'finding.reported',
      message: `defect re-reported: ${input.title}`,
      data: { findingId: refreshed.id, overCap: false, revived: true },
    })
    return { finding: refreshed, fixTicket: null, overCap: false }
  }

  const id = newId('finding')
  ctx.db
    .insert(reviewFindings)
    .values({
      id,
      featureId,
      [pass.column]: pass.id,
      ...input,
      reproStep: input.reproStep ?? '',
      status: 'open',
      openReason: verification && input.kind === 'defect' ? 'verification' : null,
      failureReason: null,
      fixTicketId: null,
      createdAt: Date.now(),
    })
    .run()

  const finding = getFinding(ctx, id)
  emit(ctx, featureId, {
    type: 'finding.reported',
    message: `${input.kind} reported: ${input.title}`,
    data: { findingId: id, overCap: false },
  })
  return { finding, fixTicket: null, overCap: false }
}

/**
 * A transition writes the WHOLE of a finding's mutable state, not a corner of
 * it: the provenance stamps default back to null on every move, so a finding
 * that leaves `fixed` cannot keep claiming the evidence that put it there.
 */
type StatusPatch = Pick<FindingRow, 'status' | 'openReason' | 'failureReason'> &
  Partial<Pick<FindingRow, 'resolvedBy' | 'resolutionNote'>>

function updateStatus(ctx: AppCtx, findingId: string, patch: StatusPatch): ReviewFinding {
  const current = getFinding(ctx, findingId)
  ctx.db
    .update(reviewFindings)
    .set({ resolvedBy: null, resolutionNote: null, ...patch })
    .where(eq(reviewFindings.id, findingId))
    .run()
  emit(ctx, current.featureId, {
    type: 'finding.updated',
    message: `finding ${findingId} marked ${patch.status}`,
    data: { findingId, status: patch.status, reason: patch.failureReason },
  })
  return getFinding(ctx, findingId)
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
type DefectState = 'fixed' | 'open' | 'fixing' | 'dismissed'

function defectState(finding: ReviewFinding, fixTicket: Ticket | undefined): DefectState {
  if (finding.status === 'dismissed') return 'dismissed'
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
  summary: FindingSummary
}

/**
 * The findings of a feature with their computed summary — the page's read model.
 * Findings accumulate on the feature, and a defect stays open until its fix
 * ticket lands or the agent resolves it, so the summary counts every one.
 */
export function viewByFeature(ctx: AppCtx, featureId: string): FindingsView {
  const findings = listByFeature(ctx, featureId)
  const tickets = listTickets(ctx, featureId)
  const summary: FindingSummary = { found: 0, fixed: 0, open: 0, observations: 0 }
  const openDefects: ReviewFinding[] = []
  for (const finding of findings) {
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
  return { findings, openDefects, summary }
}

/** Every defect this feature still owes an answer for — the open half of {@link viewByFeature}. */
export function openDefects(ctx: AppCtx, featureId: string): ReviewFinding[] {
  return viewByFeature(ctx, featureId).openDefects
}

function fixTicketOf(finding: ReviewFinding, tickets: Ticket[]): Ticket | undefined {
  return finding.fixTicketId ? tickets.find((t) => t.id === finding.fixTicketId) : undefined
}

/**
 * The guard every session-side disposition shares: the finding must be this
 * feature's, and still an open defect.
 */
function requireDispositionable(ctx: AppCtx, featureId: string, findingId: string): ReviewFinding {
  const finding = getFinding(ctx, findingId)
  const eligible =
    finding.featureId === featureId && openDefects(ctx, featureId).some((defect) => defect.id === findingId)
  if (!eligible) {
    throw new InvalidInputError(`finding ${findingId} is not an open defect of this feature`)
  }
  return finding
}

/**
 * Close a defect later work already dealt with. Addressed IS fixed — a status
 * of its own would make every consumer handle two names for one outcome — so
 * the evidence is what distinguishes it: `resolvedBy: 'session'` and the
 * attestation the note carries, which is required for exactly that reason.
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
 * The agent's dismissal of an open defect: not worth fixing, with the reason
 * on the row. The human's own dismissal ({@link dismiss}) needs no reason.
 */
export function dismissAsAgent(
  ctx: AppCtx,
  featureId: string,
  findingId: string,
  note: string,
): ReviewFinding {
  const reason = note.trim()
  if (!reason) throw new InvalidInputError('dismissing a defect requires a note saying why')
  requireDispositionable(ctx, featureId, findingId)
  return updateStatus(ctx, findingId, {
    status: 'dismissed',
    openReason: null,
    failureReason: null,
    resolvedBy: 'session',
    resolutionNote: reason,
  })
}
