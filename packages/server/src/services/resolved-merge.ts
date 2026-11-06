import { type Feature, type SessionRow, unresolvedMergeConflict } from '@runcastle/core'
import type { AppCtx } from '../db/types'
import { emit, listAfter } from './events'
import { isAncestor } from './git'
import { getProjectById } from './repo'
import { setThreadPurpose } from '../launcher/sessions'
import { sessions } from '../db/schema'
import { and, eq } from 'drizzle-orm'

/**
 * The merge is resolved, so a chat opened to resolve it is done with that
 * errand (`honest-token-counts` decision 12): its purpose clears, its next
 * launch is briefed as the ordinary chat, and what it spends from here is no
 * longer filed under resolve-conflict.
 */
function endConflictErrands(ctx: AppCtx, featureId: string): void {
  const rows = ctx.db
    .select({ id: sessions.id })
    .from(sessions)
    .where(and(eq(sessions.featureId, featureId), eq(sessions.purpose, 'resolve-conflict')))
    .all()
  for (const row of rows) setThreadPurpose(ctx, row.id, null)
}

/** Errands no launch opens any more: a row still carrying one is never on it. */
const RETIRED_ERRANDS: ReadonlySet<string> = new Set(['start-lap', 'relay', 'lead-wake'])

/**
 * A thread still marked with an errand that is over — a retired one, or a
 * merge conflict that no longer stands (resolved before errands ended, or in
 * another checkout) — is the ordinary chat again: its purpose clears before its
 * process starts, so the agent is never handed an errand that is gone
 * (`honest-token-counts` decision 12). Returns the row as it now stands.
 */
export function clearEndedErrand(ctx: AppCtx, row: SessionRow): SessionRow {
  if (!row.purpose) return row
  const over =
    RETIRED_ERRANDS.has(row.purpose) ||
    (row.purpose === 'resolve-conflict' && (!row.featureId || !unresolvedMergeConflict(listAfter(ctx, row.featureId, 0))))
  if (!over) return row
  setThreadPurpose(ctx, row.id, null)
  return { ...row, purpose: undefined, purposeData: undefined }
}

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
    endConflictErrands(ctx, feature.id)
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
    if (!conflict) return
    // A conflict recorded before events carried `base` names none; the branch it
    // failed to merge from was the feature's own base branch.
    const base = conflict.base || feature.baseBranch
    if (!base) return
    const project = getProjectById(ctx, feature.projectId)
    if (!project) return
    if (!(await isAncestor(project.repoPath, base, feature.branch))) return
    emit(ctx, feature.id, {
      type: 'merge.resolved',
      message: `merge conflict resolved — ${base} is in ${feature.branch}`,
      data: { mergeFrom: base, mergeInto: feature.branch },
    })
    endConflictErrands(ctx, feature.id)
  } catch {
    // A timeline probe never breaks the hook or the read that asked it.
  } finally {
    probing.delete(feature.id)
  }
}
