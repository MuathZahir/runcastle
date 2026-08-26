import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { WaypointInput, WorkflowDef } from '@runcastle/core'
import { newId } from '@runcastle/core'
import { simpleGit } from 'simple-git'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { runs } from '../src/db/schema'
import { listAfter } from '../src/services/events'
import {
  createFeatureBranch,
  detachWorktree,
  ensureTalkWorktree,
  researchBranchName,
} from '../src/services/git'
import { getRunRow } from '../src/services/repo'
import { claim, frontier, getWaypoint, storeWaypoints } from '../src/services/waypoints'
import { reconcileStaleRuns } from '../src/workflows/reconcile-runs'
import { workflowRegistry } from '../src/workflows/registry'
import { startRun } from '../src/workflows/runner'
import { useDataDir } from './helpers/data-dir'
import { makeTestCtx } from './helpers/db'
import { seedFeature, seedProject } from './helpers/fixtures'

/**
 * Boot reconciliation for runs (mirror of the stale-session tests). A crashed
 * server leaves run rows `running` forever, wedging the launcher's active-run
 * guard and keeping claimed waypoints off the frontier. `reconcileStaleRuns`
 * must fail them honestly, release their claims, reattach a detached talk
 * worktree, and sweep merged research temp branches — all without touching runs
 * genuinely in flight across a hot reload.
 */

function wp(title: string): WaypointInput {
  return { title, type: 'research', question: `q: ${title}`, blockedBy: [] }
}

function seedRunningRun(ctx: AppCtx, featureId: string, workflow = 'research'): string {
  const id = newId('run')
  ctx.db
    .insert(runs)
    .values({ id, featureId, workflow, status: 'running', startedAt: Date.now(), endedAt: null, summary: null })
    .run()
  return id
}

describe('reconcileStaleRuns — in-memory db', () => {
  let ctx: AppCtx
  let featureId: string

  beforeEach(async () => {
    ctx = await makeTestCtx()
    const project = seedProject(ctx)
    featureId = seedFeature(ctx, project.id, { mapped: true }).id
  })

  it('marks stale running runs failed, releases their waypoint claims, one event each', async () => {
    const [a] = storeWaypoints(ctx, featureId, [wp('dig')])
    const runId = seedRunningRun(ctx, featureId, 'research')
    claim(ctx, a.id, runId)

    const reconciled = await reconcileStaleRuns(ctx)
    expect(reconciled.map((r) => r.id)).toEqual([runId])

    const run = getRunRow(ctx, runId)
    expect(run.status).toBe('failed')
    expect(run.summary).toBe('orphaned by server restart')
    expect(run.endedAt).toBeGreaterThan(0)

    // the claim is back on the frontier
    expect(getWaypoint(ctx, a.id).status).toBe('open')
    expect(frontier(ctx, featureId).map((w) => w.id)).toContain(a.id)

    // exactly one run.reconciled event, tagged with the run + released ids
    const events = listAfter(ctx, featureId, 0).filter((e) => e.type === 'run.reconciled')
    expect(events).toHaveLength(1)
    expect(events[0].runId).toBe(runId)
    expect((events[0].data as { releasedWaypointIds: string[] }).releasedWaypointIds).toEqual([a.id])
  })

  it('leaves finished runs alone and is idempotent across boots', async () => {
    const runId = seedRunningRun(ctx, featureId)
    expect((await reconcileStaleRuns(ctx)).map((r) => r.id)).toEqual([runId])
    expect(await reconcileStaleRuns(ctx)).toEqual([])
    expect(listAfter(ctx, featureId, 0).filter((e) => e.type === 'run.reconciled')).toHaveLength(1)
  })

  it('skips a run genuinely in flight in this process (hot-reload safety)', async () => {
    let open!: () => void
    const gate = new Promise<void>((r) => {
      open = r
    })
    const def: WorkflowDef = {
      id: 'test-inflight',
      async run() {
        await gate
        return { status: 'succeeded', summary: 'ok' }
      },
    }
    workflowRegistry.set(def.id, def)
    try {
      const { runId, done } = await startRun(ctx, featureId, def.id)

      // boot reconciliation while the run is live must not touch it
      expect(await reconcileStaleRuns(ctx)).toEqual([])
      expect(getRunRow(ctx, runId).status).toBe('running')

      open()
      await done
      expect(getRunRow(ctx, runId).status).toBe('succeeded')
    } finally {
      workflowRegistry.delete(def.id)
    }
  })
})

describe('reconcileStaleRuns — git side effects (fixture repo)', () => {
  let ctx: AppCtx
  let restoreDataDir: () => void
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

  beforeEach(async () => {
    const home = mkTmp('rc-recrun-home-')
    restoreDataDir = useDataDir(home)
    ctx = await makeTestCtx()
  })

  afterEach(() => {
    restoreDataDir()
    while (tmpDirs.length) {
      const dir = tmpDirs.pop()
      if (dir) {
        try {
          rmSync(dir, { recursive: true, force: true })
        } catch {
          // best-effort cleanup on Windows
        }
      }
    }
  })

  it('reattaches the talk worktree a crashed branch-claiming run left detached', async () => {
    const repo = mkTmp('rc-recrun-repo-')
    await initRepo(repo)
    const project = seedProject(ctx, repo)
    const feature = seedFeature(ctx, project.id, { slug: 'stale' })
    await createFeatureBranch(project, feature.slug, 'main')
    const talkWt = await ensureTalkWorktree(project, feature)
    // the crashed burner run detached the talk worktree and never reattached it
    expect(await detachWorktree(talkWt)).toBe(true)
    const runId = seedRunningRun(ctx, feature.id, 'ticket-burner')

    const reconciled = await reconcileStaleRuns(ctx)
    expect(reconciled.map((r) => r.id)).toEqual([runId])
    expect(getRunRow(ctx, runId).status).toBe('failed')
    const head = (await simpleGit(talkWt).revparse(['--abbrev-ref', 'HEAD'])).trim()
    expect(head).toBe('feature/stale')
  })

  it('sweeps merged research temp branches at boot and keeps unmerged ones', async () => {
    const repo = mkTmp('rc-recrun-sweep-')
    await initRepo(repo)
    const project = seedProject(ctx, repo)
    seedFeature(ctx, project.id, { slug: 'swept' })
    await createFeatureBranch(project, 'swept', 'main')

    const g = simpleGit(repo)
    const merged = researchBranchName('swept', 1, 'aaa111')
    await g.raw(['branch', merged, 'feature/swept'])
    const unmerged = researchBranchName('swept', 2, 'bbb222')
    await g.raw(['branch', unmerged, 'feature/swept'])
    const wt = join(mkTmp('rc-recrun-wt-'), 'wt')
    await g.raw(['worktree', 'add', wt, unmerged])
    writeFileSync(join(wt, 'orphan.md'), 'unlanded\n')
    const gw = simpleGit(wt)
    await gw.add(['orphan.md'])
    await gw.commit('research: orphan')
    await g.raw(['worktree', 'remove', wt, '--force'])

    await reconcileStaleRuns(ctx)

    const all = (await g.branchLocal()).all
    expect(all).not.toContain(merged)
    expect(all).toContain(unmerged)
  })

  it('never throws when the project repo path is not a git repo', async () => {
    const project = seedProject(ctx) // plain temp dir, no git
    const feature = seedFeature(ctx, project.id, { slug: 'norepo' })
    seedRunningRun(ctx, feature.id, 'ticket-burner')
    await expect(reconcileStaleRuns(ctx)).resolves.toHaveLength(1)
  })
})
