import { existsSync, mkdirSync, realpathSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type { Feature, Project } from '@runcastle/core'
import { worktreeDir } from '@runcastle/core/paths'
import { simpleGit } from 'simple-git'
import type { SimpleGit } from 'simple-git'
import type { AppCtx } from '../db/types'
import { GateError, InvalidInputError } from '../errors'
import { startDevPane, stopDevPane } from '../pty/dev-pane'
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

/** Active test-drive info the UI polls (`feature.driveInfo`): the branch under
 *  the wheel plus the embedded dev pane's PTY id and its sniffed "Open app" URL. */
export interface DriveInfo {
  featureId: string
  branch: string
  /** Registry id of the drive's embedded dev pane, if a dev command spawned. */
  devPaneId?: string
  /** First localhost URL the dev server printed, if any (sticky per drive). */
  devUrl?: string
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

/**
 * Canonical path key: absolute and `realpath`-resolved when the path exists.
 * On Windows the filesystem is case-insensitive and uses `\` separators, so we
 * forward-slash, lower-case and 8.3-expand to a single key. On POSIX paths are
 * case-sensitive and `\` is a legal filename character, so we preserve both —
 * lower-casing there would fold distinct directories (`/u/Repo` vs `/u/repo`)
 * into one key.
 */
export function canon(p: string): string {
  let abs = resolve(p)
  try {
    abs = realpathSync.native(abs)
  } catch {
    // Path may not exist (stale registry entry) — fall back to the resolved form.
  }
  return process.platform === 'win32' ? abs.replace(/\\/g, '/').toLowerCase() : abs
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

/**
 * Parse `git worktree list --porcelain` into `{ path, branch }` entries.
 * `branch` is the short branch name (e.g. `feature/x`) or `undefined` when the
 * worktree is detached or bare.
 */
async function listWorktrees(g: SimpleGit): Promise<Array<{ path: string; branch?: string }>> {
  let out = ''
  try {
    out = await g.raw(['worktree', 'list', '--porcelain'])
  } catch {
    return []
  }
  const entries: Array<{ path: string; branch?: string }> = []
  let cur: { path: string; branch?: string } | undefined
  for (const line of out.split('\n')) {
    const w = line.match(/^worktree\s+(.+)$/)
    if (w) {
      if (cur) entries.push(cur)
      cur = { path: w[1].trim() }
      continue
    }
    const b = line.match(/^branch\s+refs\/heads\/(.+)$/)
    if (b && cur) cur.branch = b[1].trim()
  }
  if (cur) entries.push(cur)
  return entries
}

/** Canonical paths of all worktrees git currently tracks for this repo. */
async function registeredWorktrees(g: SimpleGit): Promise<Set<string>> {
  return new Set((await listWorktrees(g)).map((e) => canon(e.path)))
}

/**
 * Paths of worktrees — EXCLUDING the main checkout at `mainRepoPath` — that
 * currently have `branch` checked out. git refuses to check the same branch out
 * in a second worktree, so every one of these must be detached before the main
 * checkout (test drive) or a merge can take the branch. Covers both the talk
 * worktree and the sandcastle burner's `.sandcastle/worktrees/*` checkout.
 */
async function worktreesOnBranch(
  g: SimpleGit,
  branch: string,
  mainRepoPath: string,
): Promise<string[]> {
  const main = canon(mainRepoPath)
  return (await listWorktrees(g))
    .filter((e) => e.branch === branch && canon(e.path) !== main)
    .map((e) => e.path)
}

// --- worktree branch release (integration fix) ------------------------------

/**
 * Detach the git worktree at `path` from whatever branch it currently holds
 * (`git checkout --detach`), FREEING that branch to be checked out elsewhere.
 *
 * The talk worktree keeps `feature/<slug>` checked out; git refuses to let a
 * second worktree (the sandcastle burner's own `.sandcastle/worktrees/*`, or the
 * main checkout during a test drive) check out the same branch. Detaching parks
 * the talk worktree on the same commit as a detached HEAD, releasing the branch.
 * Working-tree files are untouched (same commit), so the feature's docs stay on
 * disk for the gate checks and the burner's docs digest.
 *
 * Returns `true` iff it actually detached (was on a branch); `false` when the
 * path is absent or already detached — so the caller only reattaches what it
 * itself detached.
 */
export async function detachWorktree(path: string): Promise<boolean> {
  if (!existsSync(path)) return false
  const g = git(path)
  let head: string
  try {
    head = (await g.revparse(['--abbrev-ref', 'HEAD'])).trim()
  } catch {
    return false
  }
  if (head === 'HEAD') return false // already detached
  await g.raw(['checkout', '--detach'])
  return true
}

/**
 * Re-checkout `branch` in the worktree at `path` — the inverse of
 * `detachWorktree`. Best-effort: silently does nothing when the path is gone or
 * the branch cannot be checked out right now (e.g. it is momentarily checked out
 * elsewhere), since a detached worktree is still fully usable for reads.
 */
export async function reattachWorktree(path: string, branch: string): Promise<void> {
  if (!existsSync(path)) return
  try {
    await git(path).checkout(branch)
  } catch {
    // best-effort — leaving the worktree detached keeps its files present
  }
}

// --- research temp branches (ADR-0001 §7: serial HITL, PARALLEL AFK) --------

/**
 * Namespace for research-run temp branches. Distinctively runcastle-owned so
 * boot cleanup can never touch a user's own branches (a bare `research/*`
 * prefix would be too easy to collide with).
 */
export const RESEARCH_BRANCH_PREFIX = 'runcastle/research/'

/**
 * Branch a research run commits to: `runcastle/research/<slug>/<seq>-<unique>`.
 * Based on the feature branch tip (sandcastle `baseBranch`), merged back into
 * it at run finalize, deleted after a clean merge. Encoding the feature slug
 * lets boot cleanup map a leftover branch back to its feature branch.
 */
export function researchBranchName(slug: string, waypointSeq: number, unique: string): string {
  return `${RESEARCH_BRANCH_PREFIX}${slug}/${waypointSeq}-${unique}`
}

export interface ResearchMergeResult {
  ok: boolean
  /** True when a real merge conflict was hit (merge aborted, temp branch kept). */
  conflict?: boolean
  error?: string
}

/**
 * Land a research run's temp branch on the feature branch (run-finalize success
 * path). The temp branch was created from the feature branch tip, so this is a
 * fast-forward unless the feature branch moved mid-run (docs committed by an
 * HITL session running in parallel) — then it is a plain merge, and on conflict
 * we abort, keep the temp branch for manual recovery, and report `conflict`.
 *
 * Merge site: git only allows a merge inside a checkout of the target branch,
 * so if any worktree (normally the talk worktree; the main checkout during a
 * test drive) holds the feature branch, the merge runs THERE. When nobody holds
 * it, `git fetch . <temp>:<feature>` fast-forwards the ref with no checkout at
 * all (it refuses non-fast-forward, which is exactly the conflict-shaped case).
 *
 * After a successful merge the temp branch is deleted (best-effort — a
 * preserved sandcastle worktree pinning it is detached first; a branch that
 * still cannot be deleted is swept by boot cleanup once merged).
 */
export async function mergeResearchBranch(
  repoPath: string,
  featureBranchName: string,
  tempBranch: string,
): Promise<ResearchMergeResult> {
  const g = git(repoPath)
  let branches: Awaited<ReturnType<SimpleGit['branchLocal']>>
  try {
    branches = await g.branchLocal()
  } catch (e) {
    return { ok: false, error: errMsg(e) }
  }
  if (!branches.all.includes(tempBranch)) {
    return { ok: false, error: `temp branch ${tempBranch} not found` }
  }
  if (!branches.all.includes(featureBranchName)) {
    return { ok: false, error: `feature branch ${featureBranchName} not found` }
  }

  const holder = (await listWorktrees(g)).find((e) => e.branch === featureBranchName)

  if (holder) {
    const gw = git(holder.path)
    try {
      await gw.merge([tempBranch]) // plain merge: fast-forwards when it can
    } catch (e) {
      if (await mergeInProgress(gw)) {
        await gw.raw(['merge', '--abort'])
        return { ok: false, conflict: true, error: errMsg(e) }
      }
      return { ok: false, error: errMsg(e) }
    }
  } else {
    try {
      // No checkout holds the branch: fast-forward the ref in place. Refuses
      // non-fast-forward (feature branch moved mid-run) rather than clobbering.
      await g.raw(['fetch', '.', `${tempBranch}:${featureBranchName}`])
    } catch (e) {
      return { ok: false, error: errMsg(e) }
    }
  }

  await deleteBranchDetachingWorktrees(g, repoPath, tempBranch)
  return { ok: true }
}

/**
 * Delete a local branch, first detaching any worktree that pins it (git refuses
 * to delete a checked-out branch — a dirty sandcastle worktree survives its run
 * and keeps the temp branch checked out). Best-effort: returns whether the
 * branch is actually gone.
 */
async function deleteBranchDetachingWorktrees(
  g: SimpleGit,
  repoPath: string,
  branch: string,
): Promise<boolean> {
  for (const holder of await worktreesOnBranch(g, branch, repoPath)) {
    try {
      await detachWorktree(holder)
    } catch {
      // best-effort — the delete below surfaces the pin if it remains
    }
  }
  try {
    await g.raw(['branch', '-D', branch])
    return true
  } catch {
    return false
  }
}

export interface ResearchBranchCleanup {
  deleted: string[]
  kept: string[]
}

/**
 * Boot sweep of leftover research temp branches (server crashed mid-run, or a
 * post-merge delete failed). Deletes ONLY branches fully merged into their
 * feature branch (`merge-base --is-ancestor`): an unmerged branch holds either
 * research commits that never landed or a conflict deliberately preserved for
 * manual recovery — both are kept, never destroyed. Best-effort throughout.
 */
export async function cleanupResearchBranches(repoPath: string): Promise<ResearchBranchCleanup> {
  const deleted: string[] = []
  const kept: string[] = []
  const g = git(repoPath)
  let all: string[]
  try {
    all = (await g.branchLocal()).all
  } catch {
    return { deleted, kept }
  }

  for (const name of all) {
    if (!name.startsWith(RESEARCH_BRANCH_PREFIX)) continue
    const slug = name.slice(RESEARCH_BRANCH_PREFIX.length).split('/')[0]
    const target = featureBranch(slug)
    let merged = false
    if (slug && all.includes(target)) {
      try {
        // NOT `merge-base --is-ancestor`: its "no" is a silent exit 1, which
        // simple-git resolves (it only rejects on stderr). Compare tips instead:
        // the branch is fully merged iff merge-base(branch, target) == its tip.
        const tip = (await g.revparse([name])).trim()
        const base = (await g.raw(['merge-base', name, target])).trim()
        merged = tip.length > 0 && tip === base
      } catch {
        merged = false
      }
    }
    if (merged && (await deleteBranchDetachingWorktrees(g, repoPath, name))) {
      deleted.push(name)
    } else {
      kept.push(name)
    }
  }
  return { deleted, kept }
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

/** Module-level in-memory test-drive state (SPEC §7). At most one active.
 *  `detachedWorktree` records the talk worktree we detached to free the feature
 *  branch for the main checkout, so `stop` reattaches exactly what it detached.
 *  `devPaneId`/`devUrl` track the embedded dev pane and its sniffed localhost URL. */
let testDriveState:
  | {
      featureId: string
      branch: string
      previousBranch: string
      detachedWorktree?: string
      devPaneId?: string
      devUrl?: string
    }
  | undefined

/** Test-only: clear the in-memory test-drive state (not called by any router). */
export function __resetTestDriveState(): void {
  testDriveState = undefined
}

/**
 * Feature id of the currently-active test drive, or `undefined` when none is
 * active. The merge flow uses this to stop a drive of the SAME feature (which
 * holds the main checkout on the feature branch) before merging.
 */
export function activeTestDriveFeatureId(): string | undefined {
  return testDriveState?.featureId
}

/** The active test drive's info for the UI (dev pane + Open app link), or null. */
export function activeDriveInfo(): DriveInfo | null {
  if (!testDriveState) return null
  return {
    featureId: testDriveState.featureId,
    branch: testDriveState.branch,
    devPaneId: testDriveState.devPaneId,
    devUrl: testDriveState.devUrl,
  }
}

/**
 * Record the first localhost URL sniffed from the drive's dev pane (the "Open
 * app" link). Sticky per drive — the first URL wins — and ignored once the drive
 * has stopped or moved to another feature. Emits `testdrive.url` for the timeline.
 */
export function recordDriveUrl(ctx: AppCtx, featureId: string, url: string): void {
  if (!testDriveState || testDriveState.featureId !== featureId || testDriveState.devUrl) return
  testDriveState.devUrl = url
  emit(ctx, featureId, {
    type: 'testdrive.url',
    message: `dev server ready — open app at ${url}`,
    data: { url },
  })
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
    const detachedWorktree = testDriveState.detachedWorktree
    const devPaneId = testDriveState.devPaneId
    // Kill the whole dev-server process tree first so its port is freed with no
    // orphan (the drive owns the pane; its URL is cleared when state resets).
    if (devPaneId) stopDevPane(devPaneId)
    await g.checkout(previousBranch)
    // The main checkout has released the feature branch — restore the talk
    // worktree to it (best-effort) so a resumed session picks up where it left.
    if (detachedWorktree) await reattachWorktree(detachedWorktree, branch)
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

  // Free the feature branch from EVERY worktree that currently holds it so the
  // main checkout can switch onto it — git refuses two worktrees on one branch.
  // This is the talk worktree AND the sandcastle burner's `.sandcastle/worktrees/*`
  // checkout, which pins the branch after any burn. We remember only the talk
  // worktree to reattach on stop; the burner's is left detached (its files stay on
  // disk and it re-checks-out the branch itself on the next run).
  const talkWorktree = worktreeDir(project.id, feature.slug)
  let detachedWorktree: string | undefined
  for (const holder of await worktreesOnBranch(g, branch, project.repoPath)) {
    const didDetach = await detachWorktree(holder)
    if (didDetach && canon(holder) === canon(talkWorktree)) detachedWorktree = holder
  }

  const previousBranch = (await g.revparse(['--abbrev-ref', 'HEAD'])).trim()
  await g.checkout(branch)
  testDriveState = { featureId: feature.id, branch, previousBranch, detachedWorktree }

  emit(ctx, feature.id, {
    type: 'testdrive.started',
    message: `test driving ${branch} (was on ${previousBranch})`,
    data: { branch, previousBranch },
  })

  // Best-effort: spawn the dev command in a drive-owned embedded PTY pane and
  // sniff its localhost URL for the "Open app" link. A spawn failure never fails
  // the drive (startDevPane emits its own event and returns undefined).
  if (project.devCommand) {
    const devPaneId = startDevPane({
      ctx,
      featureId: feature.id,
      repoPath: project.repoPath,
      devCommand: project.devCommand,
      onUrl: (url) => recordDriveUrl(ctx, feature.id, url),
    })
    if (devPaneId) testDriveState.devPaneId = devPaneId
  }

  return { ok: true, branch }
}

// --- merge ------------------------------------------------------------------

/**
 * Merge `feature/<slug>` into `project.mainBranch` with `--no-ff`. Denies (via
 * `GateError` → PRECONDITION_FAILED) while a test drive is active or the main
 * checkout is dirty. On conflict it aborts and reports `{ ok: false, conflict:
 * true }`, leaving the checkout clean and on the main branch either way.
 *
 * The active-drive guard is a safety net: the merge tRPC handler already stops a
 * drive of the SAME feature first (via `activeTestDriveFeatureId`), so in the
 * normal flow this only fires when a DIFFERENT feature is being test-driven.
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
