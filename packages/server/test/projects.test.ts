import { beforeEach, describe, expect, it } from 'vitest'
import { newId } from '@runcastle/core'
import type { AppCtx } from '../src/db/types'
import { runs } from '../src/db/schema'
import { listAfter } from '../src/services/events'
import * as features from '../src/services/features'
import { closeProject, listProjects, openProject, renameProject } from '../src/services/projects'
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
import { join } from 'node:path'
import { simpleGit } from 'simple-git'

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
      size: 'collapsed',
    })
    await features.createFeature(ctx, {
      projectId: b.id,
      title: 'Beta feature',
      oneLiner: 'b',
      size: 'collapsed',
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

  it('a closed project reappears on re-open with its features intact', async () => {
    const path = await gitRepo()
    const project = await openProject(ctx, path)
    const feature = await features.createFeature(ctx, {
      projectId: project.id,
      title: 'Kept feature',
      oneLiner: 'k',
      size: 'collapsed',
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
      size: 'collapsed',
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

  it('mutations emit events that reflect the acting project', async () => {
    const a = await openProject(ctx, await gitRepo())
    const b = await openProject(ctx, await gitRepo())
    renameProject(ctx, b.id, 'Bee')

    // Events are keyed by the acting project's id (the events.featureId slot).
    const aTypes = listAfter(ctx, a.id, 0).map((e) => e.type)
    const bTypes = listAfter(ctx, b.id, 0).map((e) => e.type)
    expect(aTypes).toContain('project.opened')
    expect(bTypes).toContain('project.opened')
    expect(bTypes).toContain('project.renamed')
    expect(aTypes).not.toContain('project.renamed')
  })
})
