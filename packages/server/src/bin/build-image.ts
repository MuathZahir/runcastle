import { loadConfig } from '@runcastle/core/config-load'
import type { RuncastleConfig } from '@runcastle/core'
import type { ExecFn } from '../doctor/doctor'
import { createSystemExec } from '../doctor/system-exec'
import { dataDir } from '@runcastle/core/paths'
import { type BuildStepRunner, prepareImageBuild, runImageBuild } from '../services/image-build'
import { removeStaleSandboxImages } from '../services/sandbox-image-cleanup'
import { ROOT_BURN_REFUSED, runningAsRoot } from '../workers/burn-user'

function formatBytes(bytes: number): string {
  return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.round(bytes / 1e6)} MB`
}

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

  const exec = deps.exec ?? createSystemExec()
  const { runtime, plan, mode, notices } = await prepareImageBuild({
    exec,
    config: deps.config ?? loadConfig(),
    project: null,
  })
  if (plan.kind === 'refused') {
    log(plan.reason)
    return 1
  }
  notices.forEach((notice) => log(notice))

  const result = await runImageBuild(plan, { runtime, mode, onLine: log, runStep: deps.runStep })
  const tags = plan.steps.map((step) => step.tag).join(', ')
  log(result.ok ? `Built ${tags}.` : `${tags} did not build: ${result.cause}`)
  if (!result.ok) return 1
  if (result.cacheKept) log(`Kept the build cache: ${result.cacheKept}.`)
  // The image this build replaced is untagged now; it goes unless a container uses it.
  const replaced = await removeStaleSandboxImages({ engine: runtime, exec, dataDir: dataDir() })
  if (replaced.removed.length > 0) {
    log(`Removed ${replaced.removed.length} replaced image(s), ${formatBytes(replaced.freedBytes)}.`)
  }
  return 0
}
