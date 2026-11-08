import { existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  IMAGE_BUILD_FAILED_EVENT,
  IMAGE_BUILD_STARTED_EVENT,
  IMAGE_BUILT_EVENT,
  type ImageBuildNeed,
  resolveSandboxImage,
  type RuncastleConfig,
  type WorkflowCtx,
} from '@runcastle/core'
import { logsDir } from '@runcastle/core/paths'
import type { ExecFn } from '../doctor/doctor'
import { burnerDockerfilePath } from '../launcher/asset-paths'
import {
  type BuildStepRunner,
  prepareImageBuild,
  runImageBuild,
  waitForImageBuildSlot,
} from '../services/image-build'
import {
  type BuildableProject,
  type BuiltImage,
  hashDockerfile,
  type ImageBuildTarget,
  imageBuildTarget,
  imageUidMismatch,
  inspectBuiltImage,
  projectDockerfilePath,
} from '../services/sandbox-image'
import { type BurnUser, resolveBurnUser } from './burn-user'

/**
 * A round builds its own image (feature `burns-build-their-own-image`). This runs
 * after the cheap checks and before the toolchain probe, so a round that cannot
 * run anyway never pays for a build, and the probe sees the image the run will use.
 */

/** How many of the build's last lines the timeline event carries. */
const EVENT_TAIL_LINES = 20

export type BurnImageOutcome = { status: 'ready' } | { status: 'failed'; summary: string }

export interface BurnImageNeedInput {
  target: Extract<ImageBuildTarget, { kind: 'stock' | 'project' }>
  image: BuiltImage
  /** The project's stored image, and whether runcastle may rewrite it. */
  stored: string | null | undefined
  overwritable: boolean
  /** The repo's Dockerfile hash for a project target; null when it cannot be read. */
  projectHash: string | null
  burnUser: Pick<BurnUser, 'uid'>
}

/**
 * Why this round should build, or null when it runs on what is there. An image
 * that can run is left alone: a round only replaces one that would stop it
 * (decision 2) or that the repo has asked to change (decision 12). The stock
 * image's own hash and every CLI version are deliberately not read here.
 */
export function burnImageNeed(input: BurnImageNeedInput): ImageBuildNeed | null {
  const { target, image, stored, overwritable, projectHash, burnUser } = input
  if (!image.present) return 'missing'
  if (target.kind === 'project' && overwritable && stored !== target.tag) return 'unadopted'
  if (imageUidMismatch(image.user, burnUser) !== undefined) return 'wrong-uid'
  if (target.kind === 'project' && projectHash !== null && image.hash !== projectHash) {
    return 'dockerfile-changed'
  }
  return null
}

/** What a run's image started as, in the words of the timeline. */
const NEED_WORDS: Record<ImageBuildNeed, string> = {
  missing: 'it is not on this machine',
  unadopted: 'this project has not adopted it yet',
  'wrong-uid': 'it was built for another user',
  'dockerfile-changed': "the repo's Dockerfile has changed",
}

/** What the image build reads of a run: the burn's context, or a worker start's stand-in for it. */
export type BurnImageCtx = Pick<WorkflowCtx, 'runId' | 'project' | 'emitEvent' | 'signal' | 'projectImage'>

export interface EnsureBurnImageDeps {
  config: Pick<RuncastleConfig, 'sandbox' | 'sandboxImage'>
  /** Uncached: an answer from before the build must not stand in for one after it. */
  exec: ExecFn
  burnUser?: BurnUser | undefined
  runStep?: BuildStepRunner | undefined
}

/**
 * Make sure the image this run should use exists, building it when it does not.
 * Holds the server's one build slot while it builds, and looks again once it has
 * the slot, so the second of two burns carries straight on. A stop rejects, which
 * the runner records as a cancelled run.
 */
