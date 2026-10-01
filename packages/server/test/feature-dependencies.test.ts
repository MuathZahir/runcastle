import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Feature, Project } from '@runcastle/core'
import { eq } from 'drizzle-orm'
import { simpleGit } from 'simple-git'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { featureDependencies, features } from '../src/db/schema'
import type { AppCtx } from '../src/db/types'
import { GateError, InvalidInputError } from '../src/errors'
import {
  blocksOf,
  dependsOnOf,
  setDependencies,
  validateDependencies,
  waitingOn,
} from '../src/services/dependencies'
import { listAfter } from '../src/services/events'
import { deleteFeature, getFeatureFull, list, startDraft } from '../src/services/features'
import { getFeatureRow } from '../src/services/repo'
import { createCallerFactory } from '../src/trpc/context'
import { appRouter } from '../src/trpc/router'
import { makeTestCtx } from './helpers/db'
import { seedFeature, seedProject } from './helpers/fixtures'

/**
 * Merge-order dependencies (ADR-0013): a draft waits on other features in its
 * project until each one's phase is `shipped`. Start is the only gate; the set
 * is replaced whole; a deleted dependency cascades away with a timeline event on
 * the dependent. Real git in temp repos (Start and delete do git work), HOME
 * redirected, like the sibling draft-features suite.
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

describe('feature dependencies', () => {
  let ctx: AppCtx
  let project: Project
  let repoPath: string
  let prevHome: string | undefined
  let prevUserProfile: string | undefined

  const draft = (slug: string): Feature =>
    seedFeature(ctx, project.id, { slug, status: 'draft', baseBranch: null })
  const active = (slug: string, phase: Feature['phase'] = 'building'): Feature =>
    seedFeature(ctx, project.id, { slug, phase })

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

  describe('setDependencies', () => {
    it('replaces the whole set and emits feature.dependencies.changed', () => {
      const a = active('a')
      const b = draft('b')
      const c = draft('c')

      setDependencies(ctx, c.id, [a.id, b.id])
      const replaced = setDependencies(ctx, c.id, [b.id, b.id])

      expect(replaced.map((d) => d.slug)).toEqual(['b'])
      expect(dependsOnOf(ctx, c.id).map((d) => d.slug)).toEqual(['b'])

      const changed = listAfter(ctx, c.id, 0).filter((e) => e.type === 'feature.dependencies.changed')
      expect(changed).toHaveLength(2)
      expect(changed[1].data).toEqual({ dependsOn: ['b'] })
    })

    it('clears the set with an empty list', () => {
      const a = active('a')
      const b = draft('b')
      setDependencies(ctx, b.id, [a.id])
      expect(setDependencies(ctx, b.id, [])).toEqual([])
      expect(dependsOnOf(ctx, b.id)).toEqual([])
    })

    it('refuses a dependent that has started', () => {
      const a = active('a')
      const started = active('started')
      expect(() => setDependencies(ctx, started.id, [a.id])).toThrow(
        /`started` is not a draft — dependencies can only be set on a draft/,
      )
    })

    it('refuses unknown ids', () => {
      const b = draft('b')
      expect(() => setDependencies(ctx, b.id, ['feat_nope'])).toThrow(InvalidInputError)
      expect(() => setDependencies(ctx, b.id, ['feat_nope'])).toThrow(/feat_nope/)
    })

    it('refuses a dependency in another project', () => {
      const other = seedProject(ctx, mkTmp('rc-other-'))
      const foreign = seedFeature(ctx, other.id, { slug: 'foreign' })
      const b = draft('b')
      expect(() => setDependencies(ctx, b.id, [foreign.id])).toThrow(
        /`foreign` is in another project/,
      )
    })

    it('refuses self-reference', () => {
      const b = draft('b')
      expect(() => setDependencies(ctx, b.id, [b.id])).toThrow(/`b` cannot wait on itself/)
    })

    it('refuses an already-merged dependency, even one archived since', () => {
      const shipped = active('shipped-one', 'shipped')
      const gone = seedFeature(ctx, project.id, {
        slug: 'shipped-archived',
        phase: 'shipped',
        status: 'archived',
      })
      const b = draft('b')
      expect(() => setDependencies(ctx, b.id, [shipped.id])).toThrow(
        '`shipped-one` has already merged — nothing to wait on',
      )
      expect(() => setDependencies(ctx, b.id, [gone.id])).toThrow(/`shipped-archived` has already merged/)
    })

    it('refuses a cycle, naming the slugs in it', () => {
      const a = draft('a')
      const b = draft('b')
      const c = draft('c')
      setDependencies(ctx, b.id, [a.id])
      setDependencies(ctx, c.id, [b.id])
      expect(() => setDependencies(ctx, a.id, [c.id])).toThrow(
        'that would form a cycle: `a` → `c` → `b` → `a`',
      )
      // The refused write left the set untouched.
      expect(dependsOnOf(ctx, a.id)).toEqual([])
    })

    it('validates a not-yet-created dependent without a draft or cycle check', () => {
      const a = active('a')
      expect(validateDependencies(ctx, project.id, null, [a.id, a.id]).map((f) => f.slug)).toEqual([
        'a',
      ])
      expect(() => validateDependencies(ctx, project.id, null, ['feat_nope'])).toThrow(InvalidInputError)
    })
  })

  describe('derived reads', () => {
    it('reports satisfied by phase, and blocks only from unmerged dependencies to drafts', () => {
      const building = active('building-one')
      const archived = seedFeature(ctx, project.id, { slug: 'archived-one', status: 'archived' })
      const waiter = draft('waiter')
      setDependencies(ctx, waiter.id, [building.id, archived.id])

      expect(dependsOnOf(ctx, waiter.id)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ slug: 'building-one', phase: 'building', status: 'active', satisfied: false }),
          expect.objectContaining({ slug: 'archived-one', status: 'archived', satisfied: false }),
        ]),
      )
      expect(waitingOn(ctx, waiter.id)).toHaveLength(2)
      expect(blocksOf(ctx, building.id)).toEqual([
        { featureId: waiter.id, slug: 'waiter', title: waiter.title },
      ])

      // The dependency ships then gets archived: still satisfied, blocks nothing.
      shipThenArchive(ctx, building.id)
      expect(dependsOnOf(ctx, waiter.id).find((d) => d.slug === 'building-one')?.satisfied).toBe(true)
      expect(waitingOn(ctx, waiter.id).map((d) => d.slug)).toEqual(['archived-one'])
      expect(blocksOf(ctx, building.id)).toEqual([])
    })

    it('feature.get and feature.list carry dependsOn and blocks', () => {
      const a = active('a')
      const b = draft('b')
      setDependencies(ctx, b.id, [a.id])

      const full = getFeatureFull(ctx, b.id)
      expect(full.dependsOn.map((d) => [d.slug, d.satisfied])).toEqual([['a', false]])
      expect(full.blocks).toEqual([])
      expect(getFeatureFull(ctx, a.id).blocks.map((x) => x.slug)).toEqual(['b'])

      const rows = new Map(list(ctx, project.id).map((r) => [r.slug, r]))
      expect(rows.get('b')?.dependsOn.map((d) => d.slug)).toEqual(['a'])
      expect(rows.get('b')?.blocks).toEqual([])
      expect(rows.get('a')?.dependsOn).toEqual([])
      expect(rows.get('a')?.blocks.map((x) => x.slug)).toEqual(['b'])
    })
  })

  describe('startDraft', () => {
    it('refuses a waiting draft, naming each blocker and its state, with no git work', async () => {
      const a = active('a')
      const c = seedFeature(ctx, project.id, { slug: 'c', status: 'archived' })
      const d = draft('d')
      const b = draft('b')
      setDependencies(ctx, b.id, [a.id, c.id, d.id])

      const refusal = await startDraft(ctx, b.id).catch((e: unknown) => e)
      expect(refusal).toBeInstanceOf(GateError)
      expect((refusal as GateError).message).toBe(
        '`b` waits on `a` (building), `c` (archived — remove it to start), `d` (draft)',
      )
      expect(getFeatureRow(ctx, b.id).status).toBe('draft')
      expect((await simpleGit(repoPath).branchLocal()).all).not.toContain('feature/b')
    })

    it('starts once every dependency has shipped, including shipped-then-archived', async () => {
      const a = active('a')
      const c = active('c', 'review')
      const b = draft('b')
      setDependencies(ctx, b.id, [a.id, c.id])

      shipThenArchive(ctx, a.id)
      setPhaseShipped(ctx, c.id)

      const started = await startDraft(ctx, b.id)
      expect(started.status).toBe('active')
      expect((await simpleGit(repoPath).branchLocal()).all).toContain('feature/b')
      // Started: the edges stay as history.
      expect(dependsOnOf(ctx, b.id).map((x) => x.slug).sort()).toEqual(['a', 'c'])
    })
  })

  describe('deleteFeature', () => {
    it('cascades edges both ways and records the delete on each dependent', async () => {
      const upstream = draft('upstream')
      const doomed = draft('doomed')
      const waiter = draft('waiter')
      setDependencies(ctx, doomed.id, [upstream.id])
      setDependencies(ctx, waiter.id, [doomed.id])

      await deleteFeature(ctx, doomed.id)

      expect(ctx.db.select().from(featureDependencies).all()).toEqual([])
      const deleted = listAfter(ctx, waiter.id, 0).find(
        (e) => e.type === 'feature.dependency.deleted',
      )
      expect(deleted?.message).toBe('dependency `doomed` deleted')
      expect(waitingOn(ctx, waiter.id)).toEqual([])
      expect((await startDraft(ctx, waiter.id)).status).toBe('active')
    })
  })

  it('tRPC feature.setDependencies routes to the service', async () => {
    const caller = createCallerFactory(appRouter)(ctx)
    const a = active('a')
    const b = draft('b')
    const refs = await caller.feature.setDependencies({ featureId: b.id, dependsOn: [a.id] })
    expect(refs).toEqual([
      { featureId: a.id, slug: 'a', title: a.title, phase: 'building', status: 'active', satisfied: false },
    ])
    await expect(
      caller.feature.setDependencies({ featureId: b.id, dependsOn: [b.id] }),
    ).rejects.toThrow(/cannot wait on itself/)
  })
})

function setPhaseShipped(ctx: AppCtx, featureId: string): void {
  ctx.db.update(features).set({ phase: 'shipped', status: 'shipped' }).where(eq(features.id, featureId)).run()
}

function shipThenArchive(ctx: AppCtx, featureId: string): void {
  ctx.db.update(features).set({ phase: 'shipped', status: 'archived' }).where(eq(features.id, featureId)).run()
}
