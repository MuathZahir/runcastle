import { getUpdateInfo } from '../../services/update-check'
import { runcastleVersion } from '../../version'
import { publicProcedure, router } from '../context'

/**
 * System-level info for the shell (issue #51): the running version and the
 * npm update check that drives the dismissible update banner. Both are process
 * facts, not per-request — the update check is memoized in the service.
 */

export const systemRouter = router({
  /**
   * The running version, and the platform of the machine the server runs on —
   * which is where every repo path lives, whatever the browser's own machine is
   * (a Windows browser on a Linux server types Linux paths).
   */
  version: publicProcedure.query(() => ({ version: runcastleVersion(), platform: process.platform })),
  checkUpdate: publicProcedure.query(({ ctx }) =>
    getUpdateInfo(runcastleVersion(), { usageSignal: ctx.config.usageSignal }),
  ),
})
