import { AUTOSTART_FAILED, AUTOSTART_SKIPPED, UPNEXT_STARTED } from '@runcastle/core'
import type { Feature } from '@runcastle/core'
import type { AppCtx } from '../db/types'
import { isDatabaseCopy } from './database-copy'
import { dependentsOf, dependsOnOf, waitingOn } from './dependencies'
import { emit } from './events'
import { startDraft } from './features'
import * as leadStart from './lead-start'
import { getFeatureRow } from './repo'

/**
 * After `shipped` has merged: start every up-next dependent whose last unshipped
 * dependency it was, exactly as the human's Start would, from the branch its
 * dependencies merged into, and launch its lead as its level says
 * (`autopilot-retires` decision 5). Best-effort per candidate — a failure or a
 * mixed-base case is an event on the candidate, never a throw, so the merge
 * that triggered this always reports ok; that event wakes the candidate's epic
 * (decision 9). Chains go one step at a time: only direct dependents are
 * considered.
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
      const started = await startDraft(ctx, candidate.id, { baseBranch: distinct[0], autoStartedBy: shipped.slug })
      emit(ctx, shipped.id, {
        type: UPNEXT_STARTED,
        message: `started \`${candidate.slug}\`, which was waiting on this`,
        data: { slug: candidate.slug },
      })
      await launchLead(ctx, started)
    } catch (err) {
      emit(ctx, candidate.id, {
        type: AUTOSTART_FAILED,
        message: `couldn't start by itself: ${err instanceof Error ? err.message : String(err)}`,
        data: { error: err instanceof Error ? err.message : String(err) },
      })
    }
  }
}

/**
 * Launch a dependent's lead once its branch is cut. A launch that fails leaves
 * the feature started with nobody working on it: that is trouble for its epic,
 * so it goes on the candidate as `AUTOSTART_FAILED` (`launch: true`).
 */
async function launchLead(ctx: AppCtx, started: Feature): Promise<void> {
  // A test drive's copied database never starts a conversation nobody asked for
  // (drives-never-touch-real-conversations decision 9).
  if (isDatabaseCopy()) return
  try {
    await leadStart.launchLeadByLevel(ctx, started)
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    emit(ctx, started.id, {
      type: AUTOSTART_FAILED,
      message: `started by itself, but its lead could not launch: ${error}`,
      data: { error, launch: true },
    })
  }
}
