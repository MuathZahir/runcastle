import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Feature, Project } from '@runcastle/core'
import { eq } from 'drizzle-orm'
import { simpleGit } from 'simple-git'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { features } from '../src/db/schema'
import { runMigrations } from '../src/db/migrate'
import type { AppCtx } from '../src/db/types'
import { GateError } from '../src/errors'
import { converge, launchSession, workWaypoint } from '../src/launcher/launcher'
import { listAfter } from '../src/services/events'
import {
  advance,
  archiveFeature,
  burn,
  createFeature,
  deleteFeature,
  rethink,
  startDraft,
} from '../src/services/features'
import { getFeatureRow } from '../src/services/repo'
import { createCallerFactory } from '../src/trpc/context'
import { appRouter } from '../src/trpc/router'
import { makeTestCtx } from './helpers/db'
import { seedFeature, seedProject } from './helpers/fixtures'

/**
 * Draft features (decisions 2–8): a draft is a DB row and nothing else. What has
 * to be right here is the shape of that parkedness — creation does zero git and
 * filesystem work, Start does all of it at the moment it is clicked, and every
 * door that treats a feature as live refuses a draft with one message. Tested
 * against REAL git in temp fixture repos, like the sibling create/delete suites;
 * HOME is redirected so nothing touches the developer's data dir.
 */

const tmpDirs: string[] = []

function mkTmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tmpDirs.push(dir)
  return dir
}

async function initRepo(dir: string): Promise<void> {
  const g = simpleGit(dir)
  await g.init(['-b', 'main'])
  await g.addConfig('user.email', 'test@runcastle.dev')
  await g.addConfig('user.name', 'Runcastle Test')
  await g.addConfig('core.autocrlf', 'false')
  writeFileSync(join(dir, 'README.md'), 'base\n')
  await g.add(['README.md'])
  await g.commit('initial commit')
}

/** The one refusal every live-feature verb owes a draft (decision 8). */
const DRAFT_REFUSAL = /is a draft — click Start to cut its branch and begin/

