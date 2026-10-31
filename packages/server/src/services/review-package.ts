import { existsSync } from 'node:fs'
import {
  noPicturesLine,
  orderedFindings,
  packageGroups,
  type Feature,
  type ReviewPackage,
  type Ticket,
} from '@runcastle/core'
import { reviewShotPath, reviewWalkthroughPath } from '@runcastle/core/paths'
import type { AppCtx } from '../db/types'
import { commitsSince } from './git'
import { listByFeature as listFindings } from './review-findings'
import { readSaw } from './review-saw'
import { listRounds } from './runs'
import { listByFeature as listTickets } from './tickets'

/** The first line of a digest, and the rest: the page leads with one and folds the other. */
function splitDigest(digest: string | null | undefined): { verdict: string; account: string } {
  const text = (digest ?? '').trim()
  const end = text.indexOf('\n')
  const first = end < 0 ? text : text.slice(0, end)
  return { verdict: first.replace(/^\*\*(.*)\*\*$/, '$1').trim(), account: end < 0 ? '' : text.slice(end).trim() }
}

/** Everything one review pass left. An older pass with no log still has its video and findings. */
export async function reviewPackage(ctx: AppCtx, ticket: Ticket, feature: Feature, repoPath: string): Promise<ReviewPackage> {
  const groups = packageGroups(ticket.id, readSaw(ticket.id))
  const pictures = groups.some((group) => group.shots.length > 0)
  const failed = ticket.status === 'failed'
  const commit = ticket.reviewedCommit ?? (ticket.reviewGateRun && 'commit' in ticket.reviewGateRun ? ticket.reviewGateRun.commit : null)
  const since = commit ? await commitsSince(repoPath, commit, feature.branch) : undefined
  const { verdict, account } = splitDigest(ticket.digest ?? ticket.error)
  return {
    ticketId: ticket.id,
    featureId: ticket.featureId,
    seq: ticket.seq,
    round: listRounds(ctx, ticket.featureId).find((round) => round.ticketSeqs.includes(ticket.seq))?.round ?? null,
    passKind: ticket.passKind,
    verdict: verdict || (failed ? 'The review could not finish.' : 'The review left no account.'),
    account,
    commitsSince: since ?? null,
    hasWalkthrough: existsSync(reviewWalkthroughPath(ticket.id)),
    groups,
    findings: orderedFindings(listFindings(ctx, ticket.featureId).filter((f) => f.reviewTicketId === ticket.id)).map(
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
    empty: pictures ? null : noPicturesLine(ticket.reviewMode ?? null, failed),
  }
}

/** A pass's pictures, as an agent reads and can show them. */
export interface ReviewShots {
  seq: number
  passKind: 'review' | 'verification'
  reviewedCommit: string | null
  shots: { path: string; caption: string; scenario?: string }[]
}

/** How many passes an agent is told about: the newest. */
const REVIEW_SHOTS_PASSES = 3

/** Every pass of this feature that took pictures, newest first. */
export function reviewShots(ctx: AppCtx, featureId: string): ReviewShots[] {
  return listTickets(ctx, featureId)
    .filter((ticket) => ticket.kind === 'review')
    .sort((a, b) => b.seq - a.seq)
    .flatMap((ticket) => {
      const shots = readSaw(ticket.id).flatMap((entry) =>
        entry.kind === 'shot'
          ? [{ path: reviewShotPath(ticket.id, entry.image), caption: entry.caption, ...(entry.scenario ? { scenario: entry.scenario } : {}) }]
          : [],
      )
      return shots.length > 0 ? [{ seq: ticket.seq, passKind: ticket.passKind, reviewedCommit: ticket.reviewedCommit, shots }] : []
    })
    .slice(0, REVIEW_SHOTS_PASSES)
}
