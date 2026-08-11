import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Project } from '@runcastle/core'
import { newId } from '@runcastle/core'
import { sessionDir } from '@runcastle/core/paths'
import { eq } from 'drizzle-orm'
import { simpleGit } from 'simple-git'
import type { SimpleGit } from 'simple-git'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import {
  events,
  features,
  gateOverrides,
  runs,
  sessions,
  tickets,
  waypoints,
} from '../src/db/schema'
import { listAfter, listByProject } from '../src/services/events'
import { deleteFeature } from '../src/services/features'
import { __resetTestDriveState, createFeatureBranch, ensureTalkWorktree, testDrive } from '../src/services/git'
import { useDataDir } from './helpers/data-dir'
import { makeTestCtx } from './helpers/db'
import { seedFeature, seedProject } from './helpers/fixtures'

/**
 * `feature.delete` (decision #8) at the service seam that backs the tRPC feature
 * router, against REAL git in temp fixture repos. HOME is redirected to a temp
 * dir so the talk worktree (`worktreeDir` → `~/.runcastle`) never touches the
 * developer's real data dir.
 */

const tmpDirs: string[] = []

function mkTmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tmpDirs.push(dir)
  return dir
}

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

/** Seed one row in every feature-keyed table so we can assert full cleanup. */
function seedAllRows(ctx: AppCtx, featureId: string): { sessionId: string } {
  const sessionId = newId('sess')
  ctx.db
    .insert(sessions)
    .values({
      id: sessionId,
      featureId,
      kind: 'ideation',
      ccSessionId: null,
      transcriptPath: null,
      status: 'ended',
      worktreePath: '/tmp/wt',
    })
    .run()
  ctx.db
    .insert(tickets)
    .values({
      id: newId('tick'),
      featureId,
      seq: 1,
      title: 't',
      goal: 'g',
      context: 'c',
      acceptanceCriteria: [],
      seams: [],
      blockedBy: [],
      status: 'pending',
      commits: [],
      error: null,
      attemptBranch: null,
    })
    .run()
  ctx.db
    .insert(runs)
    .values({
      id: newId('run'),
      featureId,
      workflow: 'ticket-burner',
      status: 'succeeded',
      startedAt: Date.now(),
      endedAt: Date.now(),
      summary: null,
    })
    .run()
  ctx.db
    .insert(waypoints)
    .values({
      id: newId('wp'),
      featureId,
      seq: 1,
      title: 'w',
      type: 'decision',
      question: 'q',
      blockedBy: [],
      originWaypointId: null,
      status: 'open',
      claimedBy: null,
      lastSessionId: null,
      summary: null,
    })
    .run()
  ctx.db
    .insert(gateOverrides)
    .values({ featureId, gate: 'G1', reason: 'because', ts: Date.now() })
    .run()
  return { sessionId }
}

function insertRun(ctx: AppCtx, featureId: string, status: 'running' | 'succeeded'): string {
  const id = newId('run')
  ctx.db
    .insert(runs)
    .values({
      id,
      featureId,
      workflow: 'ticket-burner',
      status,
      startedAt: Date.now(),
      endedAt: status === 'running' ? null : Date.now(),
      summary: null,
    })
    .run()
  return id
}

function rowCount(ctx: AppCtx, table: unknown, featureId: string): number {
  // Count remaining rows across a feature-keyed table via a raw select.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const t = table as any
  const key = t === features ? t.id : t.featureId
  return ctx.db.select().from(t).where(eq(key, featureId)).all().length
}

