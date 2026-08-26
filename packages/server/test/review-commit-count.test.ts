import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Project } from '@runcastle/core'
import { simpleGit } from 'simple-git'
import type { SimpleGit } from 'simple-git'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { createFeatureBranch } from '../src/services/git'
import { createCallerFactory } from '../src/trpc/context'
import { appRouter } from '../src/trpc/router'
import { makeTestCtx } from './helpers/db'
import { seedFeature, seedProject } from './helpers/fixtures'

/**
 * Ticket 4 / findings F23 — the review SUMMARY's commit count reaches the UI
 * through `feature.commitCount`, so the wire is where it has to be right: the
 * audit watched the card report "0 commits" in green over a branch that was
 * verifiably one commit ahead of main (the old figure summed ticket commit rows,
 * which a human's or an Iterate session's commits never appear in).
 */

const tmpDirs: string[] = []

function mkTmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tmpDirs.push(dir)
  return dir
}

async function initRepo(dir: string): Promise<SimpleGit> {
  const g = simpleGit(dir)
  await g.init(['-b', 'main'])
  await g.addConfig('user.email', 'test@runcastle.dev')
  await g.addConfig('user.name', 'Runcastle Test')
  await g.addConfig('core.autocrlf', 'false')
  writeFileSync(join(dir, 'README.md'), 'base\n')
  await g.add(['README.md'])
  await g.commit('initial commit')
  return g
}

describe('feature.commitCount', () => {
  let ctx: AppCtx
  let caller: ReturnType<ReturnType<typeof createCallerFactory<typeof appRouter>>>
  let project: Project
  let g: SimpleGit

  beforeEach(async () => {
    ctx = await makeTestCtx()
    caller = createCallerFactory(appRouter)(ctx)
    const repo = mkTmp('rc-rcc-')
    g = await initRepo(repo)
    project = seedProject(ctx, repo)
  })

  afterEach(() => {
    while (tmpDirs.length) {
      const dir = tmpDirs.pop()
      if (dir) {
        try {
          rmSync(dir, { recursive: true, force: true })
        } catch {
          // best-effort — a lingering handle on Windows is non-fatal
        }
      }
    }
  })

  it('reports git’s count for a branch one commit ahead, with the branch it merges into', async () => {
    await createFeatureBranch(project, 'ahead', 'main')
    await g.checkout('feature/ahead')
    writeFileSync(join(project.repoPath, 'work.txt'), 'work\n')
    await g.add(['work.txt'])
    await g.commit('feat: work')
    await g.checkout('main')

    const feature = seedFeature(ctx, project.id, { slug: 'ahead', phase: 'review' })
    expect(await caller.feature.commitCount({ featureId: feature.id })).toEqual({
      base: 'main',
      count: 1,
    })
  })

  it('reports an unknown count as undefined when the branch was never created', async () => {
    const feature = seedFeature(ctx, project.id, { slug: 'no-branch', phase: 'review' })
    const res = await caller.feature.commitCount({ featureId: feature.id })
    expect(res.count).toBeUndefined()
  })
})
