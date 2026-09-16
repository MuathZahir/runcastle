import type { Feature, SessionRow } from '@runcastle/core'
import type { AppCtx } from '../db/types'
import { emit } from './events'
import { isAncestor } from './git'

/** Best-effort probe for whether a resolve-conflict session landed its merge. */
export async function noteResolvedMerge(
  ctx: AppCtx,
  session: SessionRow,
  feature: Feature,
): Promise<void> {
  const pair = session.purpose === 'resolve-conflict' ? session.purposeData : undefined
  if (!pair) return
  try {
    if (!(await isAncestor(session.worktreePath, pair.mergeFrom, pair.mergeInto))) return
    emit(ctx, feature.id, {
      type: 'merge.resolved',
      message: `merge conflict resolved — ${pair.mergeFrom} is in ${pair.mergeInto}`,
      data: { sessionId: session.id, ...pair },
    })
  } catch {
    // Never break session teardown over a timeline probe.
  }
}
