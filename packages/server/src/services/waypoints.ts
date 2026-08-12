import type { WaypointInput } from '@runcastle/core'
import { BlockingEdgeError, Waypoint, newId, resolveBatchBlocking } from '@runcastle/core'
import { and, asc, eq } from 'drizzle-orm'
import type { AppCtx } from '../db/types'
import { waypoints } from '../db/schema'
import { GateError, InvalidInputError, NotFoundError } from '../errors'
import { emit } from './events'

/**
 * Waypoint lifecycle (mapped ideation, ADR-0001 / SPEC §13.2). A waypoint is a
 * node on the feature's map: a question a session claims, works, and resolves.
 *
 * `storeWaypoints` mirrors `storeTickets` (seq assign + in-batch `blockedBy`
 * resolution + cycle rejection via the shared `resolveBatchBlocking`). The
 * frontier — open, unclaimed, all blockers terminal — is DERIVED at query time,
 * never stored; it cascades as blockers resolve or drop. Claim is transactional
 * (double-claim fails); resolve/drop flip status and emit one `waypoint.unblocked`
 * per newly-freed dependent so the UI's frontier updates live.
 */

type WaypointSelect = typeof waypoints.$inferSelect

function rowToWaypoint(row: WaypointSelect): Waypoint {
  return Waypoint.parse({
    id: row.id,
    featureId: row.featureId,
    seq: row.seq,
    title: row.title,
    type: row.type,
    question: row.question,
    blockedBy: row.blockedBy,
    originWaypointId: row.originWaypointId ?? undefined,
    status: row.status,
    claimedBy: row.claimedBy ?? undefined,
    lastSessionId: row.lastSessionId ?? undefined,
    summary: row.summary ?? undefined,
  })
}

const TERMINAL = new Set<Waypoint['status']>(['resolved', 'dropped'])
const isTerminal = (w: Waypoint): boolean => TERMINAL.has(w.status)

export function listByFeature(ctx: AppCtx, featureId: string): Waypoint[] {
  return ctx.db
    .select()
    .from(waypoints)
    .where(eq(waypoints.featureId, featureId))
    .orderBy(asc(waypoints.seq))
    .all()
    .map(rowToWaypoint)
}

export function getWaypoint(ctx: AppCtx, id: string): Waypoint {
  const row = ctx.db.select().from(waypoints).where(eq(waypoints.id, id)).get()
  if (!row) throw new NotFoundError(`waypoint ${id} not found`)
  return rowToWaypoint(row)
}

/**
 * The waypoints currently claimed for a feature (by an HITL session OR an AFK
 * run). The MCP server uses this to find a session's assigned waypoint. NOTE:
 * this is NOT the one-live-session guard — a research run's claim must not block
 * HITL work (ADR-0001 §7 "serial HITL, parallel AFK"), so the launcher guards on
 * live session ROWS (`activeSessionsForFeature`), never on claims.
 */
export function claimedForFeature(ctx: AppCtx, featureId: string): Waypoint[] {
  return listByFeature(ctx, featureId).filter((w) => w.status === 'claimed')
}

/**
 * Store a batch of waypoints for a feature.
 *
 * seq is assigned globally per feature, continuing after existing waypoints.
 * Each input `blockedBy` mixes numeric batch positions (resolved to global seq
 * by the shared utility — which also rejects out-of-range/self/cycle) and string
 * ids of already-stored waypoints (resolved to their seq here). Cross-batch
 * edges can never form a cycle, so in-batch cycle detection is sufficient.
 * Invalid edges surface as `InvalidInputError`.
 */
