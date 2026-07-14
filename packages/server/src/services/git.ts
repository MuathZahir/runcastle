import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, realpathSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type { Feature, Project } from '@runcastle/core'
import { worktreeDir } from '@runcastle/core'
import { simpleGit } from 'simple-git'
import type { SimpleGit } from 'simple-git'
import type { AppCtx } from '../db/types'
import { GateError, InvalidInputError } from '../errors'
import { emit } from './events'
import { hasActiveRun } from './repo'

/**
 * Git service (SPEC §7) — the only wave-B service that shells out to real git
 * (via `simple-git`). It manages the feature-branch / talk-worktree lifecycle
 * plus the two human gates that touch the working copy: the checkout-switch
 * "test drive" and the `--no-ff` merge back to the main branch.
 *
 * Path handling is Windows-safe: repo paths are computed with `node:path` and
 * compared against `git worktree list` output through `canon()`, which collapses
 * slash direction, casing and 8.3 short-paths to a single canonical form.
 *
 * Event note: only `testDrive` receives an `AppCtx`, so it is the only function
 * here that emits timeline events directly. The other mutations
 * (`createFeatureBranch`, `ensureTalkWorktree`, `commitDocs`, `mergeFeature`)
 * are called with `project`/`worktreePath` and no `ctx`; their events are
 * emitted at the A1 call sites (`features.createFeature`, the feature tRPC
 * router) — we do not widen the pinned signatures to inject `ctx`.
 */

export interface TestDriveResult {
  ok: boolean
  deniedReason?: string
  branch?: string
}

export interface MergeResult {
  ok: boolean
  conflict?: boolean
}

/** Repo-relative dir (forward slashes) holding every feature's knowledge docs. */
const DOCS_PATHSPEC = 'docs/features'

/** Human-readable test-drive denial reasons (surfaced verbatim in the UI). */
const DENY_DIRTY = 'Working tree has uncommitted changes — commit or stash first'
const DENY_ACTIVE = 'A test drive is already active — stop it first'
const DENY_ACTIVE_RUN = 'Feature has an active run — wait for it to finish'
const DENY_NONE_ACTIVE = 'No test drive is active'

/** Branch name for a feature slug. */
function featureBranch(slug: string): string {
  return `feature/${slug}`
}

