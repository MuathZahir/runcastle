import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { lstat, readdir } from 'node:fs/promises'
import type { WorkerRow } from '@runcastle/core'
import { dataDir as installDataDir } from '@runcastle/core/paths'
import { sql } from 'drizzle-orm'
import { projects, workers } from '../db/schema'
import type { AppCtx } from '../db/types'
import { emitProject } from '../services/events'
import { discardWorktree } from '../services/git'
import { expireReviewCaptures } from '../services/review-capture-expiry'
import { tryGetFeature } from '../services/repo'
import { isSettingUp } from './service'

/**
 * The sweep (runcastle-cleans-up-after-itself decisions 5, 6, 10): one pass
 * over what runcastle may have left behind on the host (worker folders and
 * branches, the retired burn engine's worktrees, old review captures), removing what this install no longer needs,
 * by its worker rows. It runs at server start and every hour. Serialised,
 * never throws: a removal that fails is a `cleanup.failed` event, and one
 * `cleanup.swept` event per project says what went and the space it freed.
 * What the container era left is the upgrade step's ({@link ./container-leftovers}).
 */

const execFileP = promisify(execFile)

/** What one kind of removed thing is called in the timeline line. */
export interface Noun {
  one: string
  many: string
}

export const NOUNS = {
  branch: { one: 'worker branch', many: 'worker branches' },
  worktree: { one: 'old worktree', many: 'old worktrees' },
  capture: { one: 'old review capture', many: 'old review captures' },
} as const satisfies Record<string, Noun>

export interface SweepOptions {
  /** This install's data folder; `dataDir()` by default. */
  dataDir?: string
}

export interface SweepResult {
  removed: number
  failed: number
  freedBytes: number
}

let chain: Promise<unknown> = Promise.resolve()

/** Sweep for leftovers. Calls queue behind each other, so two never run at once; never rejects. */
export function sweepLeftovers(ctx: AppCtx, opts: SweepOptions = {}): Promise<SweepResult> {
  const next = chain.then(() => sweepOnce(ctx, opts))
  chain = next.catch(() => {})
  return next
}

/** Sweep once an hour from now; returns what stops it. The timer never holds the process open. */
export function startHourlySweep(ctx: AppCtx, everyMs = 60 * 60_000): () => void {
  const timer = setInterval(() => void sweepLeftovers(ctx), everyMs)
  timer.unref?.()
  return () => clearInterval(timer)
}

// --- the tally ------------------------------------------------------------------

interface ProjectTally {
  counts: Map<Noun, number>
  bytes: number
  unknown: number
  failures: string[]
}

class Tally {
  readonly byProject = new Map<string | undefined, ProjectTally>()
  constructor(readonly dataDir: string) {}

  private of(projectId: string | undefined): ProjectTally {
    let t = this.byProject.get(projectId)
    if (!t) this.byProject.set(projectId, (t = { counts: new Map(), bytes: 0, unknown: 0, failures: [] }))
    return t
  }

  /** One thing removed; `bytes` measured before the removal, undefined when it could not be. */
  removed(projectId: string | undefined, noun: Noun, bytes: number | undefined): void {
    const t = this.of(projectId)
    t.counts.set(noun, (t.counts.get(noun) ?? 0) + 1)
    if (bytes === undefined) t.unknown++
    else t.bytes += bytes
  }

  /** A removal that failed: it becomes part of the project's `cleanup.failed` line. */
  failed(projectId: string | undefined, what: string, err: unknown): void {
    this.of(projectId).failures.push(`${what}: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`)
  }
}

/** `1.2 GB`, `340 MB`, `12 KB`. */
export function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`
  if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} MB`
  return `${Math.max(0, Math.round(bytes / 1e3))} KB`
}

/** "Removed 3 worker branches and 1 old worktree (11.2 GB)". */
export function sweptMessage(counts: ReadonlyMap<Noun, number>, bytes: number, unknown: number): string {
  const parts = [...counts].map(([noun, n]) => `${n} ${n === 1 ? noun.one : noun.many}`)
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : (parts[0] ?? 'nothing')
  const size = unknown === 0 ? formatBytes(bytes) : bytes > 0 ? `at least ${formatBytes(bytes)}` : 'space freed unknown'
  return `Removed ${list} (${size})`
}

// --- the sweep ------------------------------------------------------------------

