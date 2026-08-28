import { resolveBurnCacheMode } from '@runcastle/core'
import * as z from 'zod'
import { createSystemExec } from '../../doctor/system-exec'
import { InvalidInputError } from '../../errors'
import { emitProject } from '../../services/events'
import { getUpdateInfo } from '../../services/update-check'
import {
  type BurnCacheEngine,
  burnCacheVolumeName,
  burnCacheVolumeSize,
  getBurnSlotAllocator,
  removeBurnCacheVolume,
} from '../../workflows/burn-cache'
import { runcastleVersion } from '../../version'
import { publicProcedure, router } from '../context'

/**
 * System-level info for the shell (issue #51): the running version and the
 * npm update check that drives the dismissible update banner. Both are process
 * facts, not per-request — the update check is memoized in the service.
 *
 * `burnCache` is the operator surface for the persistent burn cache volume
 * (decision 6): a cache the operator can neither see nor drop is a support
 * ticket waiting to happen, so the AFK card gets its size and one button that
 * clears it.
 */

/** The project the burn cache volume belongs to — one volume per project. */
const projectInput = z.object({ projectId: z.string() })

/**
 * The engine holding this project's cache volume, or `null` when the sandbox
 * is not one that has volumes at all. `resolveBurnCacheMode` already reads
 * `off` for that case; this is the same fact in the shape the commands need.
 */
function burnCacheEngine(sandbox: string): BurnCacheEngine | null {
  return sandbox === 'docker' || sandbox === 'podman' ? sandbox : null
}

export const systemRouter = router({
  version: publicProcedure.query(() => ({ version: runcastleVersion() })),
  checkUpdate: publicProcedure.query(() => getUpdateInfo(runcastleVersion())),

  burnCache: router({
    /**
     * What the AFK card renders: whether the cache is on at all, which volume
     * holds it, and how big it has grown. `sizeBytes` is null whenever there is
     * no number to show honestly — the cache is off, no volume exists yet, or
     * the engine could not report a size.
     */
    status: publicProcedure.input(projectInput).query(async ({ ctx, input }) => {
      const mode = resolveBurnCacheMode(ctx.config)
      const engine = burnCacheEngine(ctx.config.sandbox)
      const sizeBytes =
        mode === 'volume' && engine
          ? await burnCacheVolumeSize({ engine, projectId: input.projectId, exec: createSystemExec() })
          : null
      return { mode, engine, volumeName: burnCacheVolumeName(input.projectId), sizeBytes }
    }),

    /**
     * Drop the volume. Refused while a burn holds a slot — those slots ARE the
     * checkouts on the volume — which `removeBurnCacheVolume` decides from the
     * allocator's `held()`, so no `volume rm` is issued in that case.
     *
     * Deliberately allowed while `burnCache` is `off`: an operator who turned
     * the cache off is exactly the one who wants the disk back.
     */
    clear: publicProcedure.input(projectInput).mutation(async ({ ctx, input }) => {
      const engine = burnCacheEngine(ctx.config.sandbox)
      if (!engine) {
        throw new InvalidInputError(
          `the burn cache needs a docker or podman sandbox; this one is "${ctx.config.sandbox}"`,
        )
      }
      const volumeName = burnCacheVolumeName(input.projectId)
      await removeBurnCacheVolume({
        engine,
        projectId: input.projectId,
        exec: createSystemExec(),
        slots: getBurnSlotAllocator(ctx.config.burnConcurrency).held(),
      })
      emitProject(ctx, input.projectId, {
        type: 'burn-cache.cleared',
        message: `cleared the burn cache volume ${volumeName}`,
      })
      return { volumeName }
    }),
  }),
})
