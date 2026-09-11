import type { AppCtx } from '../db/types'
import { emitProject } from './events'
import { isOverwritable, recordFinding } from './findings'

/**
 * The two writes that make a built project image the project's own: adopting the
 * tag into the `sandboxImage` column, and giving it back when the Dockerfile
 * behind it is gone (feature `project-owned-sandbox-image`, decisions 6 and 8).
 *
 * The image *mechanics* — hashing, inspecting, planning and spawning a build —
 * live in `sandbox-image.ts` and touch neither the database nor the event bus.
 * This module is the stateful half, so the doctor can reason about images
 * without importing a persistence dependency graph it never uses (decision 10).
 * Both functions consult {@link isOverwritable} first: a tag the human typed is
 * theirs, and runcastle neither writes over it nor clears it.
 */

/**
 * Adopt a freshly built project image as the project's `sandboxImage`. Written
 * on a successful build and never at detect time (decision 6): the five image
 * consumers must never resolve to a tag no image answers to. A tag the human
 * typed is left exactly as it is — the build did not clobber their image, and it
 * does not clobber their setting either. Returns whether the column was written.
 */
export function adoptProjectImage(ctx: AppCtx, projectId: string, tag: string): boolean {
  if (!isOverwritable(ctx, projectId, 'sandboxImage')) return false
  recordFinding(ctx, projectId, {
    key: 'sandboxImage',
    value: tag,
    source: 'build',
    evidence: `Built from .runcastle/sandbox/Dockerfile as ${tag}.`,
  })
  emitProject(ctx, projectId, {
    type: 'settings.updated',
    message: `sandboxImage set to ${tag} by the image build`,
    data: { key: 'sandboxImage', scope: 'project', value: tag },
  })
  return true
}

/**
 * The mirror of {@link adoptProjectImage}: drop a project image runcastle wrote
 * once its `.runcastle/sandbox/Dockerfile` is gone (decision 8), so resolution
 * falls back to the global image or the stock default on the next burn.
 * Runcastle wrote the value on build, so removing it when its justification
 * disappears is symmetric — and a doctor warning asking the human to clear it
 * by hand would nag about something with exactly one sensible resolution. A tag
 * the human typed is theirs, and is left alone. Returns whether it cleared.
 */
export function releaseProjectImage(ctx: AppCtx, projectId: string): boolean {
  if (!isOverwritable(ctx, projectId, 'sandboxImage')) return false
  recordFinding(ctx, projectId, { key: 'sandboxImage', value: null, source: 'build' })
  emitProject(ctx, projectId, {
    type: 'settings.updated',
    message: 'sandboxImage cleared — .runcastle/sandbox/Dockerfile is gone',
    data: { key: 'sandboxImage', scope: 'project', value: null },
  })
  return true
}
