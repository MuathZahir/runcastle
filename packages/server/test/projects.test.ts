import { beforeEach, describe, expect, it } from 'vitest'
import { newId, PROJECT_NAME_MAX } from '@runcastle/core'
import type { AppCtx } from '../src/db/types'
import { createCallerFactory } from '../src/trpc/context'
import { appRouter } from '../src/trpc/router'
import { runs } from '../src/db/schema'
import { listByProject } from '../src/services/events'
import * as features from '../src/services/features'
import {
  closeProject,
  isTranslatedWindowsMount,
  listProjects,
  openProject,
  renameProject,
} from '../src/services/projects'
import { makeTestCtx } from './helpers/db'
import { tmpRepo } from './helpers/fixtures'

/**
 * Multi-project CRUD (issue #43): `openProject` upserts by repo path, `close`
 * hides a project (refusing while runs are in flight), `list` returns only open
 * projects, `rename` sets the display name. Feature create/list are scoped by an
 * explicit project id. `gitRepo()` gives each project a real repo with a seed
 * commit on `main`, which the now-live git service needs to branch features.
 */

import { writeFileSync } from 'node:fs'
import { join, sep } from 'node:path'
import { eq } from 'drizzle-orm'
import { simpleGit } from 'simple-git'
import { projects as projectsTable } from '../src/db/schema'

/**
 * A real git repo with a seed commit on `main` — `openProject`'s repo check and
 * (once B2 is live) `createFeature`'s branch creation both need this.
 */
async function gitRepo(): Promise<string> {
  const dir = tmpRepo()
  const g = simpleGit(dir)
  await g.init(['-b', 'main'])
  await g.addConfig('user.email', 'test@runcastle.dev')
  await g.addConfig('user.name', 'Runcastle Test')
  await g.addConfig('core.autocrlf', 'false')
  writeFileSync(join(dir, 'README.md'), 'base\n')
  await g.add(['README.md'])
  await g.commit('initial commit')
  return dir
}

function seedRunningRun(ctx: AppCtx, featureId: string): string {
  const id = newId('run')
  ctx.db
    .insert(runs)
    .values({
      id,
      featureId,
      workflow: 'ticket-burner',
      status: 'running',
      startedAt: Date.now(),
      endedAt: null,
      summary: null,
    })
    .run()
  return id
}