export async function ensureBurnImage(
  ctx: BurnImageCtx,
  deps: EnsureBurnImageDeps,
): Promise<BurnImageOutcome> {
  const { config, exec } = deps
  const columns = ctx.projectImage
  if (!columns) return { status: 'ready' }
  const engine = config.sandbox
  const burnUser = deps.burnUser ?? resolveBurnUser(engine)

  const buildable = (): BuildableProject => ({
    id: ctx.project.id,
    repoPath: ctx.project.repoPath,
    sandboxImage: ctx.project.sandboxImage,
    sandboxImageOverwritable: columns.overwritable(),
  })

  const check = async (): Promise<{ need: ImageBuildNeed; tag: string; dockerfile: string } | null> => {
    // A stored image runcastle wrote, whose Dockerfile has gone, on the doctor's
    // own terms: a round may get here before the doctor has looked.
    if (
      ctx.project.sandboxImage?.trim() &&
      columns.overwritable() &&
      !existsSync(projectDockerfilePath(ctx.project.repoPath))
    ) {
      columns.release()
    }
    const project = buildable()
    const target = imageBuildTarget({ config, project, stockDockerfile: burnerDockerfilePath() })
    if (target.kind === 'refused') return null
    // A human's own column can name a tag this build would not produce.
    if (target.kind === 'stock' && resolveSandboxImage(config, ctx.project) !== target.tag) return null
    const image = await inspectBuiltImage(exec, engine, target.tag)
    // A wedged engine is not a missing image: the checks after this say so better.
    if (image.undetermined) return null
    const need = burnImageNeed({
      target,
      image,
      stored: project.sandboxImage,
      overwritable: project.sandboxImageOverwritable,
      projectHash: target.kind === 'project' ? hashDockerfile(target.dockerfile) : null,
      burnUser,
    })
    return need ? { need, tag: target.tag, dockerfile: target.dockerfile } : null
  }

  const found = await check()
  if (!found) return { status: 'ready' }

  const { tag, need, dockerfile } = found
  const logPath = join(logsDir(), `image-build-${ctx.runId}.log`)
  const startedAt = Date.now()
  ctx.emitEvent({
    type: IMAGE_BUILD_STARTED_EVENT,
    message: `Building ${tag} from ${dockerfile}, because ${NEED_WORDS[need]}. Log: ${logPath}`,
    data: { image: tag, dockerfile, need, log: logPath },
  })

  const release = await waitForImageBuildSlot(ctx.signal)
  try {
    if (!(await check())) {
      ctx.emitEvent({
        type: IMAGE_BUILT_EVENT,
        message: `${tag} is ready: another build finished it.`,
        data: { image: tag, seconds: secondsSince(startedAt) },
      })
      return { status: 'ready' }
    }

    const { runtime, plan, notices } = await prepareImageBuild({ exec, config, project: buildable() })
    // Refused here means the setting changed underneath this run: nothing to build.
    if (plan.kind === 'refused') return { status: 'ready' }
    for (const notice of notices) {
      ctx.emitEvent({ type: 'burn.image_build_notice', message: notice, data: { warning: true } })
    }

    const result = await runImageBuild(plan, {
      runtime,
      logPath,
      signal: ctx.signal,
      runStep: deps.runStep,
    })
    if (!result.ok) {
      if (result.aborted) throw ctx.signal.reason ?? new Error(result.cause)
      const summary = `${result.cause} — the sandbox image ${tag} did not build. Fix that and start the round again. Full log: ${logPath}`
      ctx.emitEvent({
        type: IMAGE_BUILD_FAILED_EVENT,
        message: summary,
        data: { warning: true, image: tag, log: logPath, tail: result.tail.slice(-EVENT_TAIL_LINES) },
      })
      return { status: 'failed', summary }
    }

    if (plan.kind === 'chain') columns.adopt(plan.projectTag)
    const seconds = secondsSince(startedAt)
    ctx.emitEvent({
      type: IMAGE_BUILT_EVENT,
      message: `Built ${tag} in ${seconds}s.`,
      data: { image: tag, seconds },
    })
    return { status: 'ready' }
  } finally {
    release()
  }
}

function secondsSince(startedAt: number): number {
  return Math.round((Date.now() - startedAt) / 1000)
}
