import { existsSync } from 'node:fs'
import type { Feature, GateCheckId, GateId, SessionKind } from '@runcastle/core'
import { nextPhase } from '@runcastle/core'
import { and, desc, eq, inArray } from 'drizzle-orm'
import type { AppCtx } from '../db/types'
import { gateOverrides, sessions } from '../db/schema'
import { emit } from './events'
import { featureDocPath } from './feature-docs'
import { getFeatureRow, projectForFeature, setPhase } from './repo'
import { listByFeature } from './tickets'
import { listByFeature as listWaypoints } from './waypoints'

/**
 * Gate checks (SPEC §1 / §3). Core defines gates as identifiers only; here we
 * implement each `GateCheckId` against real IO (feature docs on disk, ticket
 * state in the db). Gates guide, they don't imprison — `overrideGate` records a
 * reason and advances anyway (CONTEXT.md decision #8).
 */

export interface GateResult {
  satisfied: boolean
  reason?: string
}

export function checkGate(ctx: AppCtx, check: GateCheckId, feature: Feature): GateResult {
  switch (check) {
    case 'decisions-file-exists':
      return docGate(ctx, feature, 'decisions.md', 'run the ideation session to capture decisions first')

    case 'all-waypoints-terminal': {
      // G1 for a mapped feature (ADR-0001 / SPEC §13.1): converge only once
      // every waypoint is terminal (resolved OR dropped). Remaining fog (the
      // map's "Not yet specified" prose) is NOT checked here — it is a soft
      // warning in the UI, shown but never enforced.
      const wps = listWaypoints(ctx, feature.id)
      if (wps.length === 0) {
        return { satisfied: false, reason: 'no waypoints charted yet — chart the map before converging' }
      }
      const open = wps.filter((w) => w.status !== 'resolved' && w.status !== 'dropped')
      return open.length === 0
        ? { satisfied: true }
        : {
            satisfied: false,
            reason: notYetTerminal('waypoint', open.map((w) => w.status), ['open', 'claimed']),
          }
    }

    case 'spec-file-exists':
      return docGate(ctx, feature, 'spec.md', 'write the spec (spec.md) before breaking into tickets')

    case 'tickets-approved': {
      // G3: the human Burn click is the approval; the checkable precondition is
      // that there is at least one burnable (non-cancelled) ticket IN THE
      // CURRENT LAP (SPEC §15.1). Scoping matters from lap 2 on: an earlier
      // lap's tickets are all terminal by construction, so counting them would
      // open G3 for a lap that has emitted nothing to burn.
      const count = listByFeature(ctx, feature.id).filter(
        (t) => t.lap === feature.lap && t.status !== 'cancelled',
      ).length
      return count >= 1 ? { satisfied: true } : { satisfied: false, reason: 'no tickets to burn' }
    }

    case 'all-tickets-terminal': {
      // G4 stays CUMULATIVE, unlike G3 above (ADR-0010 §8): every earlier lap's
      // tickets are terminal by construction, so scoping would buy nothing.
      const tickets = listByFeature(ctx, feature.id)
      if (tickets.length === 0) return { satisfied: false, reason: 'no tickets have run yet' }
      const open = tickets.filter(
        (t) => t.status !== 'done' && t.status !== 'failed' && t.status !== 'cancelled',
      )
      return open.length === 0
        ? { satisfied: true }
        : {
            satisfied: false,
            reason: notYetTerminal('ticket', open.map((t) => t.status), ['pending', 'burning']),
          }
    }

    case 'human-merge':
      // G5 is the Merge click, which bypasses via its own code path.
      return { satisfied: false, reason: 'use the Merge button to ship' }
  }
}

/**
 * Human gate copy for "not everything is terminal yet": aggregated status
 * counts, e.g. `3 waypoints not yet terminal (2 open, 1 claimed)` — never a
 * per-item `open/open/claimed` dump. `order` fixes the breakdown ordering;
 * unknown statuses (future enum growth) are appended rather than dropped.
 */
