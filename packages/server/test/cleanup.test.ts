import { existsSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Feature } from '@runcastle/core'
import { dataDir } from '@runcastle/core/paths'
import type { AppCtx } from '../src/db/types'
import { workers } from '../src/db/schema'
import { createSessionRow, getSessionRow, markSessionEnded, markSessionLive } from '../src/launcher/sessions'
import { toolStartWorker } from '../src/mcp/server'
import { listByProject } from '../src/services/events'
import { setAgentHostForTests } from '../src/threads/host'
import { getWorker } from '../src/workers/service'
import { NOUNS, formatBytes, sweepLeftovers, sweptMessage } from '../src/workers/sweep'
import { useDataDir } from './helpers/data-dir'
import { makeTestCtx } from './helpers/db'
import { rmTemp, seedFeature, seedProject, tmpRepo } from './helpers/fixtures'
import { fakeHost, git, initRepo } from './support/fake-workers'

/**
 * Runcastle cleans up after itself (docs/features/runcastle-cleans-up-after-itself):
 * what the sweep removes from the host (worker folders and branches, the
 * retired burn engine's worktrees, old review captures) and what it keeps.
 * What containers left is the upgrade step's (container-leftovers.test.ts).
 */

let ctx: AppCtx
let home: string
let restoreDataDir: () => void
let repo: string
let feature: Feature
let lead: string

beforeEach(async () => {
  home = tmpRepo()
  restoreDataDir = useDataDir(home)
  ctx = await makeTestCtx()
  repo = initRepo('work')
  feature = seedFeature(ctx, seedProject(ctx, repo).id, { slug: 'work' })
  lead = createSessionRow(ctx, { featureId: feature.id, kind: 'chat', worktreePath: '/wt' }).id
  markSessionLive(ctx, lead, { ccSessionId: `cc-${lead}` })
  markSessionEnded(ctx, lead)
  setAgentHostForTests(fakeHost().host)
})

afterEach(() => {
  setAgentHostForTests(undefined)
  restoreDataDir()
  rmTemp(home)
  rmTemp(repo)
})

const leadSession = () => getSessionRow(ctx, lead)!
const sweptLines = () => listByProject(ctx, feature.projectId).filter((e) => e.type.startsWith('cleanup.'))

/** A worker row from the container era: no folder, its commits on a branch in the project repo. */
function containerEraWorker(status: 'working' | 'failed' | 'landed'): string {
  const session = createSessionRow(ctx, { featureId: feature.id, kind: 'worker', worktreePath: '/wt' })
  const branch = `runcastle/worker/${session.id}`
  git(repo, 'branch', branch, feature.branch)
  const now = Date.now()
  ctx.db
    .insert(workers)
    .values({
      id: session.id,
      featureId: feature.id,
      projectId: feature.projectId,
      label: 'Header',
      purpose: 'Header',
      kind: 'on-its-own',
      goal: 'Build the header',
      model: 'm',
      runtime: 'claude-code',
      startedBy: 'lead',
      status,
      featureBranch: feature.branch,
      branch,
      createdAt: now,
      updatedAt: now,
    })
    .run()
  return session.id
}

