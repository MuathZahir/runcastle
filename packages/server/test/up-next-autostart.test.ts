import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Feature, Project } from '@runcastle/core'
import { AUTOSTART_FAILED, AUTOSTART_SKIPPED, UPNEXT_STARTED } from '@runcastle/core'
import { simpleGit } from 'simple-git'
import type { SimpleGit } from 'simple-git'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { setDependencies, setUpNext } from '../src/services/dependencies'
import { listAfter } from '../src/services/events'
import * as gitService from '../src/services/git'
import { __resetTestDriveState, createFeatureBranch } from '../src/services/git'
import { getFeatureRow } from '../src/services/repo'
import { createCallerFactory } from '../src/trpc/context'
import { appRouter } from '../src/trpc/router'
import { useDataDir } from './helpers/data-dir'
import { makeTestCtx } from './helpers/db'
import { rmTemp, seedFeature, seedProject } from './helpers/fixtures'

/** `waiting-is-not-backlog` — a merge starts the up-next features it was the last wait of. */

const tmpDirs: string[] = []

function mkTmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tmpDirs.push(dir)
  return dir
}

let restoreEnv: (() => void) | undefined

describe('merge starts up-next dependents', () => {
  let ctx: AppCtx
  let caller: ReturnType<ReturnType<typeof createCallerFactory<typeof appRouter>>>
  let project: Project
  let g: SimpleGit

  beforeEach(async () => {
    restoreEnv = useDataDir(mkTmp('rc-home-'))
    __resetTestDriveState()
    ctx = await makeTestCtx()
    caller = createCallerFactory(appRouter)(ctx)
    const repo = mkTmp('rc-un-')
    g = simpleGit(repo)
    await g.init(['-b', 'main'])
    await g.addConfig('user.email', 'test@runcastle.dev')
    await g.addConfig('user.name', 'Runcastle Test')
    await g.addConfig('core.autocrlf', 'false')
    writeFileSync(join(repo, 'README.md'), 'base\n')
    await g.add(['README.md'])
    await g.commit('initial commit')
    project = seedProject(ctx, repo)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    __resetTestDriveState()
    restoreEnv?.()
    while (tmpDirs.length) {
      try {
        rmTemp(tmpDirs.pop() as string)
      } catch {
        // best-effort on Windows handle retention
      }
    }
  })

  /** A started feature with a real branch holding one commit, cut from `base`. */
  async function shippable(slug: string, base = 'main'): Promise<Feature> {
    await createFeatureBranch(project, slug, base)
    await g.checkout(`feature/${slug}`)
    writeFileSync(join(project.repoPath, `${slug}.txt`), `${slug}\n`)
    await g.add([`${slug}.txt`])
    await g.commit(`feat: ${slug}`)
    await g.checkout('main')
    return seedFeature(ctx, project.id, { slug, phase: 'review', baseBranch: base })
  }

  function waiting(slug: string, on: Feature[], upNext = true): Feature {
    const f = seedFeature(ctx, project.id, { slug, status: 'draft', baseBranch: null })
    setDependencies(
      ctx,
      f.id,
      on.map((d) => d.id),
    )
    if (upNext) setUpNext(ctx, f.id, true)
    return f
  }

  const events = (id: string, type: string) => listAfter(ctx, id, 0).filter((e) => e.type === type)

  it('starts the dependent from the dependency base, clears the mark, and says so on both timelines', async () => {
    const a = await shippable('a')
    const b = waiting('b', [a])

    const res = await caller.feature.merge({ featureId: a.id })

    expect(res.ok).toBe(true)
    const row = getFeatureRow(ctx, b.id)
    expect(row.status).toBe('active')
    expect(row.upNext).toBe(false)
    expect(row.baseBranch).toBe('main')
    expect((await g.branchLocal()).all).toContain('feature/b')
    const started = events(b.id, 'feature.started')[0]
    expect(started?.message).toContain('started by itself')
    expect(started?.message).toContain('`a` shipped')
    expect(started?.message).toContain('main')
    expect(started?.data).toMatchObject({ autoStartedBy: 'a' })
    expect(events(a.id, UPNEXT_STARTED)[0]?.message).toContain('`b`')
    // brief.md is written as on a normal Start
    const brief = await g.show(['feature/b:docs/features/b/brief.md'])
    expect(brief).toContain('- Slug: b')
  })

  it('waits for the last of several dependencies', async () => {
    const a = await shippable('a')
    const c = await shippable('c')
    const b = waiting('b', [a, c])

    await caller.feature.merge({ featureId: a.id })
    expect(getFeatureRow(ctx, b.id).status).toBe('draft')
    expect(getFeatureRow(ctx, b.id).upNext).toBe(true)

    await caller.feature.merge({ featureId: c.id })
    expect(getFeatureRow(ctx, b.id).status).toBe('active')
  })

  it('never starts a backlog dependent', async () => {
    const a = await shippable('a')
    const b = waiting('b', [a], false)

    const res = await caller.feature.merge({ featureId: a.id })

    expect(res.ok).toBe(true)
    expect(getFeatureRow(ctx, b.id).status).toBe('draft')
    expect(events(a.id, UPNEXT_STARTED)).toHaveLength(0)
  })

  it('starts one chain step at a time', async () => {
    const c = await shippable('c')
    const b = waiting('b', [c])
    const a = waiting('a', [b])

    await caller.feature.merge({ featureId: c.id })

    expect(getFeatureRow(ctx, b.id).status).toBe('active')
    expect(getFeatureRow(ctx, a.id).status).toBe('draft')
  })

  it('does not start when the dependencies merged into different branches', async () => {
    await g.branch(['develop', 'main'])
    const a = await shippable('a')
    const c = await shippable('c', 'develop')
    const b = waiting('b', [a, c])

    await caller.feature.merge({ featureId: a.id })
    const res = await caller.feature.merge({ featureId: c.id })

    expect(res.ok).toBe(true)
    const row = getFeatureRow(ctx, b.id)
    expect(row.status).toBe('draft')
    expect(row.upNext).toBe(true)
    const skipped = events(b.id, AUTOSTART_SKIPPED)
    expect(skipped).toHaveLength(1)
    expect(skipped[0]?.message).toContain('a → main')
    expect(skipped[0]?.message).toContain('c → develop')
  })

  it('records a failed start and still ships the dependency', async () => {
    const a = await shippable('a')
    const b = waiting('b', [a])
    vi.spyOn(gitService, 'createFeatureBranch').mockRejectedValue(new Error('git refused'))

    const res = await caller.feature.merge({ featureId: a.id })

    expect(res.ok).toBe(true)
    expect(getFeatureRow(ctx, a.id).status).toBe('shipped')
    expect(getFeatureRow(ctx, b.id).status).toBe('draft')
    expect(events(b.id, AUTOSTART_FAILED)[0]?.message).toContain('git refused')
  })
})