describe('projects service — multi-project CRUD (#43)', () => {
  let ctx: AppCtx

  beforeEach(async () => {
    ctx = await makeTestCtx()
  })

  it('opens two projects, each listing only its own features', async () => {
    const a = await openProject(ctx, await gitRepo())
    const b = await openProject(ctx, await gitRepo())
    expect(a.id).not.toBe(b.id)

    await features.createFeature(ctx, {
      projectId: a.id,
      title: 'Alpha feature',
      oneLiner: 'a',
    })
    await features.createFeature(ctx, {
      projectId: b.id,
      title: 'Beta feature',
      oneLiner: 'b',
    })

    expect(features.list(ctx, a.id).map((f) => f.title)).toEqual(['Alpha feature'])
    expect(features.list(ctx, b.id).map((f) => f.title)).toEqual(['Beta feature'])
  })

  it('re-opening a known path returns the same project (no duplicate)', async () => {
    const path = await gitRepo()
    const first = await openProject(ctx, path)
    const again = await openProject(ctx, path)

    expect(again.id).toBe(first.id)
    expect(listProjects(ctx)).toHaveLength(1)
  })

  // Path normalization (repo picker): the picker always submits a resolved
  // absolute path while a human types `~/repo`, `repo/`, or `C:/repo`. Upserting
  // on the raw string filed those as separate projects.
  it('treats a trailing separator as the same project', async () => {
    const path = await gitRepo()
    const first = await openProject(ctx, path)
    const again = await openProject(ctx, `${path}${sep}`)

    expect(again.id).toBe(first.id)
    expect(listProjects(ctx)).toHaveLength(1)
  })

  it('treats a path with relative segments as the same project', async () => {
    const path = await gitRepo()
    const first = await openProject(ctx, path)
    const again = await openProject(ctx, join(path, 'sub', '..'))

    expect(again.id).toBe(first.id)
    expect(listProjects(ctx)).toHaveLength(1)
  })

  it('stores the normalized path, so the picker and a typed path agree', async () => {
    const path = await gitRepo()
    const project = await openProject(ctx, `${path}${sep}`)
    expect(project.repoPath).toBe(path)
  })

  it('matches a legacy row stored un-normalized instead of forking it', async () => {
    // Simulates a project written by an older build: the row holds the raw
    // string, and re-opening the canonical path must converge onto it.
    const path = await gitRepo()
    const first = await openProject(ctx, path)
    ctx.db
      .update(projectsTable)
      .set({ repoPath: `${path}${sep}` })
      .where(eq(projectsTable.id, first.id))
      .run()

    const again = await openProject(ctx, path)
    expect(again.id).toBe(first.id)
    expect(again.repoPath).toBe(path)
    expect(listProjects(ctx)).toHaveLength(1)
  })

  it('a closed project reappears on re-open with its features intact', async () => {
    const path = await gitRepo()
    const project = await openProject(ctx, path)
    const feature = await features.createFeature(ctx, {
      projectId: project.id,
      title: 'Kept feature',
      oneLiner: 'k',
    })

    closeProject(ctx, project.id)
    expect(listProjects(ctx).map((p) => p.id)).not.toContain(project.id)

    const reopened = await openProject(ctx, path)
    expect(reopened.id).toBe(project.id)
    expect(listProjects(ctx).map((p) => p.id)).toContain(project.id)
    expect(features.list(ctx, project.id).map((f) => f.id)).toEqual([feature.id])
  })

  it('close refuses (destroying nothing) while a run is in flight', async () => {
    const project = await openProject(ctx, await gitRepo())
    const feature = await features.createFeature(ctx, {
      projectId: project.id,
      title: 'Busy feature',
      oneLiner: 'b',
    })
    seedRunningRun(ctx, feature.id)

    expect(() => closeProject(ctx, project.id)).toThrow(/run/i)
    // nothing destroyed: still open, feature intact
    expect(listProjects(ctx).map((p) => p.id)).toContain(project.id)
    expect(features.list(ctx, project.id).map((f) => f.id)).toEqual([feature.id])
  })

  it('rename sets the display name', async () => {
    const project = await openProject(ctx, await gitRepo())
    const renamed = renameProject(ctx, project.id, 'Renamed')
    expect(renamed.name).toBe('Renamed')
    expect(listProjects(ctx).find((p) => p.id === project.id)?.name).toBe('Renamed')
  })

  // A 324-char rename used to be accepted and pushed the whole workspace
  // off-canvas (findings F20). The cap lives on the procedure input, so the
  // router is the seam: the name never reaches the service.
  it('project.rename refuses a name over the cap, and keeps the old one', async () => {
    const caller = createCallerFactory(appRouter)(ctx)
    const project = await openProject(ctx, await gitRepo())
    const tooLong = 'x'.repeat(PROJECT_NAME_MAX + 1)

    await expect(
      caller.project.rename({ projectId: project.id, name: tooLong }),
    ).rejects.toThrow(new RegExp(`at most ${PROJECT_NAME_MAX} characters`))
    expect(listProjects(ctx).find((p) => p.id === project.id)?.name).toBe(project.name)
  })

  it('project.rename accepts a name exactly at the cap', async () => {
    const caller = createCallerFactory(appRouter)(ctx)
    const project = await openProject(ctx, await gitRepo())
    const atCap = 'y'.repeat(PROJECT_NAME_MAX)

    const renamed = await caller.project.rename({ projectId: project.id, name: atCap })
    expect(renamed.name).toBe(atCap)
  })

  // The silent WSL trap (ADR-0005): from inside WSL a /mnt/<drive> repo works
  // with no error while every git/install/burn operation pays the 9P per-file
  // tax. openProject warns via a `project.slow-path` event; the predicate is
  // pure so the Linux-only branch is testable from any host.
  it('flags /mnt/<drive> repo paths on Linux only (the WSL DrvFS trap)', () => {
    expect(isTranslatedWindowsMount('/mnt/c/Users/me/repo', 'linux')).toBe(true)
    expect(isTranslatedWindowsMount('/mnt/D/work', 'linux')).toBe(true)
    expect(isTranslatedWindowsMount('/mnt/c', 'linux')).toBe(true)
    // /mnt/wsl, /mnt/media etc. are not translated Windows drives
    expect(isTranslatedWindowsMount('/mnt/wsl/instances', 'linux')).toBe(false)
    expect(isTranslatedWindowsMount('/home/me/repo', 'linux')).toBe(false)
    expect(isTranslatedWindowsMount('/mnt/c/repo', 'win32')).toBe(false)
    expect(isTranslatedWindowsMount('C:\\Users\\me\\repo', 'win32')).toBe(false)
  })

  it('mutations emit events that reflect the acting project', async () => {
    const a = await openProject(ctx, await gitRepo())
    const b = await openProject(ctx, await gitRepo())
    renameProject(ctx, b.id, 'Bee')

    // Project-level events carry the acting project's id (issue #44).
    const aTypes = listByProject(ctx, a.id, 0).map((e) => e.type)
    const bTypes = listByProject(ctx, b.id, 0).map((e) => e.type)
    expect(aTypes).toContain('project.opened')
    expect(bTypes).toContain('project.opened')
    expect(bTypes).toContain('project.renamed')
    expect(aTypes).not.toContain('project.renamed')
  })
})