describe('feature delete', () => {
  let ctx: AppCtx
  let project: Project
  let restoreDataDir: () => void

  beforeEach(async () => {
    const home = mkTmp('rc-home-')
    restoreDataDir = useDataDir(home)

    __resetTestDriveState()
    ctx = await makeTestCtx()
    const repo = mkTmp('rc-del-')
    await initRepo(repo)
    project = seedProject(ctx, repo)
  })

  afterEach(() => {
    restoreDataDir()
    __resetTestDriveState()
    while (tmpDirs.length) {
      const dir = tmpDirs.pop()
      if (!dir) continue
      try {
        chmodSync(dir, 0o700)
      } catch {
        // best-effort — the dir may already be gone
      }
      try {
        rmSync(dir, { recursive: true, force: true })
      } catch {
        // best-effort cleanup
      }
    }
  })

  it('removes DB rows, the talk worktree, and the feature branch; leaves committed docs untouched', async () => {
    const feature = seedFeature(ctx, project.id, { slug: 'del-me', phase: 'implementation' })
    await createFeatureBranch(project, feature.slug)
    const worktree = await ensureTalkWorktree(project, feature)

    // Commit a doc on the feature branch (in the talk worktree, which already has
    // it checked out) so we can prove its blob survives in git after the delete.
    const g = simpleGit(project.repoPath)
    const wtGit = simpleGit(worktree)
    mkdirSync(join(worktree, 'docs/features/del-me'), { recursive: true })
    writeFileSync(join(worktree, 'docs/features/del-me/spec.md'), '# spec\n')
    await wtGit.add(['docs/features/del-me/spec.md'])
    const commitSha = (await wtGit.commit('docs: del-me')).commit

    const { sessionId } = seedAllRows(ctx, feature.id)
    expect(existsSync(worktree)).toBe(true)

    const res = await deleteFeature(ctx, feature.id)
    expect(res).toEqual({ ok: true, slug: 'del-me' })

    // Talk worktree gone; feature branch gone.
    expect(existsSync(worktree)).toBe(false)
    expect((await g.branchLocal()).all).not.toContain('feature/del-me')

    // Every feature-keyed table emptied.
    for (const table of [features, tickets, sessions, runs, waypoints, gateOverrides, events]) {
      expect(rowCount(ctx, table, feature.id)).toBe(0)
    }

    // The committed doc blob is still reachable in git history — no removal
    // commit, no history rewrite.
    const show = await g.raw(['show', `${commitSha}:docs/features/del-me/spec.md`])
    expect(show).toContain('# spec')

    // Session artifact dir removed.
    expect(existsSync(sessionDir(sessionId))).toBe(false)
  })

  it('deletes matching runcastle temp branches, keeps unrelated branches', async () => {
    const feature = seedFeature(ctx, project.id, { slug: 'temps', phase: 'implementation' })
    await createFeatureBranch(project, feature.slug)

    const g = simpleGit(project.repoPath)
    // Temp branches for this feature (segment = 'temps') + an unrelated branch.
    await g.branch(['runcastle/ticket/temps/1-abc', feature.branch])
    await g.branch(['runcastle/research/temps/2-def', feature.branch])
    await g.branch(['feature/other', 'main'])
    await g.branch(['runcastle/ticket/otherfeat/1-zzz', 'main'])

    await deleteFeature(ctx, feature.id)

    const branches = (await g.branchLocal()).all
    expect(branches).not.toContain('feature/temps')
    expect(branches).not.toContain('runcastle/ticket/temps/1-abc')
    expect(branches).not.toContain('runcastle/research/temps/2-def')
    // Another feature's branch + temp branch are untouched.
    expect(branches).toContain('feature/other')
    expect(branches).toContain('runcastle/ticket/otherfeat/1-zzz')
  })

  it('emits a project-scoped feature.deleted event (surviving the row deletion)', async () => {
    const feature = seedFeature(ctx, project.id, { slug: 'evt', phase: 'tickets' })
    await createFeatureBranch(project, feature.slug)

    await deleteFeature(ctx, feature.id)

    // Feature-scoped listing is empty (its rows are gone); the project stream
    // still carries the deletion event.
    expect(listAfter(ctx, feature.id, 0)).toHaveLength(0)
    const projectEvents = listByProject(ctx, project.id, 0)
    expect(projectEvents.some((e) => e.type === 'feature.deleted')).toBe(true)
  })

  it('refuses to delete a shipped feature with a clear error', async () => {
    const feature = seedFeature(ctx, project.id, { slug: 'shipped', phase: 'shipped', status: 'shipped' })

    await expect(deleteFeature(ctx, feature.id)).rejects.toThrow(/shipped/)
    // The row is untouched.
    expect(rowCount(ctx, features, feature.id)).toBe(1)
  })

  it('tears down a live session and an active run before deleting, without throwing', async () => {
    const feature = seedFeature(ctx, project.id, { slug: 'live', phase: 'implementation' })
    await createFeatureBranch(project, feature.slug)
    await ensureTalkWorktree(project, feature)

    // A live session row (no real PTY — endSession marks it ended idempotently).
    ctx.db
      .insert(sessions)
      .values({
        id: newId('sess'),
        featureId: feature.id,
        kind: 'ideation',
        ccSessionId: null,
        transcriptPath: null,
        status: 'live',
        worktreePath: '/tmp/wt',
      })
      .run()
    insertRun(ctx, feature.id, 'running')

    await expect(deleteFeature(ctx, feature.id)).resolves.toEqual({ ok: true, slug: 'live' })
    expect(rowCount(ctx, features, feature.id)).toBe(0)
    expect(rowCount(ctx, sessions, feature.id)).toBe(0)
    expect(rowCount(ctx, runs, feature.id)).toBe(0)
  })

  it('stops a test drive of THIS feature before deleting', async () => {
    const feature = seedFeature(ctx, project.id, { slug: 'drive', phase: 'review' })
    await createFeatureBranch(project, feature.slug)
    await ensureTalkWorktree(project, feature)

    const start = await testDrive(ctx, project, feature, 'start')
    expect(start.ok).toBe(true)

    await expect(deleteFeature(ctx, feature.id)).resolves.toEqual({ ok: true, slug: 'drive' })
    // The main checkout is restored off the (now deleted) feature branch.
    expect(await simpleGit(project.repoPath).revparse(['--abbrev-ref', 'HEAD'])).not.toBe(
      'feature/drive',
    )
  })

  // POSIX-only: this test makes a directory unwritable with chmod to force the
  // removal to fail. On Windows chmod does not affect directory write access,
  // so the delete succeeds and the expected throw never happens.
  it.skipIf(process.platform === 'win32')(
    'leaves the feature row present and retryable when worktree removal fails',
    async () => {
      const feature = seedFeature(ctx, project.id, { slug: 'locked', phase: 'implementation' })
      await createFeatureBranch(project, feature.slug)
      const worktree = await ensureTalkWorktree(project, feature)
      seedAllRows(ctx, feature.id)

      // Make the worktree's PARENT read-only so neither `git worktree remove` nor
      // the rmSync fallback can unlink the dir — the Linux stand-in for a Windows
      // locked file. removeTalkWorktree must throw, before any DB row is deleted.
      const parent = join(worktree, '..')
      chmodSync(parent, 0o500)
      try {
        await expect(deleteFeature(ctx, feature.id)).rejects.toThrow(/talk worktree/)
      } finally {
        chmodSync(parent, 0o700)
      }

      // Feature row + its rows survive → the delete is retryable.
      expect(rowCount(ctx, features, feature.id)).toBe(1)
      expect(rowCount(ctx, tickets, feature.id)).toBe(1)

      // Retry now succeeds (parent writable again).
      await expect(deleteFeature(ctx, feature.id)).resolves.toEqual({ ok: true, slug: 'locked' })
      expect(rowCount(ctx, features, feature.id)).toBe(0)
      expect(existsSync(worktree)).toBe(false)
    },
  )
})