function git(repoPath: string): SimpleGit {
  return simpleGit(repoPath)
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/** Canonical path key: absolute, forward-slashed, lower-cased, 8.3-expanded. */
function canon(p: string): string {
  let abs = resolve(p)
  try {
    abs = realpathSync.native(abs)
  } catch {
    // Path may not exist (stale registry entry) — fall back to the resolved form.
  }
  return abs.replace(/\\/g, '/').toLowerCase()
}

// --- repo detection ---------------------------------------------------------

/** Assert `repoPath` is a git repository (else throw `InvalidInputError`). */
export async function assertRepo(repoPath: string): Promise<void> {
  if (!existsSync(repoPath)) {
    throw new InvalidInputError(`path does not exist: ${repoPath}`)
  }
  let isRepo = false
  try {
    isRepo = await git(repoPath).checkIsRepo()
  } catch (e) {
    throw new InvalidInputError(`not a git repository: ${repoPath} (${errMsg(e)})`)
  }
  if (!isRepo) throw new InvalidInputError(`not a git repository: ${repoPath}`)
}

/**
 * Detect the repo's main branch: prefer origin's default, then a local
 * `main`/`master`, then the currently checked-out branch, then `main`.
 */
export async function detectMainBranch(repoPath: string): Promise<string> {
  const g = git(repoPath)
  try {
    const ref = (await g.raw(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])).trim()
    const name = ref.replace(/^origin\//, '')
    if (name) return name
  } catch {
    // no origin/HEAD — fall through to local heuristics
  }
  try {
    const branches = await g.branchLocal()
    if (branches.all.includes('main')) return 'main'
    if (branches.all.includes('master')) return 'master'
  } catch {
    // unborn / empty repo — fall through
  }
  try {
    const cur = (await g.revparse(['--abbrev-ref', 'HEAD'])).trim()
    if (cur && cur !== 'HEAD') return cur
  } catch {
    // detached / unborn HEAD
  }
  return 'main'
}

// --- feature branch ---------------------------------------------------------

/**
 * Create branch `feature/<slug>` from `project.mainBranch` WITHOUT switching the
 * main working copy (`git branch <name> <mainBranch>`). Idempotent: if the
 * branch already exists this is a no-op. Returns the branch name.
 */
export async function createFeatureBranch(project: Project, slug: string): Promise<string> {
  const branch = featureBranch(slug)
  const g = git(project.repoPath)
  const branches = await g.branchLocal()
  if (branches.all.includes(branch)) return branch
  await g.raw(['branch', branch, project.mainBranch])
  return branch
}

// --- talk worktree ----------------------------------------------------------

/**
 * Ensure the feature's talk worktree exists at `worktreeDir(projectId, slug)`
 * checked out to `feature/<slug>`. Reuses a valid existing worktree; on a
 * stale/corrupt state (dir gone but still registered, etc.) prunes the worktree
 * registry and retries once, erroring clearly if that also fails.
 */
export async function ensureTalkWorktree(project: Project, feature: Feature): Promise<string> {
  const worktreePath = worktreeDir(project.id, feature.slug)
  const branch = featureBranch(feature.slug)
  const g = git(project.repoPath)

  // The worktree can only be checked out to an existing branch.
  await ensureBranchExists(g, branch, project.mainBranch)

  if (await worktreeIsValid(g, worktreePath, branch)) return worktreePath

  mkdirSync(dirname(worktreePath), { recursive: true })

  try {
    await g.raw(['worktree', 'add', worktreePath, branch])
    return worktreePath
  } catch {
    // Stale registry (e.g. the dir was deleted out from under git): prune, retry.
    try {
      await g.raw(['worktree', 'prune'])
    } catch {
      // best-effort — a failed prune just means the retry below will surface it
    }
    try {
      await g.raw(['worktree', 'add', worktreePath, branch])
      return worktreePath
    } catch (e) {
      throw new InvalidInputError(
        `could not create talk worktree at ${worktreePath}: ${errMsg(e)}`,
      )
    }
  }
}

async function ensureBranchExists(g: SimpleGit, branch: string, from: string): Promise<void> {
  const branches = await g.branchLocal()
  if (!branches.all.includes(branch)) {
    await g.raw(['branch', branch, from])
  }
}

/** A worktree is valid iff it exists on disk, git still tracks it, and its HEAD
 *  is the expected feature branch. */
async function worktreeIsValid(
  g: SimpleGit,
  worktreePath: string,
  branch: string,
): Promise<boolean> {
  if (!existsSync(worktreePath)) return false
  const registered = await registeredWorktrees(g)
  if (!registered.has(canon(worktreePath))) return false
  try {
    const head = (await git(worktreePath).revparse(['--abbrev-ref', 'HEAD'])).trim()
    return head === branch
  } catch {
    return false
  }
}

/** Canonical paths of all worktrees git currently tracks for this repo. */
async function registeredWorktrees(g: SimpleGit): Promise<Set<string>> {
  const set = new Set<string>()
  let out = ''
  try {
    out = await g.raw(['worktree', 'list', '--porcelain'])
  } catch {
    return set
  }
  for (const line of out.split('\n')) {
    const m = line.match(/^worktree\s+(.+)$/)
    if (m) set.add(canon(m[1].trim()))
  }
  return set
}

// --- docs checkpoint --------------------------------------------------------

/**
 * Stage ONLY `docs/features/**` within `worktreePath` and commit if anything is
 * staged there (no-op otherwise). Uses a pathspec commit so pre-staged changes
 * to other paths are never swept into the commit.
 */
export async function commitDocs(worktreePath: string, message: string): Promise<void> {
  if (!existsSync(resolve(worktreePath, DOCS_PATHSPEC))) return
  const g = git(worktreePath)
  await g.add([DOCS_PATHSPEC])

  const staged = (await g.raw(['diff', '--cached', '--name-only']))
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
  const docsStaged = staged.some((p) => p.startsWith(`${DOCS_PATHSPEC}/`))
  if (!docsStaged) return

  // Pathspec commit: only docs/features changes land, other staged paths stay put.
  await g.commit(message, [DOCS_PATHSPEC])
}

// --- test drive -------------------------------------------------------------

/** Module-level in-memory test-drive state (SPEC §7). At most one active. */
let testDriveState: { featureId: string; previousBranch: string } | undefined

/** Test-only: clear the in-memory test-drive state (not called by any router). */
export function __resetTestDriveState(): void {
  testDriveState = undefined
}

/**
 * Guarded checkout-switch test drive of the feature branch on the MAIN checkout
 * (SPEC §7). `start` records the current branch and switches to the feature
 * branch after passing the deny checks; `stop` restores the recorded branch.
 */
export async function testDrive(
  ctx: AppCtx,
  project: Project,
  feature: Feature,
  action: 'start' | 'stop',
): Promise<TestDriveResult> {
  const g = git(project.repoPath)
  const branch = featureBranch(feature.slug)

  if (action === 'stop') {
    if (!testDriveState) return { ok: false, deniedReason: DENY_NONE_ACTIVE }
    const previousBranch = testDriveState.previousBranch
    await g.checkout(previousBranch)
    testDriveState = undefined
    emit(ctx, feature.id, {
      type: 'testdrive.stopped',
      message: `test drive stopped — back on ${previousBranch}`,
      data: { branch: previousBranch },
    })
    return { ok: true, branch: previousBranch }
  }

  // action === 'start' — deny checks in SPEC order: dirty | active | active-run.
  const porcelain = (await g.raw(['status', '--porcelain'])).trim()
  if (porcelain !== '') return { ok: false, deniedReason: DENY_DIRTY }
  if (testDriveState) return { ok: false, deniedReason: DENY_ACTIVE }
  if (hasActiveRun(ctx, feature.id)) return { ok: false, deniedReason: DENY_ACTIVE_RUN }

  const previousBranch = (await g.revparse(['--abbrev-ref', 'HEAD'])).trim()
  await g.checkout(branch)
  testDriveState = { featureId: feature.id, previousBranch }

  emit(ctx, feature.id, {
    type: 'testdrive.started',
    message: `test driving ${branch} (was on ${previousBranch})`,
    data: { branch, previousBranch },
  })

  // Best-effort: open a dev-server tab. Never fail the call on a spawn error.
  if (project.devCommand) spawnDevTerminal(project.repoPath, project.devCommand)

  return { ok: true, branch }
}

/** Fire-and-forget a Windows Terminal tab running the project dev command. */
function spawnDevTerminal(repoPath: string, devCommand: string): void {
  try {
    const child = spawn(
      'wt.exe',
      ['-w', '0', 'nt', '-d', repoPath, 'cmd', '/k', devCommand],
      { detached: true, stdio: 'ignore', windowsHide: false },
    )
    // A missing wt.exe emits 'error' asynchronously — swallow it so it never throws.
    child.on('error', () => {})
    child.unref()
  } catch {
    // synchronous spawn failure — ignore, the test drive itself still succeeded
  }
}

// --- merge ------------------------------------------------------------------

/**
 * Merge `feature/<slug>` into `project.mainBranch` with `--no-ff`. Denies (via
 * `GateError` → PRECONDITION_FAILED) while a test drive is active or the main
 * checkout is dirty. On conflict it aborts and reports `{ ok: false, conflict:
 * true }`, leaving the checkout clean and on the main branch either way.
 */
export async function mergeFeature(project: Project, feature: Feature): Promise<MergeResult> {
  if (testDriveState) {
    throw new GateError('Cannot merge while a test drive is active — stop it first')
  }

  const g = git(project.repoPath)
  const porcelain = (await g.raw(['status', '--porcelain'])).trim()
  if (porcelain !== '') {
    throw new GateError('Cannot merge — working tree has uncommitted changes')
  }

  const branch = featureBranch(feature.slug)
  await g.checkout(project.mainBranch)

  try {
    await g.merge(['--no-ff', branch])
    return { ok: true }
  } catch (e) {
    if (await mergeInProgress(g)) {
      await g.raw(['merge', '--abort'])
      return { ok: false, conflict: true }
    }
    // Not a conflict (e.g. unknown branch) — surface the real failure.
    throw e instanceof Error ? e : new Error(errMsg(e))
  }
}

/** True iff a merge is currently in progress (MERGE_HEAD present). */
async function mergeInProgress(g: SimpleGit): Promise<boolean> {
  try {
    await g.raw(['rev-parse', '--verify', '--quiet', 'MERGE_HEAD'])
    return true
  } catch {
    return false
  }
}