async function sweepOnce(ctx: AppCtx, opts: SweepOptions): Promise<SweepResult> {
  const tally = new Tally(opts.dataDir ?? installDataDir())
  try {
    const rows = ctx.db.select().from(workers).all()
    const projectRows = ctx.db.select().from(projects).all()
    const projectIds = new Set(projectRows.map((p) => p.id))
    const project = (id: string | undefined): string | undefined => (id && projectIds.has(id) ? id : undefined)
    await sweepWorkerFolders(ctx, tally, rows, projectRows)
    await sweepBranches(ctx, tally, rows, projectRows)
    await sweepSandcastleWorktrees(ctx, tally, projectRows)
    sweepReviewCaptures(ctx, tally, project)
  } catch (err) {
    tally.failed(undefined, 'the sweep', err)
  }
  return report(ctx, tally)
}

/** Review captures 30 days after their feature closed, or at once when it is gone (decision 10). */
function sweepReviewCaptures(ctx: AppCtx, tally: Tally, project: (id: string | undefined) => string | undefined): void {
  const out = expireReviewCaptures({ db: ctx.db, now: Date.now(), dataDir: tally.dataDir })
  for (const c of out.removed) tally.removed(project(c.projectId ?? undefined), NOUNS.capture, c.bytes)
  for (const f of out.failed) tally.failed(undefined, `review capture ${f.id}`, f.error)
}

/** Each project's line: one `cleanup.swept` for what went, one `cleanup.failed` for what would not go. */
function report(ctx: AppCtx, tally: Tally): SweepResult {
  const result: SweepResult = { removed: 0, failed: 0, freedBytes: 0 }
  // What no project of this install can be named for goes on its oldest project.
  const fallback = ctx.db.select({ id: projects.id }).from(projects).orderBy(sql`rowid`).limit(1).get()?.id
  const merged = new Map<string, ProjectTally>()
  for (const [id, t] of tally.byProject) {
    const to = id ?? fallback
    const removed = [...t.counts.values()].reduce((a, b) => a + b, 0)
    result.removed += removed
    result.failed += t.failures.length
    result.freedBytes += t.bytes
    if (!to) {
      if (removed + t.failures.length) console.log(`cleanup: ${sweptMessage(t.counts, t.bytes, t.unknown)}${t.failures.length ? `; failed: ${t.failures.join('; ')}` : ''}`)
      continue
    }
    const m: ProjectTally = merged.get(to) ?? { counts: new Map(), bytes: 0, unknown: 0, failures: [] }
    for (const [noun, n] of t.counts) m.counts.set(noun, (m.counts.get(noun) ?? 0) + n)
    m.bytes += t.bytes
    m.unknown += t.unknown
    m.failures.push(...t.failures)
    merged.set(to, m)
  }
  for (const [projectId, t] of merged) {
    try {
      if (t.counts.size) {
        emitProject(ctx, projectId, {
          type: 'cleanup.swept',
          message: sweptMessage(t.counts, t.bytes, t.unknown),
          data: { removed: Object.fromEntries([...t.counts].map(([noun, n]) => [noun.many, n])), freedBytes: t.bytes, sizeUnknown: t.unknown },
        })
      }
      if (t.failures.length) {
        emitProject(ctx, projectId, {
          type: 'cleanup.failed',
          message: `Cleanup could not remove ${t.failures.length} thing${t.failures.length === 1 ? '' : 's'}: ${t.failures.join('; ').slice(0, 1500)}`,
          data: { failures: t.failures },
        })
      }
    } catch (err) {
      console.error('cleanup: could not record the sweep', err)
    }
  }
  return result
}

const TERMINAL = new Set(['landed', 'dropped'])

/** Whether a worker row's folder and branch are no longer needed: landed, dropped, failed during setup, or its feature closed or gone. */
function workerDone(ctx: AppCtx, w: WorkerRow): boolean {
  if (TERMINAL.has(w.status)) return true
  if (!w.branch && !isSettingUp(w.id)) return true
  if (w.featureId === null) return false
  const f = tryGetFeature(ctx, w.featureId)
  return !f || f.status === 'shipped' || f.status === 'archived'
}

/** Bytes under `path`, walked without following links (no `du`, so Windows says too); undefined when it cannot be read at all. */
export async function folderBytes(path: string): Promise<number | undefined> {
  let bytes = 0
  const pending = [path]
  try {
    await lstat(path)
  } catch {
    return undefined
  }
  while (pending.length > 0) {
    const current = pending.pop() as string
    try {
      const st = await lstat(current)
      if (st.isDirectory()) for (const name of await readdir(current)) pending.push(join(current, name))
      else bytes += st.size
    } catch {
      // What could not be read counts as nothing.
    }
  }
  return bytes
}

async function git(repo: string, args: string[]): Promise<string> {
  return (await execFileP('git', ['-C', repo, ...args], { maxBuffer: 8 * 1024 * 1024 })).stdout
}

