import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Project } from '@runcastle/core'
import { simpleGit } from 'simple-git'
import type { SimpleGit } from 'simple-git'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { listAfter } from '../src/services/events'
import { __resetTestDriveState, createFeatureBranch, testDrive } from '../src/services/git'
import { getFeatureRow } from '../src/services/repo'
import { createCallerFactory } from '../src/trpc/context'
import { appRouter } from '../src/trpc/router'
import { makeTestCtx } from './helpers/db'
import { seedFeature, seedProject } from './helpers/fixtures'

/**
 * Streamlining-ux ticket 9 — a conflicted Merge & ship must surface the conflict
 * (file list + base branch) through the tRPC `feature.merge` seam: on the return
 * value AND a `merge.conflict` event (so the review card survives a reload). The
 * clean ship path and the merge-denied-during-drive guard are regressions.
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

/** Land a `README.md` edit on feature/<slug> AND a clashing one on main. */
async function makeConflict(project: Project, g: SimpleGit, slug: string): Promise<void> {
  await createFeatureBranch(project, slug)
  await g.checkout(`feature/${slug}`)
  writeFileSync(join(project.repoPath, 'README.md'), 'feature-line\n')
  await g.add(['README.md'])
  await g.commit('feat: edit readme')
  await g.checkout('main')
  writeFileSync(join(project.repoPath, 'README.md'), 'main-line\n')
  await g.add(['README.md'])
  await g.commit('chore: edit readme on main')
}

describe('feature.merge — conflict surfacing (ticket 9)', () => {
  let ctx: AppCtx
  let caller: ReturnType<ReturnType<typeof createCallerFactory<typeof appRouter>>>
  let project: Project
  let g: SimpleGit

  beforeEach(async () => {
    __resetTestDriveState()
    ctx = await makeTestCtx()
    caller = createCallerFactory(appRouter)(ctx)
    const repo = mkTmp('rc-mc-')
    g = await initRepo(repo)
    project = seedProject(ctx, repo)
  })

  afterEach(() => {
    __resetTestDriveState()
    while (tmpDirs.length) {
      const dir = tmpDirs.pop()
      if (dir) {
        try {
          rmSync(dir, { recursive: true, force: true })
        } catch {
          // best-effort
        }
      }
    }
  })

  it('returns the conflicting files + base and emits a merge.conflict event carrying them', async () => {
    await makeConflict(project, g, 'clash')
    const feature = seedFeature(ctx, project.id, { slug: 'clash', phase: 'review' })

    const res = await caller.feature.merge({ featureId: feature.id })

    expect(res).toEqual({ ok: false, conflict: true, base: 'main', files: ['README.md'] })

    // Survives a reload: the file list + base branch live on the event feed.
    const ev = listAfter(ctx, feature.id, 0).find((e) => e.type === 'merge.conflict')
    expect(ev).toBeDefined()
    expect(ev?.data).toMatchObject({ base: 'main', files: ['README.md'] })

    // A failed merge must not ship the feature.
    const row = getFeatureRow(ctx, feature.id)
    expect(row.phase).toBe('review')
    expect(row.status).toBe('active')
  })

  /**
   * Fix-merge-conflict-system ticket 2 / decision 2b — the review bar now offers
   * "Retry Merge & ship" while a conflict stands, which only works because the
   * procedure never gated on the recorded one. A retry that conflicts again must
   * record what conflicts NOW: the card is derived from the latest event, so a
   * retry is also how a stale file list corrects itself.
   */
  it('lets a recorded conflict be retried, recording the conflict as it stands now', async () => {
    await makeConflict(project, g, 'clash')
    const feature = seedFeature(ctx, project.id, { slug: 'clash', phase: 'review' })
    await caller.feature.merge({ featureId: feature.id })

    // A second file starts clashing between the two attempts.
    await g.checkout('feature/clash')
    writeFileSync(join(project.repoPath, 'NOTES.md'), 'feature-note\n')
    await g.add(['NOTES.md'])
    await g.commit('feat: notes')
    await g.checkout('main')
    writeFileSync(join(project.repoPath, 'NOTES.md'), 'main-note\n')
    await g.add(['NOTES.md'])
    await g.commit('chore: notes on main')

    const retry = await caller.feature.merge({ featureId: feature.id })

    expect(retry).toEqual({
      ok: false,
      conflict: true,
      base: 'main',
      files: ['NOTES.md', 'README.md'],
    })
    const conflicts = listAfter(ctx, feature.id, 0).filter((e) => e.type === 'merge.conflict')
    expect(conflicts).toHaveLength(2)
    expect(conflicts[1]?.data).toMatchObject({ base: 'main', files: ['NOTES.md', 'README.md'] })
    expect(conflicts[1]!.ts).toBeGreaterThanOrEqual(conflicts[0]!.ts)
  })

  it('clean merge still ships: phase → shipped, status → shipped (regression)', async () => {
    await createFeatureBranch(project, 'happy')
    await g.checkout('feature/happy')
    writeFileSync(join(project.repoPath, 'feature.txt'), 'hi\n')
    await g.add(['feature.txt'])
    await g.commit('feat: work')
    await g.checkout('main')
    const feature = seedFeature(ctx, project.id, { slug: 'happy', phase: 'review' })

    const res = await caller.feature.merge({ featureId: feature.id })

    expect(res.ok).toBe(true)
    expect(res.conflict).toBeUndefined()
    const row = getFeatureRow(ctx, feature.id)
    expect(row.phase).toBe('shipped')
    expect(row.status).toBe('shipped')
    // no conflict event on the happy path
    expect(listAfter(ctx, feature.id, 0).some((e) => e.type === 'merge.conflict')).toBe(false)
  })

  it('merge is denied while another feature is being test-driven (guard holds)', async () => {
    await createFeatureBranch(project, 'target')
    const target = seedFeature(ctx, project.id, { slug: 'target', phase: 'review' })
    // A DIFFERENT feature holds an active drive — the merge handler only stops
    // THIS feature's drive, so the git-service guard must still deny the merge.
    const other = seedFeature(ctx, project.id, { slug: 'other' })
    await createFeatureBranch(project, 'other')
    const start = await testDrive(ctx, project, other, 'start')
    expect(start.ok).toBe(true)

    await expect(caller.feature.merge({ featureId: target.id })).rejects.toThrow(/test drive/i)
    expect(getFeatureRow(ctx, target.id).phase).toBe('review')

    await testDrive(ctx, project, other, 'stop')
  })
})
