import { existsSync } from 'node:fs'
import type { Feature, GateCheckId, GateId } from '@runcastle/core'
import { nextPhase } from '@runcastle/core'
import type { AppCtx } from '../db/types'
import { gateOverrides } from '../db/schema'
import { emit } from './events'
import { featureDocPath } from './feature-docs'
import { getFeatureRow, requireProject, setPhase } from './repo'
import { listByFeature } from './tickets'

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

    case 'spec-file-exists':
      // collapsed features skip the spec phase entirely — auto-satisfied.
      if (feature.size === 'collapsed') return { satisfied: true }
      return fileGate(ctx, feature, 'spec.md', 'write the spec (spec.md) before breaking into tickets')

    case 'tickets-approved': {
      // G3: the human Burn click is the approval; the checkable precondition is
      // that there is at least one ticket to burn.
      const count = listByFeature(ctx, feature.id).length
      return count >= 1 ? { satisfied: true } : { satisfied: false, reason: 'no tickets to burn' }
    }

    case 'all-tickets-terminal': {
      const tickets = listByFeature(ctx, feature.id)
      if (tickets.length === 0) return { satisfied: false, reason: 'no tickets have run yet' }
      const open = tickets.filter((t) => t.status !== 'done' && t.status !== 'failed')
      return open.length === 0
        ? { satisfied: true }
        : { satisfied: false, reason: `${open.length} ticket(s) still ${open.map((t) => t.status).join('/')}` }
    }

    case 'human-merge':
      // G5 is the Merge click, which bypasses via its own code path.
      return { satisfied: false, reason: 'use the Merge button to ship' }
  }
}

function fileGate(
  ctx: AppCtx,
  feature: Feature,
  fileName: string,
  reason: string,
): GateResult {
  const project = requireProject(ctx)
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
