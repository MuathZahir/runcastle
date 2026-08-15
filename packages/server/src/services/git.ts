import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import type { Feature, PreparedKey, Project } from '@runcastle/core'
import { DRIVE_LOOP_KEYS } from '@runcastle/core'
import { PROJECT_WORKTREE_SLUG, worktreeDir } from '@runcastle/core/paths'
import { simpleGit } from 'simple-git'
import type { SimpleGit } from 'simple-git'
import type { AppCtx } from '../db/types'
import { GateError, InvalidInputError } from '../errors'
import { devPaneLive, startDevPane, stopDevPane } from '../pty/dev-pane'
import type { DriveHookFailure, DriveHookResult } from './drive-hooks'
import { describeHookResult, runDriveHook } from './drive-hooks'
import type { DriveIdentity } from './drive-env'
import { describeDriveEnv, driveProcessEnv, parseDriveEnv } from './drive-env'
import type { EmitScope } from './events'
import { emit, emitProject, emitScoped } from './events'
import { markVerified } from './findings'
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
  /**
   * Uncommitted paths that travelled across the branch switch on `stop`. git
   * carries dirty files with you, so work done during a drive lands on the
   * branch you return to — reported rather than silently allowed.
   */
  carriedChanges?: string[]
  /** Set on `stop` when the drive may have left the dev database ahead (§drift). */
  dbDrift?: DbDrift
  /**
   * The project's `driveSetupCommand` (on `start`) or `driveStopCommand` (on
   * `stop`) when it ran and failed. Absent means "no hook, or it succeeded" —
   * a successful hook is timeline material, not something to interrupt over.
   */
  hookFailure?: DriveHookFailure
}

/**
 * A stopped test drive whose branch carried migrations the branch you returned
 * to does not have.
 *
 * Test drive switches FILES. It cannot switch the dev database, and the dev
 * pane inherits the same environment — so a migration applied during a drive
 * outlives it, and the next `migrate dev` on the original branch reports drift
 * against a schema whose migration files are no longer on disk. The user finds
 * out much later, from a tool that cannot know a test drive ever happened.
 *
 * We cannot fix that from git, so we do the next best thing: notice at the
 * exact moment it becomes true, name it, and hand over the project's own reset
 * command. Running it is the human's call — a dev database can hold hand-built
 * state that a silent auto-reset would destroy.
 */
export interface DbDrift {
  /** Migration-ish paths that differ between the drive branch and this one. */
  files: string[]
  /** The project's `dbResetCommand`, when preparation or a human established one. */
  resetCommand?: string
}

/** Active test-drive info the UI polls (`feature.driveInfo`): the branch under
 *  the wheel plus the embedded dev pane's PTY id and its sniffed "Open app" URL. */
export interface DriveInfo {
  /** Absent for a preparation dry run — that drive belongs to no feature. */
  featureId?: string
  /**
   * True for a preparation dry-run drive (decision 9). It holds the same
   * singleton slot as a real test drive, so the UI shows it as the active drive
   * with a working Stop — `dryRun` with no `featureId` is how it is told apart.
   */
  dryRun?: boolean
  branch: string
  /** Registry id of the drive's embedded dev pane, if a dev command spawned. */
  devPaneId?: string
  /** First localhost URL the dev server printed, if any (sticky per drive). */
  devUrl?: string
  /**
   * Whether the project had a `devCommand` to run at all. A drive is a `git
   * checkout` plus, optionally, a dev server — and with no command configured
   * the checkout is the whole of it. The UI needs the two cases apart to stop
   * claiming "driving now" over a process that was never started (findings F22):
   * `devPaneId` absent with this `false` means nothing was meant to start,
   * absent with `true` means the spawn failed and the timeline says why.
   */
  devConfigured: boolean
}

export interface MergeResult {
  ok: boolean
  conflict?: boolean
  /** The branch the feature was merged into (its base; default `mainBranch`). */
  target: string
  /** Repo-relative paths that conflicted (only on `conflict`), for the review UI. */
  files?: string[]
}

/** Repo-relative dir (forward slashes) holding every feature's knowledge docs. */
const DOCS_PATHSPEC = 'docs/features'

/**
 * Paths that look like database migrations, across the conventions runcastle
 * actually meets: a `migrations/` or `migrate/` directory segment covers
 * Prisma, Django, Rails, Laravel, Supabase, Alembic and golang-migrate, and
 * `.sql` files under a `drizzle/` segment cover Drizzle Kit's default output.
 *
 * Deliberately a heuristic over paths rather than a per-ORM detector: the cost
 * of a false positive is one dismissible warning, and the cost of a false
 * negative is the silent drift this exists to catch.
 */
const MIGRATION_DIR_RE = /(^|\/)(migrations|migrate)\//i
const DRIZZLE_SQL_RE = /(^|\/)drizzle\/.*\.sql$/i

/** The migration-looking subset of a diff's paths. Pure. */
export function migrationPaths(paths: readonly string[]): string[] {
  return paths.filter((p) => MIGRATION_DIR_RE.test(p) || DRIZZLE_SQL_RE.test(p))
}

/** Human-readable test-drive denial reasons (surfaced verbatim in the UI). */
const DENY_DIRTY = 'Working tree has uncommitted changes — commit or stash first'
const DENY_ACTIVE = 'A test drive is already active — stop it first'
const DENY_ACTIVE_RUN = 'Feature has an active run — wait for it to finish'
const DENY_NONE_ACTIVE = 'No test drive is active'
const DENY_DRY_RUN_ACTIVE = 'A preparation dry-run is in progress — stop it first'
const DENY_NO_DRY_RUN = 'No preparation dry-run is in progress'
const DENY_NO_REVIEW_DRIVE = 'No review drive is in progress for this feature'

/** Branch name for a feature slug. */
function featureBranch(slug: string): string {
  return `feature/${slug}`
}

