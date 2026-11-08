import { existsSync } from 'node:fs'
import {
  noPicturesLine,
  orderedFindings,
  packageGroups,
  type Feature,
  type ReviewFinding,
  type ReviewPackage,
  type Ticket,
  type WorkerRow,
  workerFeatureId,
} from '@runcastle/core'
import { reviewShotPath, reviewWalkthroughPath } from '@runcastle/core/paths'
import { and, eq } from 'drizzle-orm'
import { workers } from '../db/schema'
import type { AppCtx } from '../db/types'
import { commitsSince } from './git'
import { listByFeature as listFindings } from './review-findings'
import { readSaw } from './review-saw'
import { listRounds } from './runs'
import { listByIds, listByFeature as listTickets } from './tickets'

/**
 * One review pass, whatever ran it: a Review worker (burns-become-workers
 * decision 3), or a review ticket from before reviews ran as workers. Its
 * pictures, walkthrough and log are kept under its `id` either way.
 */
export interface ReviewPass {
  id: string
  featureId: string
  /** The review ticket's number; null for a Review worker. */
  seq: number | null
  /** The round a review ticket ran in; null for a Review worker and a ticket in none. */
  round: number | null
  passKind: 'review' | 'verification'
  /** Whether the pass could not finish. */
  failed: boolean
  /** The pass's own account: a ticket's digest (or error), a worker's handback summary. */
  account: string | null
  reviewMode: 'drive' | 'gates' | null
  /** The commit the pass reviewed, when it is known. */
  reviewedCommit: string | null
  /** Whether a finding is this pass's. */
  reported: (finding: ReviewFinding) => boolean
}

/** An older review ticket as a pass. */
export function ticketPass(ctx: AppCtx, ticket: Ticket): ReviewPass {
  return {
    id: ticket.id,
    featureId: ticket.featureId,
    seq: ticket.seq,
    round: listRounds(ctx, ticket.featureId).find((round) => round.ticketSeqs.includes(ticket.seq))?.round ?? null,
    passKind: ticket.passKind,
    failed: ticket.status === 'failed',
    account: ticket.digest ?? ticket.error ?? null,
    reviewMode: ticket.reviewMode ?? null,
    reviewedCommit: ticket.reviewedCommit ?? (ticket.reviewGateRun && 'commit' in ticket.reviewGateRun ? ticket.reviewGateRun.commit : null),
    reported: (finding) => finding.reviewTicketId === ticket.id,
  }
}

/** A Review worker as a pass. */
export function workerPass(w: WorkerRow): ReviewPass {
  return {
    id: w.id,
    featureId: workerFeatureId(w),
    seq: null,
    round: null,
    passKind: w.reviewVerify ? 'verification' : 'review',
    failed: w.status === 'failed',
    account: w.handbackSummary ?? w.failure,
    reviewMode: w.reviewMode,
    reviewedCommit: null,
    reported: (finding) => finding.reviewWorkerId === w.id,
  }
}

/** A feature's Review workers, newest first. */
function reviewWorkers(ctx: AppCtx, featureId: string): WorkerRow[] {
  return ctx.db
    .select()
    .from(workers)
    .where(and(eq(workers.featureId, featureId), eq(workers.kind, 'review')))
    .all()
    .sort((a, b) => b.createdAt - a.createdAt)
}

/**
 * A feature's passes that finished, newest first: its Review workers that
 * handed back or failed, then its review tickets that ran. Every Review worker
 * is newer than every review ticket, which stopped being written when reviews
 * became workers.
 */
export function finishedReviewPasses(ctx: AppCtx, featureId: string): ReviewPass[] {
  const fromWorkers = reviewWorkers(ctx, featureId)
    .filter((w) => w.handbackSummary !== null || w.status === 'failed')
    .map(workerPass)
  const fromTickets = listTickets(ctx, featureId)
    .filter((ticket) => ticket.kind === 'review' && (ticket.status === 'done' || ticket.status === 'failed'))
    .sort((a, b) => b.seq - a.seq)
    .map((ticket) => ticketPass(ctx, ticket))
  return [...fromWorkers, ...fromTickets]
}

