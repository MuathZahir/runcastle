import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Feature, Project } from '@runcastle/core'
import { AUTOSTART_FAILED, AUTOSTART_SKIPPED, UPNEXT_CHANGED } from '@runcastle/core'
import { eq } from 'drizzle-orm'
import { simpleGit } from 'simple-git'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { features } from '../src/db/schema'
import type { AppCtx } from '../src/db/types'
import { InvalidInputError } from '../src/errors'
import { dependsOnOf, setDependencies, setUpNext } from '../src/services/dependencies'
import { emit, listAfter } from '../src/services/events'
import { getFeatureFull, list, startDraft } from '../src/services/features'
import { getFeatureRow } from '../src/services/repo'
import { createCallerFactory } from '../src/trpc/context'
import { appRouter } from '../src/trpc/router'
import { makeTestCtx } from './helpers/db'
import { seedFeature, seedProject } from './helpers/fixtures'

/** The up-next mark (`waiting-is-not-backlog`): storage, refusals, start, wire. */

const tmpDirs: string[] = []

function mkTmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tmpDirs.push(dir)
  return dir
}

describe('up-next mark', () => {
  let ctx: AppCtx
  let project: Project
  let prevHome: string | undefined
  let prevUserProfile: string | undefined

  const draft = (slug: string): Feature =>
    seedFeature(ctx, project.id, { slug, status: 'draft', baseBranch: null })
  const active = (slug: string): Feature => seedFeature(ctx, project.id, { slug, phase: 'building' })

  beforeEach(async () => {
    const home = mkTmp('rc-home-')
    prevHome = process.env.HOME
    prevUserProfile = process.env.USERPROFILE
    process.env.HOME = home
    process.env.USERPROFILE = home

    ctx = await makeTestCtx()
    const repoPath = mkTmp('rc-repo-')
    const g = simpleGit(repoPath)
    await g.init(['-b', 'main'])
    await g.addConfig('user.email', 'test@runcastle.dev')
    await g.addConfig('user.name', 'Runcastle Test')
    await g.addConfig('core.autocrlf', 'false')
    writeFileSync(join(repoPath, 'README.md'), 'base\n')
    await g.add(['README.md'])
    await g.commit('initial commit')
    project = seedProject(ctx, repoPath)
  })

  afterEach(() => {
    process.env.HOME = prevHome
    process.env.USERPROFILE = prevUserProfile
    while (tmpDirs.length) rmSync(tmpDirs.pop() as string, { recursive: true, force: true })
  })

  it('defaults to false and sets and clears on a draft with an unshipped dependency', () => {
    const a = active('a')
    const b = draft('b')
    expect(getFeatureRow(ctx, b.id).upNext).toBe(false)
    setDependencies(ctx, b.id, [a.id])

    expect(setUpNext(ctx, b.id, true).upNext).toBe(true)
    expect(getFeatureRow(ctx, b.id).upNext).toBe(true)
    expect(setUpNext(ctx, b.id, false).upNext).toBe(false)
    expect(getFeatureRow(ctx, b.id).upNext).toBe(false)

    const changed = listAfter(ctx, b.id, 0).filter((e) => e.type === UPNEXT_CHANGED)
    expect(changed.map((e) => e.data)).toEqual([{ upNext: true }, { upNext: false }])
  })

  it('refuses a started feature and refuses the mark with nothing unshipped to wait on', () => {
    const a = active('a')
    const b = draft('b')
    expect(() => setUpNext(ctx, a.id, true)).toThrow(InvalidInputError)
    expect(() => setUpNext(ctx, b.id, true)).toThrow(/nothing unshipped to wait on/)
    expect(() => setUpNext(ctx, b.id, false)).not.toThrow()
  })

  it('keeps the mark when the dependencies are removed', () => {
    const a = active('a')
    const b = draft('b')
    setDependencies(ctx, b.id, [a.id])
    setUpNext(ctx, b.id, true)
    setDependencies(ctx, b.id, [])
    expect(getFeatureRow(ctx, b.id).upNext).toBe(true)
  })

  it('startDraft clears the mark', async () => {
    const b = draft('b')
    ctx.db.update(features).set({ upNext: true }).where(eq(features.id, b.id)).run()
    const started = await startDraft(ctx, b.id)
    expect(started.upNext).toBe(false)
    expect(getFeatureRow(ctx, b.id).upNext).toBe(false)
  })

  it('carries the mark on DependencyRef and BlockRef', () => {
    const a = draft('a')
    const b = draft('b')
    setDependencies(ctx, b.id, [a.id])
    setDependencies(ctx, a.id, [active('z').id])
    setUpNext(ctx, a.id, true)
    expect(dependsOnOf(ctx, b.id)[0].upNext).toBe(true)
    const item = list(ctx, project.id).find((f) => f.slug === 'a')
    expect(item?.blocks[0]).toMatchObject({ slug: 'b', upNext: false })
  })

  it('reports the newest autostart problem since the mark was last set, without per-row queries', () => {
    const a = active('a')
    const b = draft('b')
    setDependencies(ctx, b.id, [a.id])
    setUpNext(ctx, b.id, true)
    expect(list(ctx, project.id).find((f) => f.slug === 'b')?.upNextProblem).toBeNull()

    emit(ctx, b.id, { type: AUTOSTART_SKIPPED, message: 'mixed branches', data: {} })
    emit(ctx, b.id, { type: AUTOSTART_FAILED, message: 'git refused', data: {} })
    const listed = list(ctx, project.id).find((f) => f.slug === 'b')
    expect(listed?.upNextProblem).toBe('git refused')
    expect(getFeatureFull(ctx, b.id).upNextProblem).toBe('git refused')
    expect(list(ctx, project.id).find((f) => f.slug === 'a')?.upNextProblem).toBeNull()

    setUpNext(ctx, b.id, false)
    setUpNext(ctx, b.id, true)
    expect(list(ctx, project.id).find((f) => f.slug === 'b')?.upNextProblem).toBeNull()
  })

  it('tRPC feature.setUpNext routes to the service', async () => {
    const caller = createCallerFactory(appRouter)(ctx)
    const a = active('a')
    const b = draft('b')
    setDependencies(ctx, b.id, [a.id])
    expect((await caller.feature.setUpNext({ featureId: b.id, upNext: true })).upNext).toBe(true)
    await expect(caller.feature.setUpNext({ featureId: a.id, upNext: true })).rejects.toThrow(/already started/)
  })
})