describe('the sweep', () => {
  it('removes the own folder of a host worker whose drop was never finished, and of no worker; keeps a live one’s and the feature’s', async () => {
    const start = async (label: string): Promise<string> =>
      (await toolStartWorker(ctx, leadSession(), { label, purpose: label, kind: 'on-its-own', goal: `Build the ${label}` })).workerId
    const first = await start('First')
    const live = await start('Live')
    const dropped = await start('Dropped')
    const featureFolder = getWorker(ctx, first)!.folder!
    // The first took the feature's folder; the others each got a worktree of their own.
    expect(getWorker(ctx, first)!.branch).toBeNull()
    const liveFolder = getWorker(ctx, live)!.folder!
    const droppedFolder = getWorker(ctx, dropped)!.folder!
    expect(liveFolder).toBe(join(dataDir(), 'workers', 'folders', live))
    const orphan = join(dataDir(), 'workers', 'folders', 'sess_gone')
    mkdirSync(orphan, { recursive: true })
    // A drop the server never finished: the row says dropped, the folder is still there.
    ctx.db.update(workers).set({ status: 'dropped' }).where(eq(workers.id, dropped)).run()

    await sweepLeftovers(ctx)

    expect(existsSync(droppedFolder)).toBe(false)
    expect(existsSync(orphan)).toBe(false)
    expect(existsSync(liveFolder)).toBe(true)
    expect(existsSync(featureFolder)).toBe(true)
    expect(git(repo, 'branch', '--list', getWorker(ctx, live)!.branch!)).toContain('runcastle/worker/')
    expect(git(repo, 'branch', '--list', getWorker(ctx, dropped)!.branch!)).toBe('')
  })

  it('removes a worker branch no row names, and a landed worker’s; keeps a failed container-era worker’s while its feature is open', async () => {
    git(repo, 'branch', 'runcastle/worker/orphan1', 'main')
    const landed = containerEraWorker('landed')
    const failed = containerEraWorker('failed')

    await sweepLeftovers(ctx)

    const branches = git(repo, 'branch', '--list', 'runcastle/worker/*')
    expect(branches).not.toContain('orphan1')
    expect(branches).not.toContain(getWorker(ctx, landed)!.branch!)
    // Its commits wait there for the lead (sandboxes-are-removed decision 4).
    expect(branches).toContain(getWorker(ctx, failed)!.branch!)
    expect(sweptLines().map((e) => e.message)).toContain('Removed 2 worker branches (0 KB)')
  })

  it('removes the burn engine’s clean worktrees and names the dirty ones once', async () => {
    const root = join(repo, '.sandcastle', 'worktrees')
    mkdirSync(root, { recursive: true })
    git(repo, 'worktree', 'add', '-q', join(root, 'clean'), '-b', 'sandcastle/clean', 'main')
    git(repo, 'worktree', 'add', '-q', join(root, 'dirty'), '-b', 'sandcastle/dirty', 'main')
    writeFileSync(join(root, 'dirty', 'wip.txt'), 'not committed\n')

    await sweepLeftovers(ctx)
    await sweepLeftovers(ctx)

    expect(existsSync(join(root, 'clean'))).toBe(false)
    expect(readFileSync(join(root, 'dirty', 'wip.txt'), 'utf8')).toBe('not committed\n')
    const kept = sweptLines().filter((e) => e.type === 'cleanup.kept')
    expect(kept).toHaveLength(1)
    expect(kept[0]!.message).toContain(join(root, 'dirty'))
  })

  it('removes stale review captures, on the project’s line', async () => {
    // A capture no row maps to, untouched for 40 days; a fresh one beside it stays.
    const stale = join(dataDir(), 'reviews', 'rev_stale')
    const fresh = join(dataDir(), 'reviews', 'rev_fresh')
    for (const dir of [stale, fresh]) {
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'shot.png'), 'x'.repeat(1000))
    }
    const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000)
    utimesSync(join(stale, 'shot.png'), old, old)
    utimesSync(stale, old, old)

    await sweepLeftovers(ctx)

    expect(existsSync(stale)).toBe(false)
    expect(existsSync(fresh)).toBe(true)
    expect(sweptLines().map((e) => e.message)).toContainEqual(expect.stringMatching(/^Removed 1 old review capture \(/))
  })

  it('runs one sweep at a time and says nothing when there is nothing to remove', async () => {
    await expect(Promise.all([sweepLeftovers(ctx), sweepLeftovers(ctx)])).resolves.toEqual([
      { removed: 0, failed: 0, freedBytes: 0 },
      { removed: 0, failed: 0, freedBytes: 0 },
    ])
    expect(sweptLines()).toEqual([])
  })

  it('says the space it freed', () => {
    const counts = new Map([
      [NOUNS.branch, 3],
      [NOUNS.worktree, 1],
    ])
    expect(sweptMessage(counts, 11.2e9, 0)).toBe('Removed 3 worker branches and 1 old worktree (11.2 GB)')
    expect(sweptMessage(counts, 11.2e9, 1)).toBe('Removed 3 worker branches and 1 old worktree (at least 11.2 GB)')
    expect(sweptMessage(counts, 0, 2)).toBe('Removed 3 worker branches and 1 old worktree (space freed unknown)')
    expect(formatBytes(340e6)).toBe('340 MB')
  })
})
