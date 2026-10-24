import { AUTOSTART_FAILED, AUTOSTART_SKIPPED, UPNEXT_STARTED } from '@runcastle/core'
import type { Feature } from '@runcastle/core'
import type { AppCtx } from '../db/types'
import { dependentsOf, dependsOnOf, waitingOn } from './dependencies'
import { emit } from './events'
import { startDraft } from './features'
import { getFeatureRow } from './repo'

/**
 * After `shipped` has merged: start every up-next dependent whose last unshipped
 * dependency it was, exactly as the human's Start would (no session, no tokens),
 * from the branch its dependencies merged into. Best-effort per candidate — a
 * failure or a mixed-base case is an event on the candidate, never a throw, so
 * the merge that triggered this always reports ok. Chains go one step at a time:
 * only direct dependents are considered.
 */
export async function startUpNextDependents(ctx: AppCtx, shipped: Feature): Promise<void> {
  const candidates = dependentsOf(ctx, shipped.id)
    .map((d) => getFeatureRow(ctx, d.id))
    .filter((d) => d.status === 'draft' && d.upNext && waitingOn(ctx, d.id).length === 0)

  for (const candidate of candidates) {
    try {
      const bases = dependsOnOf(ctx, candidate.id).map((d) => ({
        slug: d.slug,
        base: getFeatureRow(ctx, d.featureId).baseBranch,
      }))
      const distinct = [...new Set(bases.map((b) => b.base))]
      if (distinct.length !== 1 || !distinct[0]) {
        emit(ctx, candidate.id, {
          type: AUTOSTART_SKIPPED,
          message: `didn't start by itself: its dependencies merged into different branches (${bases
            .map((b) => `${b.slug} → ${b.base ?? 'unknown'}`)
            .join(', ')}) — pick a base and Start`,
          data: { bases },
        })
        continue
      }
      await startDraft(ctx, candidate.id, { baseBranch: distinct[0], autoStartedBy: shipped.slug })
      emit(ctx, shipped.id, {
        type: UPNEXT_STARTED,
        message: `started \`${candidate.slug}\`, which was waiting on this`,
        data: { slug: candidate.slug },
      })
    } catch (err) {
      emit(ctx, candidate.id, {
        type: AUTOSTART_FAILED,
        message: `couldn't start by itself: ${err instanceof Error ? err.message : String(err)}`,
        data: { error: err instanceof Error ? err.message : String(err) },
      })
    }
  }
}
