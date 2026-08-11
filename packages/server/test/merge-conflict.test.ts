import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Feature, Project } from '@runcastle/core'
import { eq } from 'drizzle-orm'
import { simpleGit } from 'simple-git'
import type { SimpleGit } from 'simple-git'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { features } from '../src/db/schema'
import type { AppCtx } from '../src/db/types'
import { listAfter } from '../src/services/events'
import {
  __resetTestDriveState,
  createFeatureBranch,
  detachWorktree,
  ensureTalkWorktree,
  testDrive,
} from '../src/services/git'
import { getFeatureRow } from '../src/services/repo'
import { listByFeature, storeTickets, updateTicket } from '../src/services/tickets'
import { createCallerFactory } from '../src/trpc/context'
import { appRouter } from '../src/trpc/router'
import { makeTestCtx } from './helpers/db'
import { seedFeature, seedProject } from './helpers/fixtures'

/**
 * Streamlining-ux ticket 9 — a conflicted Merge & ship must surface the conflict
 * (file list + base branch) through the tRPC `feature.merge` seam: on the return
 * value AND a `merge.conflict` event (so the review card survives a reload). The
 * clean ship path and the merge-denied-during-drive guard are regressions.
 *
 * The second suite covers the-work-record ticket 3: the same seam promotes the
 * feature's `outcome.md` onto the feature branch just before the merge.
 */

const tmpDirs: string[] = []

function mkTmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tmpDirs.push(dir)
  return dir
}

/**
 * HOME is redirected for every test in this file: merging now writes into the
 * feature's talk worktree (`worktreeDir` → `~/.runcastle`), which must never
 * touch the developer's real data dir.
 */
