import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Feature, Project, WorkflowDef } from '@runcastle/core'
import { simpleGit } from 'simple-git'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { GateError } from '../src/errors'
import { listAfter } from '../src/services/events'
import { burn, rethink, rethinkAndLaunch } from '../src/services/features'
import { __resetTestDriveState, createFeatureBranch, testDrive } from '../src/services/git'
import { getFeatureRow } from '../src/services/repo'
import { storeTickets } from '../src/services/tickets'
import { workflowRegistry } from '../src/workflows/registry'
import { useDataDir } from './helpers/data-dir'
import { makeTestCtx } from './helpers/db'
import { seedFeature, seedProject } from './helpers/fixtures'

/**
 * Iterate (the `rethink` procedure) must never wedge a feature — findings F3/F5.
 * Two halves: the guards that refuse the lap BEFORE anything moves, and the
 * transaction that puts the feature back where it was when the lap's terminal
 * cannot be opened. `burn`'s review → implementation loop-back gets the same
 * treatment (F5), tested here beside it.
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

describe('rethink refuses while the feature is being test-driven', () => {
  let ctx: AppCtx
  let project: Project
  let feature: Feature
  let restoreDataDir: () => void

  beforeEach(async () => {
    // The talk worktree lives under `~/.runcastle` — keep it in a temp home.
    const home = mkTmp('rc-home-')
    restoreDataDir = useDataDir(home)

    ctx = await makeTestCtx()
    const repo = mkTmp('rc-drive-')
    await initRepo(repo)
    project = seedProject(ctx, repo)
    feature = seedFeature(ctx, project.id, { slug: 'driven', phase: 'review' })
    await createFeatureBranch(project, feature.slug, 'main')
  })

  afterEach(() => {
    __resetTestDriveState()
    restoreDataDir()
    for (const d of tmpDirs) rmSync(d, { recursive: true, force: true })
    tmpDirs.length = 0
  })

  it('refuses with the branch-is-checked-out reason, changing nothing', async () => {
    expect((await testDrive(ctx, project, feature, 'start')).ok).toBe(true)

    expect(() => rethink(ctx, feature.id)).toThrow(GateError)
    expect(() => rethink(ctx, feature.id)).toThrow(/stop the test drive first/)
    // Before any state change: still at review on lap 1.
    const row = getFeatureRow(ctx, feature.id)
    expect(row.phase).toBe('review')
    expect(row.lap).toBe(1)
  })

  it('allows the lap once the drive is stopped', async () => {
    await testDrive(ctx, project, feature, 'start')
    await testDrive(ctx, project, feature, 'stop')

    expect(rethink(ctx, feature.id).lap).toBe(2)
  })

  it('leaves a DIFFERENT feature`s drive alone', async () => {
    const other = seedFeature(ctx, project.id, { slug: 'other', phase: 'review' })
    await createFeatureBranch(project, other.slug, 'main')
    await testDrive(ctx, project, other, 'start')

    expect(rethink(ctx, feature.id).lap).toBe(2)
  })
})

describe('rethinkAndLaunch — the lap is committed only once its terminal opens', () => {
  let ctx: AppCtx
  let featureId: string

  beforeEach(async () => {
    ctx = await makeTestCtx()
    featureId = seedFeature(ctx, seedProject(ctx).id, { phase: 'review' }).id
  })

  it('keeps the lap when the launch succeeds, briefing it with the new lap', async () => {
    const laps: number[] = []
    const res = await rethinkAndLaunch(ctx, featureId, async (feature) => {
      laps.push(feature.lap)
      return { sessionId: 'sess_1' }
    })

    expect(res).toEqual({ sessionId: 'sess_1' })
    expect(laps).toEqual([2])
    const row = getFeatureRow(ctx, featureId)
    expect(row.phase).toBe('ideation')
    expect(row.lap).toBe(2)
  })

  it('rolls back to review on the original lap when the launch throws, and says so', async () => {
    await expect(
      rethinkAndLaunch(ctx, featureId, async () => {
        throw new Error('branch already checked out')
      }),
    ).rejects.toThrow(/branch already checked out/)

    const row = getFeatureRow(ctx, featureId)
    expect(row.phase).toBe('review')
    expect(row.lap).toBe(1)

    const aborted = listAfter(ctx, featureId, 0).find((e) => e.type === 'lap.aborted')
    expect(aborted?.message).toContain('lap 2 aborted')
    expect(aborted?.message).toContain('branch already checked out')
  })

  it('leaves a retry free to succeed — the second Iterate lands on lap 2', async () => {
    await expect(
      rethinkAndLaunch(ctx, featureId, async () => {
        throw new Error('no terminal')
      }),
    ).rejects.toThrow()

    const res = await rethinkAndLaunch(ctx, featureId, async () => ({ sessionId: 'sess_2' }))
    expect(res).toEqual({ sessionId: 'sess_2' })
    const row = getFeatureRow(ctx, featureId)
    expect(row.phase).toBe('ideation')
    expect(row.lap).toBe(2)
  })
})

describe('burn`s review → implementation loop-back is transactional too', () => {
  let ctx: AppCtx
  let featureId: string
  let original: WorkflowDef | undefined

  beforeEach(async () => {
    ctx = await makeTestCtx()
    featureId = seedFeature(ctx, seedProject(ctx).id, { phase: 'review' }).id
    storeTickets(ctx, featureId, [
      { title: 'fix', goal: 'g', context: 'c', acceptanceCriteria: ['a'], seams: [], blockedBy: [] },
    ])
    original = workflowRegistry.get('ticket-burner')
    // No burner registered → `startRun` throws before any run row exists.
    workflowRegistry.delete('ticket-burner')
  })

  afterEach(() => {
    if (original) workflowRegistry.set('ticket-burner', original)
  })

  it('restores review when startRun throws', async () => {
    await expect(burn(ctx, featureId)).rejects.toThrow(/ticket-burner/)

    expect(getFeatureRow(ctx, featureId).phase).toBe('review')
    const aborted = listAfter(ctx, featureId, 0).find((e) => e.type === 'burn.aborted')
    expect(aborted?.message).toContain('never started')
  })
})
