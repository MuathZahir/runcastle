import { loadConfig } from '@runcastle/core/config-load'
import type { RuncastleConfig } from '@runcastle/core'
import type { ExecFn } from '../doctor/doctor'
import { createSystemExec } from '../doctor/system-exec'
import { type BuildStepRunner, prepareImageBuild, runImageBuild } from '../services/image-build'
import { ROOT_BURN_REFUSED, runningAsRoot } from '../workflows/burn-user'

export const BUILD_IMAGE_USAGE = 'usage: runcastle build-image'

export interface BuildImageDeps {
  log?: (line: string) => void
  exec?: ExecFn
  config?: Pick<RuncastleConfig, 'sandbox' | 'sandboxImage'>
  runningAsRoot?: boolean
  runStep?: BuildStepRunner
}

/**
 * `runcastle build-image`: the stock image, with no app and no project. It is how
 * an install builds ahead of the first round, and a server's Rebuild. It always
 * runs the build, so an image with nothing to change finishes from the layer cache.
 * Project images are left to rounds, because they need the database. Returns the
 * process exit code.
 */
export async function runBuildImage(argv: string[], deps: BuildImageDeps = {}): Promise<number> {
  const log = deps.log ?? console.log
  if (argv.length > 0) {
    log(BUILD_IMAGE_USAGE)
    return 1
  }
  // The image takes the host's UID, and one built for UID 0 helps no round.
  if (deps.runningAsRoot ?? runningAsRoot()) {
    log(ROOT_BURN_REFUSED)
    return 1
  }

  const { runtime, plan, notices } = await prepareImageBuild({
    exec: deps.exec ?? createSystemExec(),
    config: deps.config ?? loadConfig(),
    project: null,
  })
  if (plan.kind === 'refused') {
    log(plan.reason)
    return 1
  }
  notices.forEach((notice) => log(notice))

  const result = await runImageBuild(plan, { runtime, onLine: log, runStep: deps.runStep })
  const tags = plan.steps.map((step) => step.tag).join(', ')
  log(result.ok ? `Built ${tags}.` : `${tags} did not build: ${result.cause}`)
  return result.ok ? 0 : 1
}
