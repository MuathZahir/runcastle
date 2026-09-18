import { existsSync } from 'node:fs'
import type { Feature, PlanningArtifactFacts, PlanningStep } from '@runcastle/core'
import type { AppCtx } from '../db/types'
import { listByTypeThisLap } from './events'
import { featureDocPath } from './feature-docs'
import { projectForFeature } from './repo'
import { pendingTickets } from './tickets'

/**
 * Where a feature is up to INSIDE Planning, read back off its artifacts.
 *
 * Planning's three steps — ideation, spec, tickets — are derived, never stored
 * (decisions §2): there is no `step` column, because a stored one would rebuild
 * the mini-pipeline the four-state collapse exists to remove, and the artifacts
 * already carry the answer. The pure model lives in core
 * (`completedPlanningSteps` / `nextPlanningStep`); this is the IO half that
 * looks the facts up.
 */

/**
 * The timeline stamp a session leaves when it reports a planning step complete.
 *
 * Kept as the type `complete_phase` has always emitted: the tool's wire shape is
 * deliberately unchanged, and renaming the event would orphan every stamp
 * already on a timeline for a milestone that still means exactly what it did.
 */
export const PLANNING_STEP_EVENT = 'phase.complete_requested'

/**
 * Is one of a planning step's docs on disk? (`feature-docs` owns WHERE that is:
 * the talk worktree when it has been cut, the main checkout otherwise.)
 */
export function hasPlanningDoc(ctx: AppCtx, feature: Feature, fileName: string): boolean {
  return existsSync(featureDocPath(projectForFeature(ctx, feature), feature, fileName))
}

/**
 * The artifact facts Planning's progress is derived from.
 *
 * `hasTickets` asks for tickets a burn would still RUN rather than for any row
 * at all: on lap 2 the previous lap's tickets are all terminal, so "any ticket
 * ever stored" would report the step done for a lap that has emitted nothing.
 * The docs are not lap-scoped in the same way — an earlier lap's `spec.md` is
 * still this feature's spec (decisions §2 reads the file, nothing more).
 */
export function planningFacts(ctx: AppCtx, feature: Feature): PlanningArtifactFacts {
  return {
    hasDecisions: hasPlanningDoc(ctx, feature, 'decisions.md'),
    hasSpec: hasPlanningDoc(ctx, feature, 'spec.md'),
    hasTickets: pendingTickets(ctx, feature.id).length > 0,
  }
}

/**
 * Has a session already reported this step complete on the feature's CURRENT
 * lap?
 *
 * The one question the artifacts cannot answer. A step's artifact is on disk by
 * the time the session reports it — that is what reporting means — so artifact
 * presence would read every first call as a repeat. The timeline stamp is the
 * honest record of the report itself, and it is lap-scoped, so the same step
 * reported on the next lap is fresh work rather than a repeat.
 */
export function planningStepReported(ctx: AppCtx, feature: Feature, step: PlanningStep): boolean {
  return listByTypeThisLap(ctx, feature.id, PLANNING_STEP_EVENT).some(
    (event) => (event.data as { phase?: string } | null)?.phase === step,
  )
}
