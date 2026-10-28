import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sessionDir, worktreeDir } from '@runcastle/core/paths'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { projects } from '../src/db/schema'
import { launchSession } from '../src/launcher/launcher'
import { getSessionRow } from '../src/launcher/sessions'
import { createFeatureBranch } from '../src/services/git'
import { makeTestCtx } from './helpers/db'
import { seedFeature, seedProject } from './helpers/fixtures'
import { acpLaunchOf } from './support/thread-launch'

/**
 * Per-step model resolution at launch (issue #48). A `spawn:false` launch records
 * the resolved model on its thread's row, and the thread's ACP launch runs it, so we can
 * observe the model each session kind runs and prove the resolution
 * chain: the per-project override wins over `stepModels[kind]`, which wins over
 * the global default.
 */
function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

function initRepo(dir: string): void {
  git(dir, 'init', '-b', 'main')
  git(dir, 'config', 'user.email', 'test@runcastle.dev')
  git(dir, 'config', 'user.name', 'Runcastle Test')
  git(dir, 'commit', '--allow-empty', '-m', 'initial commit')
}

describe('launch model resolution (#48)', () => {
  let ctx: AppCtx
  let repoPath: string
  const cleanup: string[] = []

  beforeEach(async () => {
    ctx = await makeTestCtx()
    repoPath = mkdtempSync(join(tmpdir(), 'runcastle-launchmodel-'))
    cleanup.push(repoPath)
    initRepo(repoPath)
  })

  afterEach(() => {
    for (const d of cleanup) rmSync(d, { recursive: true, force: true })
    cleanup.length = 0
  })

  /** Launch an ideation session on a fresh project and report its `--model`. */
  async function launchAndReadModel(slug: string, projectModel?: string): Promise<string> {
    const project = seedProject(ctx, repoPath)
    // A launch reads the project fresh, so setting the row is enough.
    if (projectModel) {
      ctx.db.update(projects).set({ model: projectModel }).where(eq(projects.id, project.id)).run()
    }
    const feature = seedFeature(ctx, project.id, { slug })
    await createFeatureBranch(project, slug, 'main')
    cleanup.push(worktreeDir(project.id, slug))
    const { sessionId } = await launchSession(
      ctx,
      { featureId: feature.id, kind: 'chat' },
      { spawn: false },
    )
    cleanup.push(sessionDir(sessionId))
    // The row records the model, and the thread's ACP launch runs it.
    const spec = await acpLaunchOf(ctx, sessionId)
    const model = (spec.sessionMeta.claudeCode as { options: { model: string } }).options.model
    expect(getSessionRow(ctx, sessionId)?.model).toBe(model)
    return model
  }

  it('falls back to the global default model', async () => {
    expect(ctx.config.model).toBe('claude-opus-5')
    expect(await launchAndReadModel('global-default')).toBe('claude-opus-5')
  })

  it('uses the per-project model override above the global default', async () => {
    expect(await launchAndReadModel('proj-model', 'claude-sonnet-5')).toBe('claude-sonnet-5')
  })

  it('a global per-step model applies to a project that sets no model', async () => {
    ctx.config.stepModels = { ...ctx.config.stepModels, chat: 'claude-haiku-4-5-20251001' }
    expect(await launchAndReadModel('step-model')).toBe('claude-haiku-4-5-20251001')
  })

  it("a project's model wins over the global per-step model", async () => {
    ctx.config.stepModels = { ...ctx.config.stepModels, chat: 'claude-haiku-4-5-20251001' }
    expect(await launchAndReadModel('proj-beats-step', 'claude-sonnet-5')).toBe('claude-sonnet-5')
  })
})
