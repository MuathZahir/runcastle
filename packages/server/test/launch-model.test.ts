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
import { listAfter } from '../src/services/events'
import { createFeatureBranch } from '../src/services/git'
import { makeTestCtx } from './helpers/db'
import { seedFeature, seedProject } from './helpers/fixtures'

/**
 * Per-step model resolution at launch (issue #48). A `spawn:false` launch still
 * renders the real `claude` argv into its `session.launched` event, so we can
 * observe the `--model` flag each session kind runs and prove the resolution
 * chain: `stepModels[kind]` wins over the per-project override, which wins over
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

  async function launchAndReadModel(slug: string): Promise<string> {
    const project = seedProject(ctx, repoPath)
    const feature = seedFeature(ctx, project.id, { slug })
    await createFeatureBranch(project, slug)
    cleanup.push(worktreeDir(project.id, slug))
    const { sessionId } = await launchSession(
      ctx,
      { featureId: feature.id, kind: 'ideation' },
      { spawn: false },
    )
    cleanup.push(sessionDir(sessionId))
    const launched = listAfter(ctx, feature.id, 0).find((e) => e.type === 'session.launched')
    const command = String((launched?.data as { command?: string })?.command ?? '')
    const m = command.match(/--model (\S+)/)
    if (!m) throw new Error(`no --model flag in launch command: ${command}`)
    return m[1]
  }

  it('falls back to the global default model', async () => {
    expect(ctx.config.model).toBe('claude-opus-5')
    expect(await launchAndReadModel('global-default')).toBe('claude-opus-5')
  })

  it('uses the per-project model override above the global default', async () => {
    // A launch reads the project fresh, so setting the row is enough.
    const project = seedProject(ctx, repoPath)
    ctx.db.update(projects).set({ model: 'claude-sonnet-5' }).where(eq(projects.id, project.id)).run()
    const feature = seedFeature(ctx, project.id, { slug: 'proj-model' })
    await createFeatureBranch(project, 'proj-model')
    cleanup.push(worktreeDir(project.id, 'proj-model'))
    const { sessionId } = await launchSession(
      ctx,
      { featureId: feature.id, kind: 'ideation' },
      { spawn: false },
    )
    cleanup.push(sessionDir(sessionId))
    const launched = listAfter(ctx, feature.id, 0).find((e) => e.type === 'session.launched')
    const command = String((launched?.data as { command?: string })?.command ?? '')
    expect(command).toContain('--model claude-sonnet-5')
  })

  it('a per-step model override wins the chain', async () => {
    ctx.config.stepModels = { ...ctx.config.stepModels, ideation: 'claude-haiku-4-5-20251001' }
    expect(await launchAndReadModel('step-model')).toBe('claude-haiku-4-5-20251001')
  })
})
