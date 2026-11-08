import { type RuncastleConfig, resolveBurnCacheMode, resolveSandboxImage } from '@runcastle/core'
import { createSystemExec } from '../doctor/system-exec'
import { type BurnCacheEngine, ensureBurnCacheVolume } from './burn-cache'
import { type BurnImageCtx, ensureBurnImage } from './burn-image'
import { resolveBurnUser } from './burn-user'
import type { Engine } from './sandbox'

/** What a worker start needs ready before its sandbox is created. */
export interface PrepareInput {
  /** The image build's view of the start; its `project` follows a build that adopted a new image. */
  image: BurnImageCtx
  config: RuncastleConfig
}

/**
 * Make a worker's sandbox possible (burns-become-workers decision 11): build the
 * project image when it is missing or stale, as burns did, then make the
 * project's cache volume (owned by the worker user) when the cache is on.
 * Throws what failed, so the start fails the way a setup failure does.
 */
export async function prepareSandbox(engine: Engine, input: PrepareInput): Promise<void> {
  const { image, config } = input
  const exec = createSystemExec({ cwd: image.project.repoPath })
  const built = await ensureBurnImage(image, { config, exec })
  if (built.status === 'failed') throw new Error(built.summary)
  if (resolveBurnCacheMode(config) !== 'volume') return
  const cacheEngine: BurnCacheEngine = engine
  await ensureBurnCacheVolume({
    engine: cacheEngine,
    // Read after the build: the chown one-shot runs the image the worker will run.
    imageName: resolveSandboxImage(config, image.project),
    projectId: image.project.id,
    exec,
    burnUser: resolveBurnUser(cacheEngine),
  })
}
