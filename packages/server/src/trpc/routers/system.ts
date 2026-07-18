import { getUpdateInfo } from '../../services/update-check'
import { runcastleVersion } from '../../version'
import { publicProcedure, router } from '../context'

/**
 * System-level info for the shell (issue #51): the running version and the
 * npm update check that drives the dismissible update banner. Both are process
 * facts, not per-request — the update check is memoized in the service.
 */
export const systemRouter = router({
  version: publicProcedure.query(() => ({ version: runcastleVersion() })),
  checkUpdate: publicProcedure.query(() => getUpdateInfo(runcastleVersion())),
})