export function notYetTerminal(
  noun: string,
  statuses: string[],
  order: readonly string[],
): string {
  const counts = new Map<string, number>()
  for (const s of statuses) counts.set(s, (counts.get(s) ?? 0) + 1)
  const ordered = [
    ...order.filter((s) => counts.has(s)),
    ...[...counts.keys()].filter((s) => !order.includes(s)),
  ]
  const breakdown = ordered.map((s) => `${counts.get(s)} ${s}`).join(', ')
  return `${statuses.length} ${statuses.length === 1 ? noun : `${noun}s`} not yet terminal (${breakdown})`
}

function fileGate(
  ctx: AppCtx,
  feature: Feature,
  fileName: string,
  reason: string,
): GateResult {
  const project = projectForFeature(ctx, feature)
  return existsSync(featureDocPath(project, feature, fileName))
    ? { satisfied: true }
    : { satisfied: false, reason }
}

/**
 * The talk kinds that can amend a feature's docs — the ones whose existence on a
 * lap is evidence that lap was actually worked. `qa` is left out: asking a
 * question is not doing the lap's work, and `waypoint` belongs to a mapped
 * feature's own G1.
 */
const DOC_WRITING_KINDS: readonly SessionKind[] = ['ideation', 'revisit', 'converge']

/**
 * G1/G2 — the doc gates, scoped to the CURRENT lap from lap 2 on for the same
 * reason G3 is (SPEC §15.1): lap 1's `decisions.md` and `spec.md` are still on
 * disk, so a file-only check lets a fresh lap cross both gates on the previous
 * lap's artifacts and land at `tickets` with nothing to burn — a silent path that
 * skips the whole lap (findings F4).
 *
 * The lap's own evidence is a doc-writing session STAMPED with the lap (sessions
 * carry their feature's lap at creation). Deliberately not the doc's mtime: every
 * branch checkout rewrites it — a test drive most of all, which is exactly what
 * a lap follows.
 */
function docGate(ctx: AppCtx, feature: Feature, fileName: string, reason: string): GateResult {
  const file = fileGate(ctx, feature, fileName, reason)
  if (!file.satisfied || feature.lap === 1) return file

  const worked = ctx.db
    .select({ id: sessions.id })
    .from(sessions)
    .where(
      and(
        eq(sessions.featureId, feature.id),
        eq(sessions.lap, feature.lap),
        inArray(sessions.kind, [...DOC_WRITING_KINDS]),
      ),
    )
    .all()

  return worked.length > 0
    ? { satisfied: true }
    : {
        satisfied: false,
        reason: `${fileName} is an earlier lap's — no lap ${feature.lap} session has worked this feature yet; open the lap's session before promoting`,
      }
}

/**
 * Override a gate: record the reason (feature history), emit an event, and
 * advance to the next phase. The seatbelt, not the cage.
 */
export function overrideGate(
  ctx: AppCtx,
  featureId: string,
  gate: GateId,
  reason: string,
): Feature {
  const feature = getFeatureRow(ctx, featureId)

  ctx.db.insert(gateOverrides).values({ featureId, gate, reason, ts: Date.now() }).run()

  emit(ctx, featureId, {
    type: 'gate.overridden',
    message: `gate ${gate} overridden: ${reason}`,
    data: { gate, reason },
  })

  const next = nextPhase(feature)
  if (next) return setPhase(ctx, featureId, next, 'phase.advanced', `advanced to ${next} (override)`)
  return feature
}

/**
 * Drop the most recent override of `gate` — for a caller whose crossing did not
 * hold (converge rolls its forced G1 back when the session it forced the gate
 * for could not be opened, findings F5). The `gate.overridden` event stays: the
 * timeline records what was attempted, the table records what stands.
 */
export function undoLastGateOverride(ctx: AppCtx, featureId: string, gate: GateId): void {
  const last = ctx.db
    .select({ id: gateOverrides.id })
    .from(gateOverrides)
    .where(and(eq(gateOverrides.featureId, featureId), eq(gateOverrides.gate, gate)))
    .orderBy(desc(gateOverrides.id))
    .get()
  if (last) ctx.db.delete(gateOverrides).where(eq(gateOverrides.id, last.id)).run()
}