export function storeWaypoints(
  ctx: AppCtx,
  featureId: string,
  inputs: WaypointInput[],
): Waypoint[] {
  if (inputs.length === 0) return []

  const existing = listByFeature(ctx, featureId)
  const startSeq = existing.reduce((max, w) => Math.max(max, w.seq), 0) + 1
  const seqById = new Map(existing.map((w) => [w.id, w.seq]))

  // Split each node's edges: numbers are in-batch positions (handled by the
  // shared utility); strings are ids of already-stored waypoints.
  const positionEdges = inputs.map((inp) => ({
    blockedBy: inp.blockedBy.filter((b): b is number => typeof b === 'number'),
  }))

  let resolved
  try {
    resolved = resolveBatchBlocking(positionEdges, { startSeq, label: 'waypoint' })
  } catch (e) {
    if (e instanceof BlockingEdgeError) throw new InvalidInputError(e.message)
    throw e
  }

  const rows = inputs.map((inp, i) => {
    const idEdges = inp.blockedBy
      .filter((b): b is string => typeof b === 'string')
      .map((wid) => {
        const seq = seqById.get(wid)
        if (seq === undefined) {
          throw new InvalidInputError(
            `waypoint ${i + 1} blockedBy references unknown waypoint id ${wid}`,
          )
        }
        return seq
      })
    return {
      id: newId('wpt'),
      featureId,
      seq: resolved[i].seq,
      title: inp.title,
      type: inp.type,
      question: inp.question,
      blockedBy: [...resolved[i].blockedBy, ...idEdges],
      originWaypointId: inp.originWaypointId ?? null,
      status: 'open' as const,
      claimedBy: null,
      lastSessionId: null,
      summary: null,
    }
  })

  ctx.db.insert(waypoints).values(rows).run()
  emit(ctx, featureId, {
    type: 'waypoints.stored',
    message: `${rows.length} waypoint(s) stored`,
    data: { count: rows.length, seqs: rows.map((r) => r.seq) },
  })

  return rows.map(rowToWaypoint)
}

/**
 * The frontier: waypoints that are open, unclaimed, and have every blocker in a
 * terminal state (resolved OR dropped — a dropped blocker frees its dependents).
 * Derived on every call — never persisted — so it cascades as blockers resolve.
 * A blocker seq with no matching waypoint is treated as terminal (never blocks).
 */
export function frontier(ctx: AppCtx, featureId: string): Waypoint[] {
  const all = listByFeature(ctx, featureId)
  const bySeq = new Map(all.map((w) => [w.seq, w]))
  return all.filter((w) => isFrontier(w, bySeq))
}

function isFrontier(w: Waypoint, bySeq: Map<number, Waypoint>): boolean {
  if (w.status !== 'open' || w.claimedBy) return false
  return w.blockedBy.every((seq) => {
    const blocker = bySeq.get(seq)
    return !blocker || isTerminal(blocker)
  })
}

/**
 * Claim a frontier waypoint for a session or run. Transactional: the conditional
 * update matches only while the row is still `open`, so a second concurrent
 * claim changes zero rows and throws — double-claim fails. Refuses a waypoint
 * that is not on the frontier (claimed, terminal, or still blocked).
 *
 * `lastSessionId` is deliberately NOT touched here: a claim is only an attempt.
 * It is promoted by `promoteLastSession` once the claiming session actually goes
 * live (session-start hook), so a resume attempt that dies before starting never
 * clobbers the previous good, resumable session id (E2E finding, severity 4).
 * Run claimants (`run_*`) are never promoted — a run is not resumable.
 */
export function claim(ctx: AppCtx, id: string, claimedBy: string): Waypoint {
  const wp = getWaypoint(ctx, id)
  if (wp.status !== 'open') {
    throw new GateError(`waypoint ${wp.seq} is not open (status ${wp.status})`)
  }
  if (!frontier(ctx, wp.featureId).some((f) => f.id === id)) {
    throw new GateError(`waypoint ${wp.seq} is not on the frontier — its blockers are not terminal`)
  }

  ctx.db
    .update(waypoints)
    .set({ status: 'claimed', claimedBy })
    .where(and(eq(waypoints.id, id), eq(waypoints.status, 'open')))
    .run()

  const updated = getWaypoint(ctx, id)
  if (updated.status !== 'claimed' || updated.claimedBy !== claimedBy) {
    throw new GateError(`waypoint ${wp.seq} was claimed by another session`)
  }

  emit(ctx, wp.featureId, {
    type: 'waypoint.claimed',
    message: `waypoint ${wp.seq} claimed`,
    data: { id, claimedBy },
  })
  return updated
}

/**
 * Promote `lastSessionId` on every waypoint claimed by `claimant` — called once
 * the claiming session actually goes LIVE (session-start hook →
 * `markSessionLive`). Only a session that really started is worth resuming, so a
 * failed resume (pty died before the hook) leaves the previous good id in place.
 * Mutation event note: this is part of the session-start mutation; its timeline
 * event (`session.started`) is emitted by the hook receiver, mirroring the
 * `sessions.ts` helpers' no-double-event convention.
 */