/**
 * A host worker's own folder (workers-build-in-the-feature-s-folder decision 3) left behind by a landing or drop
 * the server never finished: a folder whose worker is gone, landed or dropped, or whose feature is over. Removed
 * before the branches, which git will not delete while a folder holds them.
 */
async function sweepWorkerFolders(ctx: AppCtx, tally: Tally, rows: WorkerRow[], projectRows: { id: string; repoPath: string }[]): Promise<void> {
  const root = join(tally.dataDir, 'workers', 'folders')
  if (!existsSync(root)) return
  for (const name of readdirSync(root)) {
    const row = rows.find((r) => r.id === name)
    if (row && (isSettingUp(row.id) || !workerDone(ctx, row))) continue
    const path = join(root, name)
    const repoPath = projectRows.find((p) => p.id === row?.projectId)?.repoPath
    try {
      const bytes = await folderBytes(path)
      if (repoPath && existsSync(repoPath)) await discardWorktree(repoPath, path)
      if (existsSync(path)) rmSync(path, { recursive: true, force: true })
      if (repoPath && existsSync(repoPath)) await git(repoPath, ['worktree', 'prune']).catch(() => {})
      tally.removed(row?.projectId, NOUNS.worktree, bytes)
    } catch (err) {
      tally.failed(row?.projectId, `worker folder ${path}`, err)
    }
  }
}

/** `runcastle/worker/*` branches in each project's repo whose worker is unknown or no longer needs them. */
async function sweepBranches(ctx: AppCtx, tally: Tally, rows: WorkerRow[], projectRows: { id: string; repoPath: string }[]): Promise<void> {
  for (const p of projectRows) {
    if (!existsSync(p.repoPath)) continue
    let branches: string[]
    try {
      branches = (await git(p.repoPath, ['for-each-ref', '--format=%(refname:short)', 'refs/heads/runcastle/worker/'])).split('\n').map((b) => b.trim()).filter(Boolean)
    } catch {
      continue
    }
    for (const branch of branches) {
      const row = rows.find((r) => r.branch === branch)
      if (row && (isSettingUp(row.id) || !workerDone(ctx, row))) continue
      try {
        await git(p.repoPath, ['branch', '-D', branch])
        tally.removed(p.id, NOUNS.branch, 0)
      } catch (err) {
        tally.failed(p.id, `branch ${branch}`, err)
      }
    }
  }
}

/**
 * The retired burn engine's worktrees inside each project's repo
 * (`.sandcastle/worktrees/*`, decision 7): removed when `git status` shows
 * nothing uncommitted; the others are named in one `cleanup.kept` line, said
 * again only when that list changes.
 */
async function sweepSandcastleWorktrees(ctx: AppCtx, tally: Tally, projectRows: { id: string; repoPath: string }[]): Promise<void> {
  const keptFile = join(tally.dataDir, 'cleanup', 'sandcastle-kept.json')
  let said: Record<string, string[]> = {}
  try {
    said = JSON.parse(readFileSync(keptFile, 'utf8')) as Record<string, string[]>
  } catch {}
  let changed = false
  for (const p of projectRows) {
    const root = join(p.repoPath, '.sandcastle', 'worktrees')
    if (!existsSync(root)) continue
    const dirty: string[] = []
    for (const name of readdirSync(root)) {
      const wt = join(root, name)
      let clean: boolean
      try {
        clean = (await git(wt, ['status', '--porcelain'])).trim() === ''
      } catch {
        clean = false
      }
      if (!clean) {
        dirty.push(wt)
        continue
      }
      const bytes = await folderBytes(wt)
      try {
        await git(p.repoPath, ['worktree', 'remove', '--force', wt]).catch(async () => {
          rmSync(wt, { recursive: true, force: true })
          await git(p.repoPath, ['worktree', 'prune']).catch(() => {})
        })
        tally.removed(p.id, NOUNS.worktree, bytes)
      } catch (err) {
        tally.failed(p.id, `worktree ${wt}`, err)
      }
    }
    const before = (said[p.id] ?? []).join('\n')
    if (dirty.join('\n') === before) continue
    said[p.id] = dirty
    changed = true
    if (dirty.length) {
      emitProject(ctx, p.id, {
        type: 'cleanup.kept',
        message: `Kept ${dirty.length} old worktree${dirty.length === 1 ? '' : 's'} with uncommitted changes: ${dirty.join(', ')}`,
        data: { worktrees: dirty },
      })
    }
  }
  if (!changed) return
  try {
    mkdirSync(dirname(keptFile), { recursive: true })
    writeFileSync(keptFile, JSON.stringify(said))
  } catch {}
}