let prevHome: string | undefined
beforeEach(() => {
  prevHome = process.env.HOME
  process.env.HOME = mkTmp('rc-home-')
})
afterEach(() => {
  process.env.HOME = prevHome
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

/** What a ticket looks like by the time the feature reaches review. */
interface TicketOutcome {
  title: string
  status: 'done' | 'failed' | 'cancelled'
  digest?: string
  error?: string
}

describe('feature.merge — outcome.md promotion (the-work-record ticket 3)', () => {
  let ctx: AppCtx
  let caller: ReturnType<ReturnType<typeof createCallerFactory<typeof appRouter>>>
  let project: Project
  let g: SimpleGit

  beforeEach(async () => {
    __resetTestDriveState()
    ctx = await makeTestCtx()
    caller = createCallerFactory(appRouter)(ctx)
    const repo = mkTmp('rc-outcome-')
    g = await initRepo(repo)
    project = seedProject(ctx, repo)
  })

  afterEach(() => {
    __resetTestDriveState()
  })

  /** A feature with a branch carrying one commit, sitting in review. */
  async function seedShippableFeature(slug: string): Promise<Feature> {
    await createFeatureBranch(project, slug)
    await g.checkout(`feature/${slug}`)
    writeFileSync(join(project.repoPath, `${slug}.txt`), 'work\n')
    await g.add([`${slug}.txt`])
    await g.commit('feat: work')
    await g.checkout('main')
    return seedFeature(ctx, project.id, { slug, phase: 'review', title: `The ${slug} feature` })
  }

  /** Store tickets and drive each to the terminal state the outcome doc reads. */
  function seedTickets(featureId: string, outcomes: TicketOutcome[]): void {
    const stored = storeTickets(
      ctx,
      featureId,
      outcomes.map((o) => ({
        title: o.title,
        goal: 'do the thing',
        context: 'somewhere',
        acceptanceCriteria: [],
        seams: [],
        blockedBy: [],
      })),
    )
    stored.forEach((ticket, i) => {
      const { status, digest, error } = outcomes[i]
      updateTicket(ctx, ticket.id, { status, digest, error })
    })
  }

  const outcomeAt = (ref: string, slug: string): Promise<string> =>
    g.raw(['show', `${ref}:docs/features/${slug}/outcome.md`])

  it('commits the doc onto the feature branch before the merge, so it lands on the base', async () => {
    const feature = await seedShippableFeature('thick')
    seedTickets(feature.id, [
      { title: 'Harvest the digest', status: 'done', digest: 'Read DIGEST.md after the run.' },
      { title: 'Aggregate the run', status: 'failed', error: 'fatal: the sandbox died' },
    ])
    // No talk worktree on disk yet — the merge path has to create one to commit in.
    const res = await caller.feature.merge({ featureId: feature.id })

    expect(res.ok).toBe(true)
    const doc = await outcomeAt('main', 'thick')
    expect(doc).toContain('# Outcome — The thick feature')
    expect(doc).toContain('- Lap: 1')
    expect(doc).toContain('## 1. Harvest the digest')
    expect(doc).toContain('Read DIGEST.md after the run.')
    expect(doc).toContain('- **2. Aggregate the run** — failed: fatal: the sandbox died')
    // It rode in on the feature branch rather than being written onto the base.
    expect(await outcomeAt('feature/thick', 'thick')).toBe(doc)
  })

  it('regenerates the doc on a later lap, and commits nothing when it is unchanged', async () => {
    const feature = await seedShippableFeature('laps')
    seedTickets(feature.id, [{ title: 'Lap one work', status: 'done', digest: 'First lap.' }])
    expect((await caller.feature.merge({ featureId: feature.id })).ok).toBe(true)

    // Merging again with nothing changed regenerates identical content, which
    // `commitDocs` swallows — no empty commit on the feature branch.
    const tip = (await g.revparse(['feature/laps'])).trim()
    expect((await caller.feature.merge({ featureId: feature.id })).ok).toBe(true)
    expect((await g.revparse(['feature/laps'])).trim()).toBe(tip)

    // Lap 2 adds a ticket; the merge regenerates the doc around both laps.
    ctx.db.update(features).set({ lap: 2 }).where(eq(features.id, feature.id)).run()
    seedTickets(feature.id, [{ title: 'Lap two work', status: 'done', digest: 'Second lap.' }])
    expect((await caller.feature.merge({ featureId: feature.id })).ok).toBe(true)

    const doc = await outcomeAt('main', 'laps')
    expect(doc).toContain('- Lap: 2')
    expect(doc).toContain('First lap.')
    expect(doc).toContain('Second lap.')
    expect((await g.revparse(['feature/laps'])).trim()).not.toBe(tip)
  })

  it('promotes the doc when the talk worktree is sitting on a detached HEAD', async () => {
    const feature = await seedShippableFeature('detached')
    seedTickets(feature.id, [{ title: 'Burned work', status: 'done', digest: 'Did it.' }])
    // What a burn leaves behind: the runner detaches the talk worktree to free
    // the branch, and its reattach on finalize is best-effort.
    const worktree = await ensureTalkWorktree(project, feature)
    expect(await detachWorktree(worktree)).toBe(true)

    expect((await caller.feature.merge({ featureId: feature.id })).ok).toBe(true)
    expect(await outcomeAt('main', 'detached')).toContain('Did it.')
  })

  it('keeps the conflict payload, leaving the outcome commit on the feature branch', async () => {
    await makeConflict(project, g, 'clash')
    const feature = seedFeature(ctx, project.id, { slug: 'clash', phase: 'review' })
    seedTickets(feature.id, [{ title: 'Clashing work', status: 'done', digest: 'Did it.' }])

    const res = await caller.feature.merge({ featureId: feature.id })

    expect(res).toEqual({ ok: false, conflict: true, base: 'main', files: ['README.md'] })
    // The doc is regenerated on the retry, so it may sit on the branch meanwhile;
    // nothing of it reached the base branch.
    expect(await outcomeAt('feature/clash', 'clash')).toContain('Did it.')
    await expect(outcomeAt('main', 'clash')).rejects.toThrow()
    expect((await g.raw(['status', '--porcelain'])).trim()).toBe('')
  })

  it('never blocks the merge when the docs commit cannot be made', async () => {
    const feature = await seedShippableFeature('unwritable')
    seedTickets(feature.id, [{ title: 'Some work', status: 'done', digest: 'Did it.' }])
    // A data dir that cannot hold a worktree: promotion fails, the ship does not.
    process.env.HOME = join(project.repoPath, 'README.md')

    const res = await caller.feature.merge({ featureId: feature.id })

    expect(res.ok).toBe(true)
    expect(getFeatureRow(ctx, feature.id).phase).toBe('shipped')
    const failed = listAfter(ctx, feature.id, 0).find((e) => e.type === 'docs.outcome_failed')
    expect(failed).toBeDefined()
    expect(listByFeature(ctx, feature.id)).toHaveLength(1)
  })
})
