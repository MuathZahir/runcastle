import { type Feature, startPurposeFor } from '@runcastle/core'
import type { AppCtx } from '../db/types'
import { type LaunchSessionOptions, type LaunchSessionResult, launchSession } from '../launcher/launcher'

/**
 * Launch a started feature's lead as its level says (`autopilot-retires`
 * decisions 4, 5): at "Everything" the interactive opening (read the brief,
 * speak first); below it, the run that plans and builds alone (the `self-plan`
 * purpose). The one start the orchestrator's `start_feature` and a merge's
 * up-next start use; the web's Start makes the same launch itself, after
 * `feature.start` cuts the branch.
 */
export function launchLeadByLevel(
  ctx: AppCtx,
  feature: Pick<Feature, 'id' | 'involvement'>,
  opts: LaunchSessionOptions = {},
): Promise<LaunchSessionResult> {
  const purpose = startPurposeFor(feature.involvement)
  return launchSession(ctx, { featureId: feature.id, kind: 'chat', ...(purpose ? { purpose } : {}) }, opts)
}