export function promoteLastSession(ctx: AppCtx, claimant: string): void {
  ctx.db
    .update(waypoints)
    .set({ lastSessionId: claimant })
    .where(and(eq(waypoints.claimedBy, claimant), eq(waypoints.status, 'claimed')))
    .run()
}

/**
 * Release a claimed waypoint back to `open`, keeping `lastSessionId` so the UI
 * can offer "Resume". Idempotent-ish: releasing an already-open waypoint is a
 * no-op event-free return of its current state.
 */
export function release(ctx: AppCtx, id: string): Waypoint {
  const wp = getWaypoint(ctx, id)
  if (wp.status !== 'claimed') return wp

  ctx.db
    .update(waypoints)
    .set({ status: 'open', claimedBy: null })
    .where(eq(waypoints.id, id))
    .run()

  emit(ctx, wp.featureId, {
    type: 'waypoint.released',
    message: `waypoint ${wp.seq} released (back to open)`,
    // The resumable id is `lastSessionId` (set only when a session went live) —
    // NOT `claimedBy`, which may be a dead-on-arrival session or a run id.
    data: { id, lastSessionId: wp.lastSessionId },
  })
  return getWaypoint(ctx, id)
}

/**
 * Auto-release every waypoint still claimed by an ending session or finalizing
 * run (SPEC §13.2). Closing a waypoint terminal without calling `resolve_waypoint`
 * must return the waypoint to the frontier so it can be re-worked (or resumed). A
 * resolved/dropped waypoint already dropped its `claimedBy`, so it never matches
 * here — only an unresolved claim is released. Idempotent: no claim → no-op, so
 * it is safe to call from every session-end path (hook, End button, PTY exit).
 */
export function releaseForSession(ctx: AppCtx, claimant: string): Waypoint[] {
  const held = ctx.db
    .select()
    .from(waypoints)
    .where(and(eq(waypoints.claimedBy, claimant), eq(waypoints.status, 'claimed')))
    .all()
    .map(rowToWaypoint)
  return held.map((w) => release(ctx, w.id))
}

/**
 * Resolve or drop a waypoint: flip status to terminal, store the one-line
 * summary, and emit `waypoint.resolved` plus one `waypoint.unblocked` per
 * dependent that this resolution just moved onto the frontier (all of its
 * blockers are now terminal). A drop counts as terminal, so it frees dependents
 * exactly like a resolve.
 *
 * Terminal is terminal: re-resolving rewrites a settled summary and re-emits
 * `waypoint.resolved` (plus the unblocked cascade) for work that already
 * finished, so an unknown or already-terminal waypoint is refused rather than
 * applied twice. `getWaypoint` covers unknown.
 */
export function resolve(
  ctx: AppCtx,
  id: string,
  disposition: 'resolved' | 'dropped',
  summary: string,
): Waypoint {
  const wp = getWaypoint(ctx, id)
  if (isTerminal(wp)) {
    throw new InvalidInputError(`waypoint ${wp.seq} is already ${wp.status}`)
  }

  const before = listByFeature(ctx, wp.featureId)
  const bySeqBefore = new Map(before.map((w) => [w.seq, w]))

  ctx.db
    .update(waypoints)
    .set({ status: disposition, summary, claimedBy: null })
    .where(eq(waypoints.id, id))
    .run()

  emit(ctx, wp.featureId, {
    type: 'waypoint.resolved',
    message: `waypoint ${wp.seq} ${disposition}`,
    data: { id, disposition, summary },
  })

  // A dependent is newly freed iff it was blocked before (some blocker
  // non-terminal) and every blocker is terminal now.
  const after = listByFeature(ctx, wp.featureId)
  const bySeqAfter = new Map(after.map((w) => [w.seq, w]))
  const allTerminal = (w: Waypoint, at: Map<number, Waypoint>) =>
    w.blockedBy.every((seq) => {
      const b = at.get(seq)
      return !b || isTerminal(b)
    })

  for (const dep of after) {
    if (dep.status !== 'open' || !dep.blockedBy.includes(wp.seq)) continue
    if (!allTerminal(dep, bySeqBefore) && allTerminal(dep, bySeqAfter)) {
      emit(ctx, wp.featureId, {
        type: 'waypoint.unblocked',
        message: `waypoint ${dep.seq} unblocked`,
        data: { id: dep.id, by: id },
      })
    }
  }

  return getWaypoint(ctx, id)
}
