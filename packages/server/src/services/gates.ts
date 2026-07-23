import { existsSync } from 'node:fs'
import type { Feature, GateCheckId, GateId } from '@runcastle/core'
import { nextPhase } from '@runcastle/core'
import type { AppCtx } from '../db/types'
import { gateOverrides } from '../db/schema'
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
      return fileGate(ctx, feature, 'decisions.md', 'run the ideation session to capture decisions first')

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
      return fileGate(ctx, feature, 'spec.md', 'write the spec (spec.md) before breaking into tickets')

    case 'tickets-approved': {
      // G3: the human Burn click is the approval; the checkable precondition is
      // that there is at least one burnable (non-cancelled) ticket.
      const count = listByFeature(ctx, feature.id).filter((t) => t.status !== 'cancelled').length
      return count >= 1 ? { satisfied: true } : { satisfied: false, reason: 'no tickets to burn' }
    }

    case 'all-tickets-terminal': {
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