/** Every pass of a feature that may have kept pictures, newest first, finished or not. */
function allReviewPasses(ctx: AppCtx, featureId: string): ReviewPass[] {
  const fromTickets = listTickets(ctx, featureId)
    .filter((ticket) => ticket.kind === 'review')
    .sort((a, b) => b.seq - a.seq)
    .map((ticket) => ticketPass(ctx, ticket))
  return [...reviewWorkers(ctx, featureId).map(workerPass), ...fromTickets]
}

/** The pass an id names: a Review worker or a review ticket; undefined for anything else. */
export function findReviewPass(ctx: AppCtx, id: string): ReviewPass | undefined {
  const w = ctx.db.select().from(workers).where(eq(workers.id, id)).get()
  if (w) return w.kind === 'review' ? workerPass(w) : undefined
  const [ticket] = listByIds(ctx, [id])
  return ticket?.kind === 'review' ? ticketPass(ctx, ticket) : undefined
}

/** The first line of an account, and the rest: the page leads with one and folds the other. */
function splitAccount(account: string | null | undefined): { verdict: string; account: string } {
  const text = (account ?? '').trim()
  const end = text.indexOf('\n')
  const first = end < 0 ? text : text.slice(0, end)
  return { verdict: first.replace(/^\*\*(.*)\*\*$/, '$1').trim(), account: end < 0 ? '' : text.slice(end).trim() }
}

/** Everything one review pass left. An older pass with no log still has its video and findings. */
export async function reviewPackage(ctx: AppCtx, pass: ReviewPass, feature: Feature, repoPath: string): Promise<ReviewPackage> {
  const groups = packageGroups(pass.id, readSaw(pass.id))
  const pictures = groups.some((group) => group.shots.length > 0)
  const since = pass.reviewedCommit ? await commitsSince(repoPath, pass.reviewedCommit, feature.branch) : undefined
  const { verdict, account } = splitAccount(pass.account)
  return {
    ticketId: pass.id,
    featureId: pass.featureId,
    seq: pass.seq,
    round: pass.round,
    passKind: pass.passKind,
    verdict: verdict || (pass.failed ? 'The review could not finish.' : 'The review left no account.'),
    account,
    commitsSince: since ?? null,
    hasWalkthrough: existsSync(reviewWalkthroughPath(pass.id)),
    groups,
    findings: orderedFindings(listFindings(ctx, pass.featureId).filter(pass.reported)).map(
      ({ id, kind, severity, title, location, citation, detail, reproStep }) => ({
        id,
        kind,
        severity,
        title,
        location,
        citation,
        detail,
        reproStep,
      }),
    ),
    empty: pictures ? null : noPicturesLine(pass.reviewMode, pass.failed),
  }
}

/** A pass's pictures, as an agent reads and can show them. */
export interface ReviewShots {
  /** The review ticket's number; null for a Review worker's pass. */
  seq: number | null
  /** The Review worker that took them; absent for a review ticket's pass. */
  workerId?: string
  passKind: 'review' | 'verification'
  reviewedCommit: string | null
  shots: { path: string; caption: string; scenario?: string }[]
}

/** How many passes an agent is told about: the newest. */
const REVIEW_SHOTS_PASSES = 3

/** Every pass of this feature that took pictures, newest first. */
export function reviewShots(ctx: AppCtx, featureId: string): ReviewShots[] {
  return allReviewPasses(ctx, featureId)
    .flatMap((pass) => {
      const shots = readSaw(pass.id).flatMap((entry) =>
        entry.kind === 'shot'
          ? [{ path: reviewShotPath(pass.id, entry.image), caption: entry.caption, ...(entry.scenario ? { scenario: entry.scenario } : {}) }]
          : [],
      )
      return shots.length > 0
        ? [{ seq: pass.seq, ...(pass.seq === null ? { workerId: pass.id } : {}), passKind: pass.passKind, reviewedCommit: pass.reviewedCommit, shots }]
        : []
    })
    .slice(0, REVIEW_SHOTS_PASSES)
}