/** The branch a feature merges into: its own base, else the project main line. */
function mergeTarget(project: Project, feature: Feature): string {
  return feature.baseBranch ?? project.mainBranch
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
 * Create branch `feature/<slug>` from `base` (default `project.mainBranch`)
 * WITHOUT switching the main working copy (`git branch <name> <base>`). `base`
 * lets the caller fork a feature off any existing local branch — the current
 * branch, another feature, a release line — not just the project default.
 * Idempotent: if the branch already exists this is a no-op (the base is
 * ignored). Throws a clear error if `base` is not an existing local branch.
 * Returns the branch name.
 */
export async function createFeatureBranch(
  project: Project,
  slug: string,
  base?: string,
): Promise<string> {
  const branch = featureBranch(slug)
  const from = base?.trim() || project.mainBranch
  const g = git(project.repoPath)
  const branches = await g.branchLocal()
  if (branches.all.includes(branch)) return branch
  if (!branches.all.includes(from)) {
    throw new Error(`base branch "${from}" does not exist in ${project.repoPath}`)
  }
  await g.raw(['branch', branch, from])
  return branch
}

export interface BranchList {
  /** The branch the main checkout is on right now (the "use current" default). */
  current: string
  /** The project's stored default base. */
  mainBranch: string
  /** Local branches, `feature/*` excluded. */
  branches: string[]
  /**
   * Remote-tracking branches with NO local counterpart, as `origin/<name>` — for
   * teams whose base line (`develop`, `release/*`) lives only on the remote after
   * a fresh clone. Picking one materializes a local tracking branch (see
   * `resolveBaseBranch`), so it becomes a real, push-able ship destination.
   */
  remoteBranches: string[]
}

/**
 * List branches for the create-feature base picker (§4 `project.branches`). You
 * fork a NEW feature off a base, not off another in-flight talk branch, so
 * `feature/*` is excluded everywhere; remote refs already shadowed by a local
 * branch of the same name are dropped (the local one is the real target).
 */
export async function listBranches(project: Project): Promise<BranchList> {
  const g = git(project.repoPath)
  const local = await g.branchLocal()
  const branches = local.all.filter((name) => !name.startsWith('feature/'))

  const localSet = new Set(local.all)
  let remoteBranches: string[] = []
  try {
    const remote = await g.branch(['-r'])
    remoteBranches = remote.all
      // Drop symbolic refs like `origin/HEAD -> origin/main`.
      .filter((r) => !r.includes(' -> ') && !r.endsWith('/HEAD'))
      // Remote-only: strip the `<remote>/` prefix and keep those with no local
      // twin and not a talk branch.
      .filter((r) => {
        const short = r.replace(/^[^/]+\//, '')
        return !short.startsWith('feature/') && !localSet.has(short)
      })
  } catch {
    // No remotes (or a bare/odd repo) — remote picks simply aren't offered.
  }

  return { current: local.current, mainBranch: project.mainBranch, branches, remoteBranches }
}

/**
 * Resolve a base-branch pick to the LOCAL branch a feature forks from and later
 * merges back into. A local branch passes through unchanged. A remote-tracking
 * pick (`origin/<name>`) is materialized into a local `<name>` tracking it —
 * created at the remote tip when absent, an existing local `<name>` reused (never
 * clobbered) — so a feature forked off a remote line still has a real, local,
 * push-able ship destination. Throws if the pick names neither.
 */
export async function resolveBaseBranch(project: Project, base: string): Promise<string> {
  const g = git(project.repoPath)
  const local = await g.branchLocal()
  if (local.all.includes(base)) return base

  const remotes = (await g.getRemotes()).map((r) => r.name)
  for (const rem of remotes) {
    const prefix = `${rem}/`
    if (!base.startsWith(prefix)) continue
    const name = base.slice(prefix.length)
    if (!name || name.endsWith('/HEAD')) break
    if (local.all.includes(name)) return name
    await g.raw(['branch', '--track', name, base])
    return name
  }

  throw new Error(`base branch "${base}" does not exist in ${project.repoPath}`)
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

  // The worktree can only be checked out to an existing branch. Normally the
  // branch already exists (created at feature.create); this only recreates it if
  // it went missing — from the feature's recorded base, falling back to main.
  await ensureBranchExists(g, branch, feature.baseBranch ?? project.mainBranch)

  if (await worktreeIsValid(g, worktreePath, branch)) return worktreePath

  // A registered worktree that is merely DETACHED just needs the branch checked
  // out again — `worktree add` would refuse the path git still owns. This is the
  // post-test-drive state (the drive detaches the talk worktree to take the
  // branch, and the reattach on stop is best-effort), which used to make the next
  // terminal on the feature unlaunchable — findings F3. Same move as
  // `ensureProjectWorktree`.
  if (existsSync(worktreePath) && (await registeredWorktrees(g)).has(canon(worktreePath))) {
    if (await checkoutInWorktree(worktreePath, branch)) return worktreePath
  }

  return addWorktree(g, worktreePath, branch, 'talk worktree')
}

/**
 * `git worktree add <path> <branch>`, retried once through a `worktree prune` —
 * the stale-registry case (the dir was deleted out from under git) is the common
 * one, and it heals itself. `label` names the worktree in the error a second
 * failure raises, so the message says which one could not be created.
 */
async function addWorktree(
  g: SimpleGit,
  worktreePath: string,
  branch: string,
  label: string,
): Promise<string> {
  mkdirSync(dirname(worktreePath), { recursive: true })
  try {
    await g.raw(['worktree', 'add', worktreePath, branch])
    return worktreePath
  } catch {
    try {
      await g.raw(['worktree', 'prune'])
    } catch {
      // best-effort — a failed prune just means the retry below will surface it
    }
    try {
      await g.raw(['worktree', 'add', worktreePath, branch])
      return worktreePath
    } catch (e) {
      throw new InvalidInputError(`could not create ${label} at ${worktreePath}: ${errMsg(e)}`)
    }
  }
}

/**
 * Ensure the PROJECT session's worktree exists at
 * `worktreeDir(projectId, '__project')`, checked out on {@link PROJECT_BRANCH}
 * cut from the base tip (decision 18). Never the human's checkout: this session
 * writes the whole repo, so it works on a runcastle-owned branch and lands via
 * {@link mergeTempBranch}, exactly like every other AFK writer.
 *
 * A previous session that crashed (or whose landing hit a conflict) leaves
 * commits on the branch, so this lands them BEFORE recutting — best-effort,
 * because a failed landing must never be an excuse to throw the work away. If
 * they still cannot land, the branch is left exactly as it is and the session
 * reopens on top of its own unlanded work; the next end-of-session landing (or
 * the next launch) tries again. Only a branch with nothing ahead of the base is
 * recut.
 */
export async function ensureProjectWorktree(
  project: Project,
  onLanded?: (res: ProjectLandResult) => void,
): Promise<string> {
  const worktreePath = worktreeDir(project.id, PROJECT_WORKTREE_SLUG)
  const g = git(project.repoPath)
  const base = project.mainBranch

  // The retry the landing protocol promises. Reported through `onLanded`,
  // because this merge puts commits on the human's own branch: a silent success
  // leaves the earlier `project.land_conflict` standing as the timeline's last
  // word, so the UI keeps claiming the work is stranded after it has landed.
  const landed = await landProjectBranch(project)
  if (landed) onLanded?.(landed)

  const stillAhead = await branchCommitsAhead(project.repoPath, base, PROJECT_BRANCH)
  if (stillAhead.length === 0) {
    // Nothing to lose: drop whatever the branch was (detaching the worktree that
    // pins it, if any) and cut it again at the base tip.
    await deleteBranchDetachingWorktrees(g, project.repoPath, PROJECT_BRANCH)
    await g.raw(['branch', PROJECT_BRANCH, base])
  }

  if (await worktreeIsValid(g, worktreePath, PROJECT_BRANCH)) return worktreePath

  // A registered worktree that is merely detached (landing deletes the branch it
  // held) or sitting on the previous cut just needs the new branch checked out —
  // recreating it would be a needless delete of a directory git still owns.
  if (existsSync(worktreePath) && (await registeredWorktrees(g)).has(canon(worktreePath))) {
    if (await checkoutInWorktree(worktreePath, PROJECT_BRANCH)) return worktreePath
  }

  return addWorktree(g, worktreePath, PROJECT_BRANCH, 'project worktree')
}

/**
 * Check `branch` out in an existing worktree: plainly first, so any uncommitted
 * work there survives where git can carry it over, then forced when it cannot
 * (an abandoned edit must not leave the project terminal unlaunchable). Returns
 * whether the worktree now holds the branch.
 */
async function checkoutInWorktree(worktreePath: string, branch: string): Promise<boolean> {
  const gw = git(worktreePath)
  try {
    await gw.raw(['checkout', branch])
    return true
  } catch {
    // carrying the changes over failed — take them out of the way instead
  }
  try {
    await gw.raw(['checkout', '--force', branch])
    return true
  } catch {
    return false // caller recreates the worktree from scratch
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

// --- runcastle temp branches (ADR-0001 §7: serial HITL, PARALLEL AFK) -------

/**
 * Namespaces for AFK-run temp branches. Distinctively runcastle-owned so boot
 * cleanup can never touch a user's own branches (bare `research/*` / `ticket/*`
 * prefixes would be too easy to collide with). Both encode
 * `<slug-segment>/<seq>-<unique>` after the prefix so cleanup can map a
 * leftover branch back to its feature branch.
 */
export const RESEARCH_BRANCH_PREFIX = 'runcastle/research/'
export const TICKET_BRANCH_PREFIX = 'runcastle/ticket/'
/**
 * The branch the project session works on (decision 18 of feature-grouping).
 * One per project — the session is a singleton — cut fresh from the base tip at
 * each launch and landed back onto the base branch by {@link mergeTempBranch}
 * when the session ends. Same `runcastle/*` namespace as every other AFK
 * writer's temp branch, for the same reason: no agent ever writes the human's
 * checkout directly.
 */
export const PROJECT_BRANCH = 'runcastle/project'
const TEMP_BRANCH_PREFIXES = [RESEARCH_BRANCH_PREFIX, TICKET_BRANCH_PREFIX] as const

const TEMP_BRANCH_SLUG_MAX = 16

/**
 * The slug segment embedded in temp branch names: the feature slug truncated to
 * 16 chars (ADR-0003). Sandcastle keys its worktree DIRECTORY on the branch
 * name (`.sandcastle/worktrees/<branch>`), so a full 60+-char slug lands in
 * every checked-out file path and blows past Windows' 260-char MAX_PATH in
 * repos with deep trees ("Filename too long" mid-checkout). Truncation keeps
 * the mapping human-readable while capping the path contribution; `unique`
 * already guarantees branch-name uniqueness.
 */
export function tempBranchSlugSegment(slug: string): string {
  return slug.slice(0, TEMP_BRANCH_SLUG_MAX).replace(/-+$/, '')
}

/**
 * Branch a research run commits to:
 * `runcastle/research/<slug-segment>/<seq>-<unique>`. Based on the feature
 * branch tip (sandcastle `baseBranch`), merged back into it at run finalize,
 * deleted after a clean merge.
 */
export function researchBranchName(slug: string, waypointSeq: number, unique: string): string {
  return `${RESEARCH_BRANCH_PREFIX}${tempBranchSlugSegment(slug)}/${waypointSeq}-${unique}`
}

/**
 * Branch one ticket burn commits to:
 * `runcastle/ticket/<slug-segment>/<seq>-<unique>` (M2, SPEC §8). Based on the
 * feature branch tip (sandcastle `baseBranch`) so every concurrent ticket gets
 * its OWN sandcastle worktree — the `branch` strategy reuses
 * `.sandcastle/worktrees/<branch>` per branch name, so distinct names are what
 * isolate parallel agents. Landed on the feature branch through the burner's
 * serialized merge queue, deleted after a clean merge.
 */
export function ticketBranchName(slug: string, ticketSeq: number, unique: string): string {
  return `${TICKET_BRANCH_PREFIX}${tempBranchSlugSegment(slug)}/${ticketSeq}-${unique}`
}

// --- sandcastle burn worktrees ----------------------------------------------

/**
 * Where sandcastle puts the `branch` strategy's worktree:
 * `<repo>/.sandcastle/worktrees/<branch with every `/` → `-`>` (its
 * `worktreeName = branch.replace(/\//g, '-')`). Deriving it here lets us clean
 * up a worktree sandcastle itself failed to remove, without parsing its errors.
 */
export function burnWorktreePath(repoPath: string, branch: string): string {
  return join(repoPath, '.sandcastle', 'worktrees', branch.replace(/\//g, '-'))
}

/**
 * Best-effort removal of a burn worktree sandcastle could not delete at
 * teardown. On Windows `git worktree remove` hits `Directory not empty` when a
 * handle inside the dir is still open — typically the just-`rm -f`'d
 * container's bind mount, which Docker Desktop releases a moment later (also
 * Defender/the indexer mid-scan) — so the first retry usually succeeds. Falls
 * back to a direct recursive delete, then always prunes: git only drops the
 * `.git/worktrees/<name>` admin entry when its work-tree delete succeeded, so a
 * failed removal otherwise leaves the entry registered forever (and `prune`
 * ignores it while the dir is still there).
 *
 * NEVER throws and never blocks an outcome — a burn's result is decided by its
 * commits, not by whether we could tidy up after it. Returns whether the dir is
 * actually gone.
 */
export async function cleanupBurnWorktree(
  repoPath: string,
  branch: string,
  opts: { attempts?: number; delayMs?: number } = {},
): Promise<boolean> {
  const path = burnWorktreePath(repoPath, branch)
  const attempts = Math.max(1, opts.attempts ?? 3)
  const delayMs = opts.delayMs ?? 750
  const g = git(repoPath)

  for (let attempt = 1; attempt <= attempts && existsSync(path); attempt++) {
    try {
      await g.raw(['worktree', 'remove', '--force', path])
    } catch {
      // Still locked (or not a registered worktree) — retry, then fall back.
    }
    if (existsSync(path) && attempt < attempts) await sleep(delayMs)
  }
  if (existsSync(path)) {
    try {
      rmSync(path, { recursive: true, force: true })
    } catch {
      // best-effort — a locked file just means the dir survives this pass
    }
  }
  try {
    await g.raw(['worktree', 'prune'])
  } catch {
    // best-effort — a leftover registry entry is harmless once the dir is gone
  }
  return !existsSync(path)
}

/** `resolve` is `node:path`'s here — name the callback so it is not shadowed. */
function sleep(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms))
}

/**
 * Commit shas reachable from `branch` but not from `base`, oldest first — the
 * work a burn attempt chain has accumulated over the feature branch. `[]` when
 * either ref is missing (a crashed attempt may die before its branch is ever
 * created) or the ranges cannot be compared; callers treat that as "nothing to
 * salvage", never as an error.
 */
export async function branchCommitsAhead(
  repoPath: string,
  base: string,
  branch: string,
): Promise<string[]> {
  try {
    const out = await git(repoPath).raw(['rev-list', '--reverse', `${base}..${branch}`])
    return out
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
  } catch {
    return []
  }
}

/**
 * How many commits the feature branch carries that its base does not, and which
 * base that is — the honest answer to "what is about to be merged", read from git
 * rather than from ticket rows (a branch a human or an Iterate session committed
 * to has commits and no ticket commit rows at all: findings F23).
 *
 * The base is `mergeTarget`, the very branch {@link mergeFeature} will merge into,
 * so the figure the review summary paints cannot drift from what the click does.
 * `rev-list <base>..<branch>` is merge-base-relative, so a base that moved ahead
 * underneath the feature does not inflate the count.
 *
 * `count` is `undefined` (unknown) rather than `0` when the branch is missing or
 * git fails: reporting "no commits" for "cannot tell" is the reassuring lie.
 */
export async function reviewCommitCount(
  project: Project,
  feature: Feature,
): Promise<{ base: string; count?: number }> {
  const base = mergeTarget(project, feature)
  const branch = featureBranch(feature.slug)
  try {
    const out = (
      await git(project.repoPath).raw(['rev-list', '--count', `${base}..${branch}`])
    ).trim()
    const n = Number(out)
    return { base, count: Number.isInteger(n) && n >= 0 ? n : undefined }
  } catch {
    return { base }
  }
}

/**
 * The commit sha `ref` points at, or `undefined` when it cannot be resolved
 * (unborn branch, missing ref, not a repo). Used to pin a preparation run's
 * findings to the main-branch commit they were measured at.
 */
export async function headSha(repoPath: string, ref: string): Promise<string | undefined> {
  try {
    const out = (await git(repoPath).revparse([ref])).trim()
    return out.length > 0 ? out : undefined
  } catch {
    return undefined
  }
}

/**
 * How many commits `branch` has gained since `sha` — the staleness distance for
 * a prepared finding. `undefined` (unknown) rather than `0` whenever the answer
 * cannot be trusted: the sha may have been rewritten out of history by a rebase
 * or dropped by a shallow fetch, and reporting an unreachable baseline as
 * "0 commits behind" would present the most dangerous case as the safest one.
 */
export async function commitsSince(
  repoPath: string,
  sha: string,
  branch: string,
): Promise<number | undefined> {
  try {
    const out = (await git(repoPath).raw(['rev-list', '--count', `${sha}..${branch}`])).trim()
    const n = Number(out)
    return Number.isFinite(n) ? n : undefined
  } catch {
    return undefined
  }
}

/**
 * Repo-relative paths that differ between two refs, or `[]` when the diff
 * cannot be taken. Used by the test-drive stop to ask a narrower question than
 * "did anything change": did files under a migrations directory change, i.e.
 * could this drive have moved the dev database's schema out from under the
 * branch being returned to.
 */
export async function diffPaths(repoPath: string, from: string, to: string): Promise<string[]> {
  try {
    const out = (await git(repoPath).raw(['diff', '--name-only', from, to])).trim()
    return out ? out.split('\n').map((s) => s.trim()).filter(Boolean) : []
  } catch {
    return []
  }
}

/**
 * One-line summaries (`<short sha> <subject>`) of the commits reachable from
 * `branch` but not from `base`, newest first, capped at `limit`. The conflict
 * resolver briefs its agent with these: "what landed underneath you while you
 * were working" is the other side of the merge it has to reconcile with, and a
 * list of subjects is the cheapest way to convey it. `[]` on any git failure —
 * a missing brief must never fail a resolve.
 */
export async function commitSummaries(
  repoPath: string,
  base: string,
  branch: string,
  limit = 20,
): Promise<string[]> {
  try {
    const out = await git(repoPath).raw([
      'log',
      `--max-count=${limit}`,
      '--format=%h %s',
      `${base}..${branch}`,
    ])
    return out
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
  } catch {
    return []
  }
}

/**
 * Best-effort delete of a burn temp branch (the "retry fresh" path: the user
 * discards a preserved attempt chain). Detaches any sandcastle worktree still
 * pinning the branch first; returns whether the branch is actually gone.
 */
export async function deleteTempBranch(repoPath: string, branch: string): Promise<boolean> {
  try {
    return await deleteBranchDetachingWorktrees(git(repoPath), repoPath, branch)
  } catch {
    return false
  }
}

/** The deterministic name prefix every attempt branch of one ticket shares. */
function ticketBranchPrefix(slug: string, ticketSeq: number): string {
  return `${TICKET_BRANCH_PREFIX}${tempBranchSlugSegment(slug)}/${ticketSeq}-`
}

/** All local attempt branches for one ticket (the `retry fresh` discard set). */
export async function listTicketAttemptBranches(
  repoPath: string,
  slug: string,
  ticketSeq: number,
): Promise<string[]> {
  const prefix = ticketBranchPrefix(slug, ticketSeq)
  try {
    return (await git(repoPath).branchLocal()).all.filter((b) => b.startsWith(prefix))
  } catch {
    return []
  }
}

export interface PreservedTicketBranch {
  branch: string
  /** Commits ahead of the feature branch, oldest first. */
  commits: string[]
}

/**
 * FALLBACK lookup of a failed ticket's preserved attempt branch when the DB
 * carries no `attemptBranch` pointer — burns that predate the column, or a
 * lost/reset db. Not a search: the burner names every attempt branch
 * deterministically (`runcastle/ticket/<slug-segment>/<seq>-<unique>`), so
 * this lists the known prefix and only the per-attempt random suffix varies.
 * Candidates must still hold commits not on the feature branch (a landed or
 * empty leftover is no resume point); the newest tip wins when several past
 * attempts left work behind. Best-effort: git failures yield `undefined`.
 *
 * Caveat (ADR-0003 slug truncation): two features can share a segment, so a
 * same-seq ticket of a sibling feature could in principle match. Adoption only
 * happens on an explicit per-ticket retry, the resumed branch is named in the
 * event stream, and `retry fresh` is the escape hatch.
 */
export async function findPreservedTicketBranch(
  repoPath: string,
  featureBranch: string,
  slug: string,
  ticketSeq: number,
): Promise<PreservedTicketBranch | undefined> {
  try {
    const g = git(repoPath)
    let best: (PreservedTicketBranch & { tipTime: number }) | undefined
    for (const branch of await listTicketAttemptBranches(repoPath, slug, ticketSeq)) {
      const commits = await branchCommitsAhead(repoPath, featureBranch, branch)
      if (commits.length === 0) continue
      let tipTime = 0
      try {
        tipTime = Number((await g.raw(['log', '-1', '--format=%ct', branch])).trim()) || 0
      } catch {
        // unreadable tip — still a candidate, just lowest priority
      }
      if (!best || tipTime > best.tipTime) best = { branch, commits, tipTime }
    }
    return best ? { branch: best.branch, commits: best.commits } : undefined
  } catch {
    return undefined // e.g. repoPath is not (or no longer) a git checkout
  }
}

/**
 * Allow the isolated burn sandboxes (ADR-0005) to push into their tickets'
 * checked-out temp branches: `receive.denyCurrentBranch=ignore` updates the
 * REF only; the sandbox-side post-commit hook follows up with a `reset --hard`
 * that syncs the mounted working tree itself.
 *
 * `updateInstead` cannot work here (observed in the first real Windows burn):
 * push-to-checkout resolves the branch's checkout via the worktree path
 * registered in the parent repo's metadata — the HOST path (`C:\...`), which
 * does not exist inside the container — so every such push is refused.
 * `ignore` sidesteps the checkout entirely.
 *
 * This MUST run host-side, once, before any ticket container starts: a git
 * worktree has no config of its own, so the write lands in the parent repo's
 * shared `.git/config` — when every sandbox ran it concurrently they raced on
 * the shared `config.lock` ("could not lock config file: File exists") and
 * setup died before the agent ever started.
 */
export async function allowPushToCheckedOutBranches(repoPath: string): Promise<void> {
  await git(repoPath).addConfig('receive.denyCurrentBranch', 'ignore')
}

export interface TempBranchMergeResult {
  ok: boolean
  /** True when a real merge conflict was hit (merge aborted, temp branch kept). */
  conflict?: boolean
  /**
   * Repo-relative paths that conflicted (only on `conflict`). Captured while the
   * merge is still in progress — `merge --abort` clears the unmerged index — so
   * the resolver agent and the run lane get a real file list instead of having
   * to parse git's error prose. Empty when git could not report them.
   */
  files?: string[]
  error?: string
}

/**
 * Land an AFK run's temp branch (research or ticket) on the feature branch.
 * The temp branch was created from the feature branch tip, so this is a
 * fast-forward unless the feature branch moved mid-run (docs committed by a
 * parallel HITL session, or another concurrent ticket landed first) — then it
 * is a plain merge, and on conflict we abort, keep the temp branch (with the
 * conflicting paths in `files`) and report `conflict` — the burner's landing
 * loop then runs a resolver agent on that branch and comes back.
 *
 * Merge site: git only allows a merge inside a checkout of the target branch,
 * so if any worktree (normally the talk worktree; the main checkout during a
 * test drive) holds the feature branch, the merge runs THERE. When nobody holds
 * it (the talk worktree is detached or gone), `git fetch . <temp>:<feature>`
 * fast-forwards the ref with no checkout at all; if that refuses because the
 * feature branch moved mid-run, the merge happens in a disposable worktree —
 * a refused fast-forward is NOT conflict-shaped, it is the normal shape of two
 * parallel tickets landing (the first one moves the tip out from under the
 * second).
 *
 * After a successful merge the temp branch is deleted (best-effort — a
 * preserved sandcastle worktree pinning it is detached first; a branch that
 * still cannot be deleted is swept by boot cleanup once merged).
 */
export async function mergeTempBranch(
  repoPath: string,
  featureBranchName: string,
  tempBranch: string,
): Promise<TempBranchMergeResult> {
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
        const files = await conflictedFiles(gw) // before the abort clears the index
        await gw.raw(['merge', '--abort'])
        return { ok: false, conflict: true, files, error: errMsg(e) }
      }
      return { ok: false, error: errMsg(e) }
    }
  } else {
    try {
      // No checkout holds the branch: fast-forward the ref in place. Refuses
      // non-fast-forward (feature branch moved mid-run) rather than clobbering.
      await g.raw(['fetch', '.', `${tempBranch}:${featureBranchName}`])
    } catch {
      // Non-fast-forward: the feature branch moved mid-run (normal under burn
      // concurrency — a parallel ticket landed first, and this ticket's branch
      // forked from the older tip). A real merge needs a checkout of the
      // target branch and nobody holds one, so merge in a disposable worktree.
      const merged = await mergeInDisposableWorktree(g, featureBranchName, tempBranch)
      if (!merged.ok) return merged
    }
  }

  await deleteBranchDetachingWorktrees(g, repoPath, tempBranch)
  return { ok: true }
}

/**
 * Merge `tempBranch` into `featureBranchName` when no existing checkout holds
 * the feature branch and the ref cannot fast-forward: check the feature branch
 * out in a short-lived worktree under the OS temp dir (short path — Windows
 * MAX_PATH), merge there, then remove the worktree. On conflict the merge is
 * aborted and the worktree removed, leaving the feature branch untouched and
 * the temp branch preserved for manual recovery.
 */
async function mergeInDisposableWorktree(
  g: SimpleGit,
  featureBranchName: string,
  tempBranch: string,
): Promise<TempBranchMergeResult> {
  let dir: string
  try {
    dir = mkdtempSync(join(tmpdir(), 'rc-land-'))
  } catch (e) {
    return { ok: false, error: errMsg(e) }
  }
  const wt = join(dir, 'wt')
  try {
    await g.raw(['worktree', 'add', wt, featureBranchName])
    const gw = git(wt)
    try {
      await gw.merge([tempBranch])
    } catch (e) {
      if (await mergeInProgress(gw)) {
        const files = await conflictedFiles(gw) // before the abort clears the index
        await gw.raw(['merge', '--abort'])
        return { ok: false, conflict: true, files, error: errMsg(e) }
      }
      return { ok: false, error: errMsg(e) }
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: errMsg(e) }
  } finally {
    try {
      await g.raw(['worktree', 'remove', '--force', wt])
    } catch {
      // best-effort — a leftover dir under tmp is harmless and swept below
    }
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // best-effort
    }
  }
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

export interface ProjectLandResult {
  /** How many commits were ahead of the base branch when landing started. */
  commits: number
  landed: boolean
  /** True when a real merge conflict kept the branch (nothing was clobbered). */
  conflict?: boolean
  /** Repo-relative conflicting paths, when git reported them. */
  files?: string[]
  error?: string
}

/**
 * Land the project session's commits onto the base branch (decision 18) —
 * `null` when the session wrote nothing, so a quiet conversation costs no
 * timeline noise. Landing is {@link mergeTempBranch} unchanged: it merges in
 * whichever checkout holds the base branch (the human's, fast-forwarded like a
 * `git pull`), fast-forwards the ref when nobody holds it, and merges in a
 * disposable worktree when the base moved ahead. On conflict it refuses rather
 * than clobbers, and `runcastle/project` survives with the work on it —
 * {@link ensureProjectWorktree} retries the landing at the next launch.
 */
export async function landProjectBranch(project: Project): Promise<ProjectLandResult | null> {
  const ahead = await branchCommitsAhead(project.repoPath, project.mainBranch, PROJECT_BRANCH)
  if (ahead.length === 0) return null
  const res = await mergeTempBranch(project.repoPath, project.mainBranch, PROJECT_BRANCH)
  return {
    commits: ahead.length,
    landed: res.ok,
    ...(res.conflict ? { conflict: true } : {}),
    ...(res.files ? { files: res.files } : {}),
    ...(res.error ? { error: res.error } : {}),
  }
}

export interface TempBranchCleanup {
  deleted: string[]
  kept: string[]
}

/** The temp-branch prefix `name` falls under, or `undefined` for user branches. */
function tempBranchPrefix(name: string): string | undefined {
  return TEMP_BRANCH_PREFIXES.find((p) => name.startsWith(p))
}

/**
 * Boot sweep of leftover runcastle temp branches — research AND ticket (server
 * crashed mid-run, or a post-merge delete failed). Deletes ONLY branches fully
 * merged into their feature branch: an unmerged branch holds either AFK commits
 * that never landed or a conflict deliberately preserved for manual recovery —
 * both are kept, never destroyed. Best-effort throughout.
 */
export async function cleanupTempBranches(repoPath: string): Promise<TempBranchCleanup> {
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
    const prefix = tempBranchPrefix(name)
    if (!prefix) continue
    const seg = name.slice(prefix.length).split('/')[0]
    // Candidate feature branches for this segment: the truncated slug (current
    // format, ADR-0003) or the full slug (pre-truncation leftovers). Truncation
    // can make two features share a segment, so check every candidate.
    const targets = seg
      ? all.filter((b) => {
          if (!b.startsWith('feature/')) return false
          const featureSlug = b.slice('feature/'.length)
          return featureSlug === seg || tempBranchSlugSegment(featureSlug) === seg
        })
      : []
    let merged = false
    for (const target of targets) {
      try {
        // NOT `merge-base --is-ancestor`: its "no" is a silent exit 1, which
        // simple-git resolves (it only rejects on stderr). Compare tips instead:
        // the branch is fully merged iff merge-base(branch, target) == its tip.
        const tip = (await g.revparse([name])).trim()
        const base = (await g.raw(['merge-base', name, target])).trim()
        if (tip.length > 0 && tip === base) {
          merged = true
          break
        }
      } catch {
        // unmergeable against this candidate — try the next
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

// --- feature deletion (decision #8) -----------------------------------------

/**
 * Remove a feature's talk worktree at `worktreePath` (feature delete, decision
 * #8). Tries `git worktree remove --force`, falling back to a direct recursive
 * delete of the dir (a stale/unregistered leftover), then prunes the worktree
 * registry. THROWS when the dir still exists afterwards — on Windows a locked
 * file survives both removals, and the caller must surface that clearly and stop
 * BEFORE deleting DB rows so the half-cleanup is retryable, never half-deleted.
 */
export async function removeTalkWorktree(repoPath: string, worktreePath: string): Promise<void> {
  const g = git(repoPath)
  try {
    await g.raw(['worktree', 'remove', '--force', worktreePath])
  } catch {
    // Not a clean registered worktree (stale dir), or a locked file blocked the
    // git removal — fall back to a direct delete, then prune the stale entry.
    try {
      rmSync(worktreePath, { recursive: true, force: true })
    } catch {
      // best-effort — the existsSync guard below turns a real failure into a throw
    }
  }
  try {
    await g.raw(['worktree', 'prune'])
  } catch {
    // best-effort — a leftover registry entry is harmless once the dir is gone
  }
  if (existsSync(worktreePath)) {
    throw new InvalidInputError(
      `could not remove talk worktree at ${worktreePath} — a file may be locked; ` +
        'close anything using it and retry the delete',
    )
  }
}

/**
 * Delete a feature's git branches (feature delete, decision #8): `feature/<slug>`
 * plus every runcastle temp branch (`runcastle/ticket/<seg>/*`,
 * `runcastle/research/<seg>/*`) whose segment matches the feature's slug. Detaches
 * any sandcastle worktree (`.sandcastle/worktrees/*`) still pinning a branch first.
 * Best-effort per branch (matches `deleteTempBranch`): a branch git refuses to
 * delete is reported in `kept`, the rest in `deleted` — the caller does not fail
 * the delete over an orphaned branch (the feature-side commits orphan naturally).
 */
export async function deleteFeatureBranches(
  repoPath: string,
  slug: string,
): Promise<TempBranchCleanup> {
  const deleted: string[] = []
  const kept: string[] = []
  const g = git(repoPath)

  const featureBranchName = featureBranch(slug)
  const seg = tempBranchSlugSegment(slug)
  const tempPrefixes = TEMP_BRANCH_PREFIXES.map((p) => `${p}${seg}/`)

  let all: string[]
  try {
    all = (await g.branchLocal()).all
  } catch {
    return { deleted, kept }
  }

  const targets = all.filter(
    (b) => b === featureBranchName || tempPrefixes.some((p) => b.startsWith(p)),
  )
  for (const branch of targets) {
    if (await deleteBranchDetachingWorktrees(g, repoPath, branch)) deleted.push(branch)
    else kept.push(branch)
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

/** Module-level in-memory drive state (SPEC §7). At most one active, of either
 *  kind — a preparation dry run and a feature test drive collide over the same
 *  repo, ports, dev pane and database server, so they share one slot (decision 9).
 *  `detachedWorktree` records the talk worktree we detached to free the feature
 *  branch for the main checkout, so `stop` reattaches exactly what it detached.
 *  `devPaneId`/`devUrl` track the embedded dev pane and its sniffed localhost URL. */
/**
 * Who a feature drive belongs to: the `human` clicking Test drive, or a
 * `review` ticket booting the integrated branch at the tail of its own burn
 * (improve-workflow decision 4). The machinery is identical — same checkout
 * switch, same hooks, same dev pane — and the purpose decides only two things:
 * whether the active-run denial applies, and who may stop it.
 */
export type DrivePurpose = 'human' | 'review'

type DriveState =
  | {
      kind: 'feature'
      purpose: DrivePurpose
      featureId: string
      branch: string
      previousBranch: string
      detachedWorktree?: string
      devPaneId?: string
      devUrl?: string
      /** Whether the project had a dev command to start (see {@link DriveInfo}). */
      devConfigured: boolean
    }
  | {
      kind: 'dryRun'
      projectId: string
      /** The repo's real current branch — a dry run switches nothing (decision 5). */
      branch: string
      devPaneId?: string
      devUrl?: string
      devConfigured: boolean
      /**
       * The environment rendered once at start, shared by the setup hook, the dev
       * pane and the stop hook — so `dropdb "$DB_NAME"` names the database
       * `createdb "$DB_NAME"` made.
       */
      env: NodeJS.ProcessEnv
      /** What the machinery observed, which is all the verification stamp reads. */
      observed: DryRunObservables
    }

let testDriveState: DriveState | undefined

/**
 * The machinery's own account of a dry run, accumulated as it goes: the only
 * input to the verification verdict (decision 3). The agent's deeper checks —
 * is the database fresh, did migrations apply — decide whether to fix and
 * re-run; they never reach this.
 */
interface DryRunObservables {
  /** `{{placeholders}}` the env render left literal, from the start half. */
  envUnknowns: string[]
  /** `undefined` when the project configured no setup hook. */
  setupOk?: boolean
  /** `undefined` when no stop hook ran (or the run never reached the stop half). */
  teardownOk?: boolean
}

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
  return testDriveState?.kind === 'feature' ? testDriveState.featureId : undefined
}

/** The active drive's info for the UI (dev pane + Open app link), or null. */
export function activeDriveInfo(): DriveInfo | null {
  if (!testDriveState) return null
  return {
    ...(testDriveState.kind === 'feature'
      ? { featureId: testDriveState.featureId }
      : { dryRun: true }),
    branch: testDriveState.branch,
    devPaneId: testDriveState.devPaneId,
    devUrl: testDriveState.devUrl,
    devConfigured: testDriveState.devConfigured,
  }
}

/**
 * Record the first localhost URL sniffed from the drive's dev pane (the "Open
 * app" link). Sticky per drive — the first URL wins — and ignored once the drive
 * has stopped or moved to another feature. Emits `testdrive.url` for the timeline.
 */
export function recordDriveUrl(ctx: AppCtx, featureId: string, url: string): void {
  if (testDriveState?.kind !== 'feature') return
  if (testDriveState.featureId !== featureId || testDriveState.devUrl) return
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
 *
 * `purpose` distinguishes the human's drive from a review ticket's (see
 * {@link DrivePurpose}) and applies to `start` alone: `stop` restores a checkout,
 * which is the same act whoever asks for it — deliberately, so the human's Stop
 * can reclaim the slot from a review agent that died holding it. `reviewDrive`
 * is the review side's entry point and the only caller that passes a purpose.
 */
export async function testDrive(
  ctx: AppCtx,
  project: Project,
  feature: Feature,
  action: 'start' | 'stop',
  purpose: DrivePurpose = 'human',
): Promise<TestDriveResult> {
  const g = git(project.repoPath)
  const branch = featureBranch(feature.slug)
  const scope: EmitScope = { featureId: feature.id }

  if (action === 'stop') {
    if (!testDriveState) return { ok: false, deniedReason: DENY_NONE_ACTIVE }
    // The dry run holds the slot but has no branch to come back from, and only
    // `dryRunDrive` knows how to end it — stopping it from here would strand it.
    if (testDriveState.kind !== 'feature') return { ok: false, deniedReason: DENY_DRY_RUN_ACTIVE }
    const previousBranch = testDriveState.previousBranch
    const detachedWorktree = testDriveState.detachedWorktree
    const devPaneId = testDriveState.devPaneId
    const stoppedPurpose = testDriveState.purpose
    // Kill the whole dev-server process tree first so its port is freed with no
    // orphan (the drive owns the pane; its URL is cleared when state resets).
    if (devPaneId) await stopDevPane(devPaneId)

    // Teardown runs BEFORE the switch back, while the feature branch is still
    // checked out: the environment being torn down belongs to that branch, and
    // so do the files describing it (compose file, migrations). Running it after
    // the switch would hand the command a different repo than the one it built.
    // Same environment the setup hook saw, so `dropdb myapp_{{id}}` names the
    // database `createdb myapp_{{id}}` made.
    const teardown = await runDriveHookStep(
      ctx,
      scope,
      project.repoPath,
      'teardown',
      project.driveStopCommand,
      driveEnvFor(ctx, project, { slug: feature.slug, branch }, scope).env,
    )

    // Capture the dirty tree BEFORE the switch. `start` denies on a dirty tree
    // but `stop` cannot — refusing would strand the user on the feature branch
    // with no way back — so git carries these files across with them. That is
    // how a migration generated during a drive ends up sitting untracked on the
    // branch you returned to; naming it is the whole fix available here.
    const carriedChanges = await dirtyPaths(g)

    await g.checkout(previousBranch)
    // The main checkout has released the feature branch — restore the talk
    // worktree to it (best-effort) so a resumed session picks up where it left.
    if (detachedWorktree) await reattachWorktree(detachedWorktree, branch)
    testDriveState = undefined
    emit(ctx, feature.id, {
      type: 'testdrive.stopped',
      message:
        stoppedPurpose === 'review'
          ? `review drive stopped — back on ${previousBranch}`
          : `test drive stopped — back on ${previousBranch}`,
      data: { branch: previousBranch, purpose: stoppedPurpose },
    })

    if (carriedChanges.length > 0) {
      emit(ctx, feature.id, {
        type: 'testdrive.carried_changes',
        message: `${carriedChanges.length} uncommitted file(s) came back with you onto ${previousBranch}: ${carriedChanges.slice(0, 5).join(', ')}${carriedChanges.length > 5 ? ', …' : ''}`,
        data: { branch: previousBranch, files: carriedChanges },
      })
    }

    const dbDrift = await detectDbDrift(ctx, project, feature, previousBranch, branch)
    return {
      ok: true,
      branch: previousBranch,
      ...(carriedChanges.length > 0 ? { carriedChanges } : {}),
      ...(dbDrift ? { dbDrift } : {}),
      ...(teardown?.failure ? { hookFailure: teardown.failure } : {}),
    }
  }

  // action === 'start' — deny checks in SPEC order: dirty | active | active-run.
  const porcelain = (await g.raw(['status', '--porcelain'])).trim()
  if (porcelain !== '') return { ok: false, deniedReason: DENY_DIRTY }
  if (testDriveState) {
    return {
      ok: false,
      deniedReason: testDriveState.kind === 'dryRun' ? DENY_DRY_RUN_ACTIVE : DENY_ACTIVE,
    }
  }
  // The review carve-out (improve-workflow decision 4): a review ticket burns at
  // the tail of its own run, once every implementation ticket is terminal and
  // the branch is quiet — so the active run it would trip over here is the very
  // one that launched it. Nothing else is waived: the two checks above still
  // deny, and they deny immediately rather than waiting for the slot.
  if (purpose === 'human' && hasActiveRun(ctx, feature.id)) {
    return { ok: false, deniedReason: DENY_ACTIVE_RUN }
  }

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
  testDriveState = {
    kind: 'feature',
    purpose,
    featureId: feature.id,
    branch,
    previousBranch,
    detachedWorktree,
    devConfigured: !!project.devCommand,
  }

  emit(ctx, feature.id, {
    type: 'testdrive.started',
    message:
      purpose === 'review'
        ? `review agent driving ${branch} (was on ${previousBranch})`
        : `test driving ${branch} (was on ${previousBranch})`,
    data: { branch, previousBranch, purpose },
  })

  // Bring the project's environment up before the dev server, so the dev
  // command starts against services that exist. What that means is the
  // project's business — we run its string and report the exit code. Both it
  // and the dev pane below get the same rendered environment, which is how a
  // per-branch database gets created and then connected to.
  const driveEnv = driveEnvFor(ctx, project, { slug: feature.slug, branch }, scope).env
  const setup = await runDriveHookStep(
    ctx,
    scope,
    project.repoPath,
    'setup',
    project.driveSetupCommand,
    driveEnv,
  )

  // Best-effort: spawn the dev command in a drive-owned embedded PTY pane and
  // sniff its localhost URL for the "Open app" link. A spawn failure never fails
  // the drive (startDevPane emits its own event and returns undefined). Started
  // even after a failed setup hook — the pane is where the user debugs it, and
  // withholding it removes the tool at the moment they need it.
  if (project.devCommand) {
    const devPaneId = startDevPane({
      ctx,
      scope,
      repoPath: project.repoPath,
      devCommand: project.devCommand,
      env: driveEnv,
      onUrl: (url) => recordDriveUrl(ctx, feature.id, url),
    })
    if (devPaneId) testDriveState.devPaneId = devPaneId
  }

  return { ok: true, branch, ...(setup?.failure ? { hookFailure: setup.failure } : {}) }
}

// --- review drive -----------------------------------------------------------

/** What one `reviewDrive` action reports back to the review agent. */
export interface ReviewDriveResult {
  ok: boolean
  action: 'start' | 'status' | 'stop'
  /** Why the action was refused. `ok` is false exactly when this is set. */
  deniedReason?: string
  /**
   * The live drive — branch, dev pane, and the `devUrl` sniffed from the dev
   * server's output — or null once it has stopped. The URL is what the agent
   * points its browser at, and it appears on `status` rather than `start`
   * because the dev server has to print it first.
   */
  drive: DriveInfo | null
  /** The drive hook that ran and failed, when one did (setup on `start`, stop on `stop`). */
  hookFailure?: DriveHookFailure
}

/**
 * The review drive: the real feature test drive, started by a review ticket
 * instead of a human (improve-workflow decisions 3, 4).
 *
 * Same machinery as {@link testDrive} — the same checkout switch of the real
 * repo, the same `driveEnv`/setup/dev-pane sequence — because review must
 * exercise the merged branch the human is about to be asked to ship, not a
 * re-enactment of it. Only the run denial is carved out (see the start path).
 *
 * Three actions, because the drive outlives the call that starts it: `start`
 * brings the branch and its dev server up, `status` answers "is there a URL yet"
 * while the agent drives, and `stop` puts the checkout back. Contention is never
 * waited on — a review that cannot have the slot reports why and the ticket
 * fails, which is the advisory-and-best-effort bargain (decision 6).
 */
export async function reviewDrive(
  ctx: AppCtx,
  project: Project,
  feature: Feature,
  action: 'start' | 'status' | 'stop',
): Promise<ReviewDriveResult> {
  if (action === 'start') return startReviewDrive(ctx, project, feature)

  // Only this feature's own review drive is the agent's to look at or end. The
  // human's drive holding the slot is somebody else's — and the human's Stop in
  // the UI remains able to end a review drive, which is how the slot is
  // reclaimed if a review agent dies still holding it.
  if (!reviewDriveFor(feature.id)) {
    return { ok: false, action, deniedReason: DENY_NO_REVIEW_DRIVE, drive: null }
  }
  if (action === 'status') return { ok: true, action: 'status', drive: activeDriveInfo() }

  const stop = await testDrive(ctx, project, feature, 'stop')
  return {
    ok: stop.ok,
    action: 'stop',
    ...(stop.deniedReason ? { deniedReason: stop.deniedReason } : {}),
    drive: activeDriveInfo(),
    ...(stop.hookFailure ? { hookFailure: stop.hookFailure } : {}),
  }
}

/** True while THIS feature's review drive holds the slot. */
function reviewDriveFor(featureId: string): boolean {
  return (
    testDriveState?.kind === 'feature' &&
    testDriveState.purpose === 'review' &&
    testDriveState.featureId === featureId
  )
}

/**
 * The start half. Everything a human drive's start does, minus the active-run
 * denial (the run asking for the drive is the review ticket's own) — and with
 * the slot released again if anything after the checkout switch throws, so a
 * failed start never strands the human on the feature branch.
 */
async function startReviewDrive(
  ctx: AppCtx,
  project: Project,
  feature: Feature,
): Promise<ReviewDriveResult> {
  let start: TestDriveResult
  try {
    start = await testDrive(ctx, project, feature, 'start', 'review')
  } catch (e) {
    if (reviewDriveFor(feature.id)) await testDrive(ctx, project, feature, 'stop')
    throw e
  }
  return {
    ok: start.ok,
    action: 'start',
    ...(start.deniedReason ? { deniedReason: start.deniedReason } : {}),
    drive: activeDriveInfo(),
    ...(start.hookFailure ? { hookFailure: start.hookFailure } : {}),
  }
}

// --- preparation dry-run drive ----------------------------------------------

/**
 * The reserved slug a dry run renders its drive variables from (decision 5), so
 * `{{id}}` becomes `prep_dry_run` and the temp database it creates says what
 * left it. Deliberately fixed: a retry wanting the same name is the point — a
 * leftover database from a failed teardown makes `createdb` fail loudly, which
 * is the "make sure it is new" check enforced by the machinery itself.
 */
const DRY_RUN_SLUG = 'prep-dry-run'

/** A hook as the dry-run result reports it — the tail is what the agent debugs from. */
export interface DryRunHookReport {
  command: string
  ok: boolean
  exitCode: number | null
  timedOut: boolean
  /** Trailing lines of the command's own output (tail-limited by the runner). */
  output: string
}

/** What one `dryRunDrive` action observed, as the MCP tool hands it to the agent. */
export interface DryRunResult {
  ok: boolean
  action: 'start' | 'status' | 'stop'
  /** Why the action was refused. `ok` is false exactly when this is set. */
  deniedReason?: string
  /** The synthetic identity the run renders under (decision 5). */
  identity?: DriveIdentity
  /** NAMES of the variables `driveEnv` rendered — never their values, which can
   *  hold connection strings with credentials in them. */
  envKeys?: string[]
  /** `{{placeholders}}` the render left literal; zero is what verifies `driveEnv`. */
  envUnknowns?: string[]
  setup?: DryRunHookReport
  teardown?: DryRunHookReport
  /** Whether the project has a `devCommand` for this run to start at all. */
  devConfigured?: boolean
  /** Whether the dev pane spawned and its process is still alive. */
  devPaneLive?: boolean
  /** The sniffed localhost URL, once the dev server has printed one. */
  devUrl?: string
  /** `stop` only: the drive-loop keys this pass stamped verified — `[]` on a
   *  failed pass, because verification is all-or-nothing (decision 3). */
  verified?: PreparedKey[]
  /** `stop` only: the observable that failed, when nothing was stamped. */
  failure?: string
}

type DryRunState = Extract<DriveState, { kind: 'dryRun' }>

/**
 * The preparation dry-run drive: the real drive machinery, run under a synthetic
 * identity so a prep session can prove the keys it just recorded (decision 1).
 *
 * Everything a feature drive does except the branch switch — there is no feature
 * and no branch to move to, so the repo stays exactly where it is. It takes the
 * singleton drive slot (decision 9), which is what makes it mutually exclusive
 * with feature drives and visible to the UI as a stoppable active drive.
 *
 * Three actions, because the flow has a hole in the middle by design: `start`
 * brings the environment up, `status` answers "is it up yet" while the agent
 * does the stack-aware checks the server refuses to model, and `stop` tears it
 * down and rules on what the machinery saw.
 */
export async function dryRunDrive(
  ctx: AppCtx,
  project: Project,
  action: 'start' | 'status' | 'stop',
): Promise<DryRunResult> {
  if (action === 'start') return startDryRun(ctx, project)

  if (testDriveState?.kind !== 'dryRun') {
    return { ok: false, action, deniedReason: DENY_NO_DRY_RUN }
  }
  const state = testDriveState
  if (action === 'status') return { ok: true, action, ...liveFields(state) }
  return stopDryRun(ctx, project, state)
}

/**
 * The start half: render the environment, bring the project up, spawn the dev
 * pane. No checkout, no worktree detach — a dry run proves the environment, and
 * moving someone's checkout to prove it would be a worse trade than not proving
 * it at all.
 */
async function startDryRun(ctx: AppCtx, project: Project): Promise<DryRunResult> {
  if (testDriveState) {
    return {
      ok: false,
      action: 'start',
      deniedReason: testDriveState.kind === 'dryRun' ? DENY_DRY_RUN_ACTIVE : DENY_ACTIVE,
    }
  }

  const scope: EmitScope = { projectId: project.id }
  const branch = (await git(project.repoPath).revparse(['--abbrev-ref', 'HEAD'])).trim()
  const identity: DriveIdentity = { slug: DRY_RUN_SLUG, branch }

  emitProject(ctx, project.id, {
    type: 'prep.dryrun.started',
    message: `preparation dry-run drive on ${branch} as \`${DRY_RUN_SLUG}\``,
    data: { branch, slug: DRY_RUN_SLUG },
  })

  const { env, keys, unknown } = driveEnvFor(ctx, project, identity, scope)
  const state: DryRunState = {
    kind: 'dryRun',
    projectId: project.id,
    branch,
    devConfigured: !!project.devCommand,
    env,
    observed: { envUnknowns: unknown },
  }
  testDriveState = state

  const setup = await runDriveHookStep(
    ctx,
    scope,
    project.repoPath,
    'setup',
    project.driveSetupCommand,
    env,
  )
  state.observed.setupOk = setup?.result.ok

  // Same best-effort spawn a feature drive does: a failed spawn emits its own
  // event and leaves `devPaneId` unset, which is the observable `devCommand`
  // then fails on at stop.
  if (project.devCommand) {
    const devPaneId = startDevPane({
      ctx,
      scope,
      repoPath: project.repoPath,
      devCommand: project.devCommand,
      env,
      onUrl: (url) => recordDryRunUrl(ctx, project.id, url),
    })
    if (devPaneId) state.devPaneId = devPaneId
  }

  return {
    ok: true,
    action: 'start',
    envKeys: keys,
    envUnknowns: unknown,
    ...(setup ? { setup: hookReport(setup) } : {}),
    ...liveFields(state),
  }
}

/**
 * The stop half: free the port, tear the environment down, then rule on the
 * whole run.
 *
 * The ruling is the point of the feature. It reads ONLY what the machinery
 * observed — never the agent's own account of it — and stamps all-or-nothing
 * (decision 3), so a run that failed one observable leaves every key exactly as
 * unverified as it was.
 */
async function stopDryRun(
  ctx: AppCtx,
  project: Project,
  state: DryRunState,
): Promise<DryRunResult> {
  const scope: EmitScope = { projectId: project.id }
  // The pane dies first so the dev server has released its port by the time the
  // stop hook goes looking for the things it has to drop.
  if (state.devPaneId) await stopDevPane(state.devPaneId)

  const teardown = await runDriveHookStep(
    ctx,
    scope,
    project.repoPath,
    'teardown',
    project.driveStopCommand,
    state.env,
  )
  state.observed.teardownOk = teardown?.result.ok
  testDriveState = undefined

  emitProject(ctx, project.id, {
    type: 'prep.dryrun.stopped',
    message: `preparation dry-run drive stopped on ${state.branch}`,
    data: { branch: state.branch },
  })

  const { participating, failure } = dryRunVerdict(project, state)
  if (!failure && participating.length > 0) {
    const sha = (await headSha(project.repoPath, project.mainBranch)) ?? null
    markVerified(ctx, project.id, participating, sha)
    emitProject(ctx, project.id, {
      type: 'prep.dryrun.verified',
      message: `dry-run drive verified ${participating.join(', ')}`,
      data: { keys: participating, sha },
    })
  }

  return {
    ok: true,
    action: 'stop',
    identity: { slug: DRY_RUN_SLUG, branch: state.branch },
    envUnknowns: state.observed.envUnknowns,
    ...(teardown ? { teardown: hookReport(teardown) } : {}),
    verified: failure ? [] : participating,
    ...(failure ? { failure } : {}),
  }
}

/**
 * Record the dry run's first sniffed localhost URL — the observable `devCommand`
 * is verified by. Spawning is too weak on its own: a server that crashes on boot
 * still spawns, and the URL is what "Open app" actually depends on.
 */
function recordDryRunUrl(ctx: AppCtx, projectId: string, url: string): void {
  if (testDriveState?.kind !== 'dryRun') return
  if (testDriveState.projectId !== projectId || testDriveState.devUrl) return
  testDriveState.devUrl = url
  emitProject(ctx, projectId, {
    type: 'prep.dryrun.url',
    message: `dry-run dev server ready at ${url}`,
    data: { url },
  })
}

/**
 * Which drive-loop keys this run PARTICIPATED in, and the first observable that
 * failed. A key with no value is simply not part of the run (decision 2), which
 * is why a project with no `devCommand` can still pass cleanly on setup + stop.
 */
function dryRunVerdict(
  project: Project,
  state: DryRunState,
): { participating: PreparedKey[]; failure?: string } {
  const participating: PreparedKey[] = []
  let failure: string | undefined
  for (const key of DRIVE_LOOP_KEYS) {
    if (!project[key]?.trim()) continue
    participating.push(key)
    failure ??= observableFailure(key, state)
  }
  return { participating, ...(failure ? { failure } : {}) }
}

/** Why `key`'s one observable did not pass on this run, or `undefined` when it did. */
function observableFailure(
  key: (typeof DRIVE_LOOP_KEYS)[number],
  state: DryRunState,
): string | undefined {
  const { envUnknowns, setupOk, teardownOk } = state.observed
  switch (key) {
    case 'driveEnv':
      return envUnknowns.length === 0
        ? undefined
        : `driveEnv left ${envUnknowns.map((u) => `{{${u}}}`).join(', ')} unsubstituted`
    case 'driveSetupCommand':
      return setupOk ? undefined : 'driveSetupCommand did not exit 0'
    case 'devCommand':
      if (!state.devPaneId) return 'devCommand never spawned a dev pane'
      return state.devUrl
        ? undefined
        : 'devCommand spawned but printed no localhost URL — "Open app" depends on one'
    case 'driveStopCommand':
      return teardownOk ? undefined : 'driveStopCommand did not exit 0'
  }
}

/** The live half of a dry run's report, shared by every action that has one. */
function liveFields(
  state: DryRunState,
): Pick<DryRunResult, 'identity' | 'devConfigured' | 'devPaneLive' | 'devUrl'> {
  return {
    identity: { slug: DRY_RUN_SLUG, branch: state.branch },
    devConfigured: state.devConfigured,
    devPaneLive: !!state.devPaneId && devPaneLive(state.devPaneId),
    ...(state.devUrl ? { devUrl: state.devUrl } : {}),
  }
}

function hookReport(run: DriveHookRun): DryRunHookReport {
  const { ok, exitCode, timedOut, output } = run.result
  return { command: run.command, ok, exitCode, timedOut, output }
}

/**
 * The environment every child of this drive runs with: the project's `driveEnv`
 * lines, rendered with the drive's own variables, overlaid on the inherited
 * environment.
 *
 * Resolved ONCE per drive and shared by the hooks and the dev pane, because the
 * whole mechanism depends on them agreeing: a setup hook that creates
 * `myapp_{{id}}` and a dev server that connects to a differently-rendered name
 * would be worse than not doing this at all.
 *
 * An unknown `{{placeholder}}` is left literal and reported. Substituting a
 * blank would silently produce a plausible connection string pointing at the
 * wrong database, which is the one outcome worth being noisy about.
 */
function driveEnvFor(
  ctx: AppCtx,
  project: Project,
  identity: DriveIdentity,
  scope: EmitScope,
): { env: NodeJS.ProcessEnv; keys: string[]; unknown: string[] } {
  const { vars, unknown } = parseDriveEnv(project.driveEnv, identity)
  if (unknown.length > 0) {
    emitScoped(ctx, scope, {
      type: 'testdrive.env_unknown_placeholder',
      message: `drive environment left ${unknown.map((u) => `{{${u}}}`).join(', ')} unsubstituted — known variables are {{slug}}, {{branch}}, {{id}}`,
      data: { unknown },
    })
  }
  const keys = Object.keys(vars)
  if (keys.length > 0) {
    emitScoped(ctx, scope, {
      type: 'testdrive.env',
      message: describeDriveEnv(vars),
      // Values can hold credentials; the timeline records WHICH vars, not what.
      data: { keys },
    })
  }
  return { env: driveProcessEnv(vars), keys, unknown }
}

/** One hook step that actually ran: what it did, and the failure a drive reports. */
interface DriveHookRun {
  command: string
  result: DriveHookResult
  /** Absent when the hook exited 0 — a success is timeline material, not an alarm. */
  failure?: DriveHookFailure
}

/**
 * Run one drive hook, narrating it into the timeline the drive belongs to.
 * Returns `undefined` when the project configured no hook for this phase.
 *
 * A hook failure never fails the drive: on `start` the checkout has already
 * switched, and on `stop` the user is mid-exit. Both cases are better served by
 * a loud event quoting the command's own output than by a refusal.
 */
async function runDriveHookStep(
  ctx: AppCtx,
  scope: EmitScope,
  repoPath: string,
  phase: 'setup' | 'teardown',
  command: string | undefined,
  env: NodeJS.ProcessEnv,
): Promise<DriveHookRun | undefined> {
  const cmd = command?.trim()
  if (!cmd) return undefined

  emitScoped(ctx, scope, {
    type: `testdrive.${phase}_started`,
    message:
      phase === 'setup'
        ? `preparing environment: \`${cmd}\``
        : `tearing down environment: \`${cmd}\``,
    data: { command: cmd },
  })

  const result = await runDriveHook(cmd, { cwd: repoPath, env })
  if (result.ok) {
    emitScoped(ctx, scope, {
      type: `testdrive.${phase}_ok`,
      message: describeHookResult(cmd, result),
      data: { command: cmd, durationMs: result.durationMs },
    })
    return { command: cmd, result }
  }

  emitScoped(ctx, scope, {
    type: `testdrive.${phase}_failed`,
    message: `${describeHookResult(cmd, result)}${result.output ? `\n${result.output}` : ''}`,
    data: {
      command: cmd,
      exitCode: result.exitCode,
      timedOut: result.timedOut,
      output: result.output,
    },
  })
  return {
    command: cmd,
    result,
    failure: {
      phase,
      command: cmd,
      exitCode: result.exitCode,
      timedOut: result.timedOut,
      output: result.output,
    },
  }
}

/** Repo-relative paths with uncommitted changes (tracked or not), or `[]`. */
async function dirtyPaths(g: SimpleGit): Promise<string[]> {
  try {
    const out = (await g.raw(['status', '--porcelain'])).trim()
    if (!out) return []
    return out
      .split('\n')
      // Porcelain v1: two status chars, a space, then the path. A rename is
      // `R  old -> new`; the destination is the file that actually exists now.
      .map((line) => line.slice(3).trim())
      .map((p) => (p.includes(' -> ') ? (p.split(' -> ').at(-1) ?? p) : p))
      .map((p) => p.replace(/^"|"$/g, ''))
      .filter(Boolean)
  } catch {
    return []
  }
}

/**
 * Whether the drive just stopped could have left the dev database ahead of the
 * branch the user returned to, and what to do about it.
 *
 * The question asked is narrow on purpose: not "did anything change" but "do
 * the two branches disagree about migration files". A drive of a UI-only
 * feature costs nothing here, which is what keeps the warning meaningful when
 * it does fire.
 *
 * Emits `testdrive.db_drift` and returns the drift. Never throws and never
 * fails the stop — the drive HAS stopped by the time this runs, and a git
 * failure here must not turn that into an error.
 */
async function detectDbDrift(
  ctx: AppCtx,
  project: Project,
  feature: Feature,
  previousBranch: string,
  driveBranch: string,
): Promise<DbDrift | undefined> {
  let files: string[]
  try {
    files = migrationPaths(await diffPaths(project.repoPath, previousBranch, driveBranch))
  } catch {
    return undefined
  }
  if (files.length === 0) return undefined

  const resetCommand = project.dbResetCommand?.trim() || undefined
  const drift: DbDrift = { files, ...(resetCommand ? { resetCommand } : {}) }

  emit(ctx, feature.id, {
    type: 'testdrive.db_drift',
    message:
      `${driveBranch} and ${previousBranch} differ by ${files.length} migration file(s) — ` +
      'anything you migrated during the drive is still applied to your dev database, so the next ' +
      `migrate on ${previousBranch} may report drift. ` +
      (resetCommand
        ? `Rebuild it with: ${resetCommand}`
        : 'Set a "Database reset command" in project settings to get a one-click fix here.'),
    data: { files, previousBranch, driveBranch, resetCommand: resetCommand ?? null },
  })
  return drift
}

// --- merge ------------------------------------------------------------------

/**
 * Merge `feature/<slug>` into its base branch (`feature.baseBranch`, default
 * `project.mainBranch`) with `--no-ff` — a feature lands back on the branch it
 * was forked from, not unconditionally on main. Denies (via `GateError` →
 * PRECONDITION_FAILED) while a test drive is active or the main checkout is
 * dirty. On conflict it aborts and reports `{ ok: false, conflict: true }`,
 * leaving the checkout clean either way. The resolved `target` is always
 * returned so the caller can report/record it.
 *
 * The merge has to check out `target` to build the `--no-ff` commit, but the
 * user's checkout is a shared surface — silently parking them on `develop` after
 * shipping a develop-based feature is a footgun (accidental commits to the wrong
 * branch). So we record where the checkout was and restore it afterwards
 * (best-effort — the merge has already landed; a failed restore must not fail
 * the ship). A detached HEAD is left as-is.
 *
 * The active-drive guard is a safety net: the merge tRPC handler already stops a
 * drive of the SAME feature first (via `activeTestDriveFeatureId`), so in the
 * normal flow this only fires when a DIFFERENT feature is being test-driven.
 */
export async function mergeFeature(project: Project, feature: Feature): Promise<MergeResult> {
  const target = mergeTarget(project, feature)

  if (testDriveState) {
    throw new GateError('Cannot merge while a test drive is active — stop it first')
  }

  const g = git(project.repoPath)
  const porcelain = (await g.raw(['status', '--porcelain'])).trim()
  if (porcelain !== '') {
    throw new GateError('Cannot merge — working tree has uncommitted changes')
  }

  const branches = await g.branchLocal()
  if (!branches.all.includes(target)) {
    throw new GateError(`Cannot merge — base branch "${target}" no longer exists`)
  }

  const previous = (await g.revparse(['--abbrev-ref', 'HEAD'])).trim()
  const branch = featureBranch(feature.slug)
  await g.checkout(target)

  try {
    await g.merge(['--no-ff', branch])
    await restoreBranch(g, previous, target)
    return { ok: true, target }
  } catch (e) {
    if (await mergeInProgress(g)) {
      // Capture the conflicting files WHILE the merge is still in progress (the
      // abort clears the unmerged index), so the review UI can list them and
      // brief the resolve-with-agent session.
      const files = await conflictedFiles(g)
      await g.raw(['merge', '--abort'])
      await restoreBranch(g, previous, target)
      return { ok: false, conflict: true, target, files }
    }
    // Not a conflict (e.g. unknown branch) — surface the real failure.
    throw e instanceof Error ? e : new Error(errMsg(e))
  }
}

/**
 * Restore the checkout to `previous` after a merge that had to check out
 * `target`. No-op when they match or when `previous` is a detached HEAD (git
 * reports `HEAD`), which we can't meaningfully return to by name. Best-effort:
 * the merge already landed, so a restore failure is swallowed (the caller keeps
 * the checkout on `target` rather than turning a shipped feature into an error).
 */
async function restoreBranch(g: SimpleGit, previous: string, target: string): Promise<void> {
  if (previous === target || previous === 'HEAD' || !previous) return
  try {
    await g.checkout(previous)
  } catch {
    // leave the checkout on `target` — a shipped feature must never fail here
  }
}

/**
 * Repo-relative paths with unresolved conflicts in the in-progress merge
 * (`--diff-filter=U`). Called before `merge --abort`, which clears the unmerged
 * index. Returns `[]` on any parse failure — a missing list must not turn a
 * reported conflict into a thrown error.
 */
async function conflictedFiles(g: SimpleGit): Promise<string[]> {
  try {
    const out = (await g.raw(['diff', '--name-only', '--diff-filter=U'])).trim()
    return out ? out.split('\n').map((s) => s.trim()).filter(Boolean) : []
  } catch {
    return []
  }
}

/**
 * Is a merge in progress in the checkout at `worktreePath`? The edit guard's
 * probe (a `resolve-conflict` session may write files only while its merge is
 * unresolved), asked of a path rather than of a `SimpleGit` the caller had to
 * build.
 *
 * Deliberately a git question, not a file test: a talk worktree's `.git` is a
 * FILE pointing at the real git dir, so `<worktree>/.git/MERGE_HEAD` never
 * exists there and a naive check would deny every resolve. Never throws — a
 * worktree that has been removed, or a path that was never a repo, answers
 * false, which just means the guard applies its ordinary rules.
 */
export async function mergeInProgressAt(worktreePath: string): Promise<boolean> {
  try {
    return await mergeInProgress(git(worktreePath))
  } catch {
    return false
  }
}

/**
 * Is `ancestor` reachable from `descendant` in the repo at `repoPath` — i.e. has
 * the merge landed? Asked at the end of a `resolve-conflict` session: once the
 * resolver commits `git merge <mergeFrom>`, the branch it merged from is an
 * ancestor of the branch it merged into, which is what `merge.resolved` reports.
 *
 * Not `merge-base --is-ancestor` despite that being the natural spelling: it
 * answers with its EXIT CODE and prints nothing, and simple-git resolves a
 * silent non-zero exit rather than rejecting it (the same trap
 * {@link mergeInProgress} documents) — every pair would answer true. Counting
 * the commits `ancestor` has that `descendant` lacks decides on the output:
 * none means it landed, and an identical pair counts zero exactly as git's own
 * `--is-ancestor` answers yes. Never throws — an unknown branch or a worktree
 * that has gone missing answers false, i.e. "not landed as far as we can tell",
 * and the enabled Merge & ship retry carries the load.
 */
export async function isAncestor(
  repoPath: string,
  ancestor: string,
  descendant: string,
): Promise<boolean> {
  try {
    const out = await git(repoPath).raw(['rev-list', '--count', ancestor, `^${descendant}`])
    return out.trim() === '0'
  } catch {
    return false
  }
}

/**
 * True iff a merge is currently in progress (MERGE_HEAD present).
 *
 * Decided on the OUTPUT, not on whether the call threw: `--quiet` suppresses
 * git's stderr on a missing ref, and simple-git resolves a silent non-zero exit
 * rather than rejecting it — so "it did not throw" answered true for every repo,
 * merge or no merge. An absent MERGE_HEAD prints nothing; a present one prints
 * its sha.
 */
async function mergeInProgress(g: SimpleGit): Promise<boolean> {
  try {
    return (await g.raw(['rev-parse', '--verify', '--quiet', 'MERGE_HEAD'])).trim() !== ''
  } catch {
    return false
  }
}