describe('draft features', () => {
  let ctx: AppCtx
  let project: Project
  let repoPath: string
  let prevHome: string | undefined
  let prevUserProfile: string | undefined

  beforeEach(async () => {
    const home = mkTmp('rc-home-')
    prevHome = process.env.HOME
    prevUserProfile = process.env.USERPROFILE
    process.env.HOME = home
    process.env.USERPROFILE = home

    ctx = await makeTestCtx()
    repoPath = mkTmp('rc-repo-')
    await initRepo(repoPath)
    project = seedProject(ctx, repoPath)
  })

  afterEach(() => {
    process.env.HOME = prevHome
    process.env.USERPROFILE = prevUserProfile
    while (tmpDirs.length) rmSync(tmpDirs.pop() as string, { recursive: true, force: true })
  })

  describe('creation parks the idea and touches nothing else', () => {
    it('inserts a draft row with the brief and does zero git or filesystem work', async () => {
      const f = await createFeature(ctx, {
        projectId: project.id,
        title: 'Parked Idea',
        oneLiner: 'someday',
        brief: 'the reasoning we worked out before deferring this',
        draft: true,
      })

      expect(f.status).toBe('draft')
      expect(f.baseBranch).toBeUndefined()
      expect(f.brief).toBe('the reasoning we worked out before deferring this')
      // The branch NAME is recorded even though nothing was cut (decision 2).
      expect(f.branch).toBe('feature/parked-idea')
      expect(f.phase).toBe('ideation')

      const g = simpleGit(repoPath)
      expect((await g.branchLocal()).all).not.toContain('feature/parked-idea')
      expect(existsSync(join(repoPath, 'docs', 'features', 'parked-idea'))).toBe(false)
      // No commit, and nothing left dirtying the checkout either.
      expect((await g.raw(['status', '--porcelain'])).trim()).toBe('')
      expect((await g.raw(['rev-list', '--count', 'main'])).trim()).toBe('1')
    })

    it('marks the creation event as a draft', async () => {
      const f = await createFeature(ctx, {
        projectId: project.id,
        title: 'Parked Idea',
        oneLiner: 'someday',
        draft: true,
      })

      const created = listAfter(ctx, f.id, 0).find((e) => e.type === 'feature.created')
      expect(created?.message).toContain('draft')
      expect(created?.data).toMatchObject({ draft: true, branchReady: false })
    })

    it('leaves an ordinary create untouched — active, based, branch cut', async () => {
      const f = await createFeature(ctx, {
        projectId: project.id,
        title: 'Live One',
        oneLiner: 'now',
      })

      expect(f.status).toBe('active')
      expect(f.baseBranch).toBe('main')
      expect((await simpleGit(repoPath).branchLocal()).all).toContain('feature/live-one')
    })
  })

  describe('the brief column', () => {
    it('survives re-running the migrations over an existing db', () => {
      const parked = seedFeature(ctx, project.id, { slug: 'parked', brief: 'parked prose' })

      // `runMigrations` is idempotent and is re-run on every boot; an existing db
      // must take 0019 (or skip it) without losing the column or its data.
      runMigrations(ctx.db)

      expect(getFeatureRow(ctx, parked.id).brief).toBe('parked prose')
    })

    it('is exposed on the wire Feature and is undefined for features without one', () => {
      const plain = seedFeature(ctx, project.id, { slug: 'plain' })
      expect(getFeatureRow(ctx, plain.id).brief).toBeUndefined()
    })
  })

  describe('Start', () => {
    async function parkDraft(brief?: string): Promise<Feature> {
      return createFeature(ctx, {
        projectId: project.id,
        title: 'Parked Idea',
        oneLiner: 'someday',
        brief,
        draft: true,
      })
    }

    it('cuts the branch, writes and commits the parked brief, and activates', async () => {
      const draft = await parkDraft('the reasoning we worked out before deferring this')

      const started = await startDraft(ctx, draft.id)

      expect(started.status).toBe('active')
      expect(started.baseBranch).toBe('main')
      expect(getFeatureRow(ctx, draft.id).status).toBe('active')

      const g = simpleGit(repoPath)
      expect((await g.branchLocal()).all).toContain('feature/parked-idea')

      // brief.md carries the PARKED column verbatim, not a regenerated stub.
      const briefPath = join(repoPath, 'docs', 'features', 'parked-idea', 'brief.md')
      expect(existsSync(briefPath)).toBe(true)
      expect((await g.raw(['ls-files', 'docs/features/parked-idea/brief.md'])).trim()).toBe(
        'docs/features/parked-idea/brief.md',
      )
      expect((await g.raw(['status', '--porcelain'])).trim()).toBe('')
      expect((await g.raw(['show', 'HEAD:docs/features/parked-idea/brief.md'])).trim()).toBe(
        'the reasoning we worked out before deferring this',
      )
    })

    it('emits feature.started carrying the branch and the resolved base', async () => {
      const draft = await parkDraft()
      await startDraft(ctx, draft.id)

      const started = listAfter(ctx, draft.id, 0).find((e) => e.type === 'feature.started')
      expect(started?.data).toMatchObject({ branch: 'feature/parked-idea', baseBranch: 'main' })
    })

    it('resolves the requested base at Start time, not at creation time', async () => {
      const draft = await parkDraft()

      // `develop` does not exist when the draft is parked — only when Start runs.
      const g = simpleGit(repoPath)
      await g.checkoutLocalBranch('develop')
      writeFileSync(join(repoPath, 'DEV.md'), 'dev\n')
      await g.add(['DEV.md'])
      await g.commit('develop-only commit')
      const developTip = (await g.revparse(['develop'])).trim()
      await g.checkout('main')

      const started = await startDraft(ctx, draft.id, { baseBranch: 'develop' })

      expect(started.baseBranch).toBe('develop')
      const mergeBase = (await g.raw(['merge-base', 'feature/parked-idea', 'develop'])).trim()
      expect(mergeBase).toBe(developTip)
    })

    it('refuses a feature that is not a draft', async () => {
      const live = seedFeature(ctx, project.id, { slug: 'live' })
      await expect(startDraft(ctx, live.id)).rejects.toThrow(GateError)
    })

    it('leaves the draft intact when the branch cut fails', async () => {
      const draft = await parkDraft('parked prose')

      await expect(startDraft(ctx, draft.id, { baseBranch: 'no-such-branch' })).rejects.toThrow(
        /no-such-branch/,
      )

      const after = getFeatureRow(ctx, draft.id)
      expect(after.status).toBe('draft')
      expect(after.baseBranch).toBeUndefined()
      expect(after.brief).toBe('parked prose')
      expect(existsSync(join(repoPath, 'docs', 'features', 'parked-idea'))).toBe(false)
    })
  })

  describe('a draft refuses every live-feature verb', () => {
    let draft: Feature

    beforeEach(() => {
      draft = seedFeature(ctx, project.id, { slug: 'parked', status: 'draft' })
    })

    it('refuses the synchronous service verbs', () => {
      expect(() => advance(ctx, draft.id)).toThrow(DRAFT_REFUSAL)
      expect(() => rethink(ctx, draft.id)).toThrow(DRAFT_REFUSAL)
      expect(() => archiveFeature(ctx, draft.id)).toThrow(DRAFT_REFUSAL)
      expect(() => advance(ctx, draft.id)).toThrow(GateError)
    })

    it('refuses burn', async () => {
      await expect(burn(ctx, draft.id)).rejects.toThrow(DRAFT_REFUSAL)
    })

    it('refuses every session door', async () => {
      await expect(launchSession(ctx, { featureId: draft.id, kind: 'ideation' })).rejects.toThrow(
        DRAFT_REFUSAL,
      )
      await expect(
        workWaypoint(ctx, { featureId: draft.id, waypointId: 'wp_nope' }),
      ).rejects.toThrow(DRAFT_REFUSAL)
      await expect(converge(ctx, { featureId: draft.id })).rejects.toThrow(DRAFT_REFUSAL)
    })

    it('refuses merge and test drive over tRPC', async () => {
      const caller = createCallerFactory(appRouter)(ctx)
      await expect(caller.feature.merge({ featureId: draft.id })).rejects.toThrow(DRAFT_REFUSAL)
      await expect(
        caller.feature.testDrive({ featureId: draft.id, action: 'start' }),
      ).rejects.toThrow(DRAFT_REFUSAL)
    })
  })

  it('parks and starts a draft over tRPC', async () => {
    const caller = createCallerFactory(appRouter)(ctx)

    const draft = await caller.feature.create({
      projectId: project.id,
      title: 'Over The Wire',
      oneLiner: 'someday',
      draft: true,
    })
    expect(draft.status).toBe('draft')
    expect((await simpleGit(repoPath).branchLocal()).all).not.toContain('feature/over-the-wire')

    const started = await caller.feature.start({ featureId: draft.id })
    expect(started).toMatchObject({ status: 'active', baseBranch: 'main' })
    expect((await simpleGit(repoPath).branchLocal()).all).toContain('feature/over-the-wire')
  })

  it('deletes a draft as pure row deletion', async () => {
    const draft = await createFeature(ctx, {
      projectId: project.id,
      title: 'Dead Idea',
      oneLiner: 'never mind',
      draft: true,
    })

    const res = await deleteFeature(ctx, draft.id)

    expect(res).toEqual({ ok: true, slug: 'dead-idea' })
    expect(ctx.db.select().from(features).where(eq(features.id, draft.id)).get()).toBeUndefined()
  })
})
