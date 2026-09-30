import type { FindingStatus, TicketKind } from '@runcastle/core'
import { lapAccountLine } from './laps'
import type { TrailEntry, TrailPass } from './review'

/**
 * A lap's story, top to bottom in the order it happened (decision 5): the work
 * it burned, the review pass, the fixes burned under it, the verification.
 *
 * Derived from ticket order alone — there is no fix kind — so a work ticket is
 * a fix when it was burned after the lap's first pass, i.e. its seq is greater
 * than that pass's seq. Review tickets never appear as ticket rows: each is a
 * pass node, and a pass the feed knows of but the ticket list does not is still
 * a node, so a recording is never unreachable.
 */

/** A ticket as the timeline reads it. */
export interface TimelineTicket {
  id: string
  seq?: number
  title?: string
  lap: number
  kind?: TicketKind
  passKind?: 'review' | 'verification'
  status: string
  digest?: string
  completedAt?: number | null
}

/** A finding as a pass node counts it: which pass reported it, and where it ended. */
export interface TimelineFinding {
  lap: number
  kind: 'defect' | 'observation'
  status: FindingStatus
  fixTicketId?: string | null
  /** The pass that reported it; a finding without one is counted by no pass. */
  reviewTicketId?: string
}

/** Work tickets burned back to back, between two passes (or before the first). */
export interface BurnNode {
  kind: 'burn'
  /** Burned after the lap's first pass — "Burned N fixes". */
  fixes: boolean
  tickets: TimelineTicket[]
}

/** One review or verification pass, as a milestone. */
export interface PassNode {
  kind: 'pass'
  ticketId: string
  seq: number
  passKind: 'review' | 'verification'
  mode: TrailPass['mode']
  verdict: TrailPass['verdict']
  couldNotRun: boolean
  /** Defects this pass reported. */
  found: number
  /** Defects earlier passes of the lap reported that are fixed — what it confirms. */
  fixed: number
  /** The pass's own one-line account, or null when it wrote none. */
  account: string | null
  /** Why an unverified pass verified nothing, when its account does not say it. */
  reason: string | null
  videoUrl: string | null
  /** The checks the server ran on the branch before this pass, or null for none recorded. */
  gateRun: TrailPass['gateRun']
  completedAt: number | null
}

export type TimelineNode = BurnNode | PassNode

/** The first line of a digest, or null when there is none. */
function firstLine(text: string | undefined): string | null {
  const [first] = (text ?? '').trim().split('\n')
  return first?.trim() || null
}

/**
 * A lap's ordered nodes, ascending by seq.
 *
 * An unverified pass states the line runcastle templated into its digest,
 * whole — never the agent's prose (review-as-a-lap-trail d5) — and the lap's
 * declared reason goes on the pass the lap's outcome was read off (its last
 * unverified one). Any other pass carries its digest's opening line, trimmed
 * the way {@link lapAccountLine} trims the lap's.
 */
export function lapTimeline(
  entry: TrailEntry,
  tickets: readonly TimelineTicket[],
  findings: readonly TimelineFinding[] = [],
): TimelineNode[] {
  const lapTickets = tickets.filter((t) => t.lap === entry.lap)
  const byId = new Map(tickets.map((t) => [t.id, t]))
  const defects = findings.filter((f) => f.lap === entry.lap && f.kind === 'defect')
  // The server's rule for "fixed" (`defectState`): the row says so, or the fix
  // ticket it minted landed — the same join the lap's own counts use.
  const isFixed = (d: TimelineFinding): boolean =>
    d.status === 'fixed' || (!!d.fixTicketId && byId.get(d.fixTicketId)?.status === 'done')

  // A review ticket the feed has no row for yet is still a pass.
  const passes: TrailPass[] = [
    ...entry.passes,
    ...lapTickets
      .filter((t) => t.kind === 'review' && !entry.passes.some((p) => p.ticketId === t.id))
      .map((t) => ({
        ticketId: t.id,
        seq: t.seq ?? 0,
        passKind: t.passKind ?? 'review',
        mode: null,
        verdict: null,
        couldNotRun: t.status === 'failed',
        videoUrl: null,
        gateRun: null,
      })),
  ].sort((a, b) => a.seq - b.seq)
  const lastUnverified = passes.findLast((p) => p.verdict === 'unverified')?.ticketId

  const passNode = (pass: TrailPass, i: number): PassNode => {
    const ticket = byId.get(pass.ticketId)
    const earlier = new Set(passes.slice(0, i).map((p) => p.ticketId))
    const outcome = entry.outcome.kind === 'unverified' && pass.ticketId === lastUnverified ? entry.outcome : null
    const account =
      pass.verdict === 'unverified'
        ? (outcome ? outcome.line : firstLine(ticket?.digest))
        : lapAccountLine(ticket?.digest ? { source: 'review', prose: ticket.digest } : null)
    return {
      kind: 'pass',
      ticketId: pass.ticketId,
      seq: pass.seq,
      passKind: pass.passKind,
      mode: pass.mode,
      verdict: pass.verdict,
      couldNotRun: pass.couldNotRun,
      found: defects.filter((d) => d.reviewTicketId === pass.ticketId).length,
      fixed: defects.filter((d) => d.reviewTicketId !== undefined && earlier.has(d.reviewTicketId) && isFixed(d))
        .length,
      account,
      reason: outcome?.reason ?? null,
      videoUrl: pass.videoUrl,
      gateRun: pass.gateRun,
      completedAt: ticket?.completedAt ?? null,
    }
  }

  const work = lapTickets.filter((t) => t.kind !== 'review').sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))
  const firstPassSeq = passes[0]?.seq ?? Infinity
  const nodes: TimelineNode[] = []
  let w = 0
  passes.forEach((pass, i) => {
    const burned: TimelineTicket[] = []
    while (w < work.length && (work[w]!.seq ?? 0) < pass.seq) burned.push(work[w++]!)
    if (burned.length > 0) nodes.push({ kind: 'burn', fixes: pass.seq > firstPassSeq, tickets: burned })
    nodes.push(passNode(pass, i))
  })
  if (w < work.length) nodes.push({ kind: 'burn', fixes: passes.length > 0, tickets: work.slice(w) })
  return nodes
}
