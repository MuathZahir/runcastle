import { type Feature, type SessionRow, unresolvedMergeConflict } from '@runcastle/core'
import type { AppCtx } from '../db/types'
import { emit, listAfter } from './events'
import { isAncestor } from './git'
import { getProjectById } from './repo'

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

/** Features with a probe in flight, so two overlapping reads cannot both emit. */
const probing = new Set<string>()

/**
 * Retire a standing merge conflict the moment git says it is resolved, without
 * waiting for any session to end. One chat per feature means the resolve
 * session is the feature's chat and stays live after it commits the merge, so
 * {@link noteResolvedMerge} at teardown never fires and the conflict card stood
 * over a branch that was already mergeable. Asked when a chat turn ends and when
 * the review state is read: the same "is the base an ancestor of the feature
 * branch" probe, emitting `merge.resolved` once — the event clears the conflict,
 * so the next call finds nothing standing and asks git nothing.
 *
 * Asked of the project's repo, where every branch lives, so it does not matter
 * which checkout the merge was committed in. Never throws.
 */
export async function reconcileStandingConflict(ctx: AppCtx, feature: Feature): Promise<void> {
  if (probing.has(feature.id)) return
  probing.add(feature.id)
  try {
    const conflict = unresolvedMergeConflict(listAfter(ctx, feature.id, 0))
    if (!conflict?.base) return
    const project = getProjectById(ctx, feature.projectId)
    if (!project) return
    if (!(await isAncestor(project.repoPath, conflict.base, feature.branch))) return
    emit(ctx, feature.id, {
      type: 'merge.resolved',
      message: `merge conflict resolved — ${conflict.base} is in ${feature.branch}`,
      data: { mergeFrom: conflict.base, mergeInto: feature.branch },
    })
  } catch {
    // A timeline probe never breaks the hook or the read that asked it.
  } finally {
    probing.delete(feature.id)
  }
}
