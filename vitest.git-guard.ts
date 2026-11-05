/**
 * Test-run guard: no test may reach the git repo the tests run from
 * (docs/features/small-fixes-the-waiting-line-design-waits-and-tests-that-touch-the-real-repo,
 * decisions 6–8).
 *
 * On 2026-11-02 a test run re-initialised the developer's real repo as bare
 * and left a stash in it. Git exports `GIT_DIR` & co to hooks and other
 * children; a test that inherits them and runs `git init` in its scratch dir
 * re-initialises the repo they name instead, and with `GIT_DIR` set to a linked
 * worktree's git dir that writes `core.bare = true` into the main repo.
 *
 * Two defences, both here so they cannot drift apart:
 * - {@link stripGitRepoEnv} deletes those variables. `vitest.setup.ts` calls it
 *   in every worker, and this file's global setup in the main process before
 *   any worker starts, so every git child a test spawns inherits a clean env.
 * - The global setup ({@link guardRepo}) records the repo's `[core]` config and
 *   its stash list before the run and fails the run if either changed. It
 *   repairs nothing. The rest of the config is not watched: runcastle's own
 *   burns and branch setup write it while tests run.
 */
import { spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'

/**
 * Git's repo-location variables: `git rev-parse --local-env-vars` on git 2.43,
 * hard-coded so test setup spawns nothing. Author, committer and editor
 * variables are not on it and stay.
 */
export const GIT_REPO_ENV = [
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_CONFIG',
  'GIT_CONFIG_PARAMETERS',
  'GIT_CONFIG_COUNT',
  'GIT_OBJECT_DIRECTORY',
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_IMPLICIT_WORK_TREE',
  'GIT_GRAFT_FILE',
  'GIT_INDEX_FILE',
  'GIT_NO_REPLACE_OBJECTS',
  'GIT_REPLACE_REF_BASE',
  'GIT_PREFIX',
  'GIT_SHALLOW_FILE',
  'GIT_COMMON_DIR',
] as const

/** Delete git's repo-location variables from `env` (the process's own by default). */
export function stripGitRepoEnv(env: NodeJS.ProcessEnv = process.env): void {
  for (const key of GIT_REPO_ENV) delete env[key]
}

/** What the guard compares: the repo's `[core]` entries and its stash, one line each. */
export interface RepoSnapshot {
  /** The repo's git common dir: the main repo's `.git` when run from a worktree. */
  commonDir: string
  core: string[]
  stash: string[]
}

function git(cwd: string, args: string[]): { ok: boolean; out: string } {
  const env = { ...process.env }
  stripGitRepoEnv(env)
  const run = spawnSync('git', args, { cwd, env, encoding: 'utf8', windowsHide: true })
  return { ok: run.status === 0, out: (run.stdout ?? '').trim() }
}

const lines = (out: string): string[] => (out ? out.split('\n') : [])

/** The repo's `[core]` config and stash list, read from its common dir. */
export function snapshotCommonDir(commonDir: string): RepoSnapshot {
  // Exit 1 means no `core.*` entry at all, which is a state like any other.
  const core = git(commonDir, ['config', '--file', join(commonDir, 'config'), '--get-regexp', '^core\\.'])
  const hasStash = git(commonDir, ['--git-dir', commonDir, 'rev-parse', '--verify', '--quiet', 'refs/stash']).ok
  const stash = hasStash ? git(commonDir, ['--git-dir', commonDir, 'log', '-g', '--format=%H %gs', 'refs/stash', '--']).out : ''
  return { commonDir, core: lines(core.out), stash: lines(stash) }
}

/** The snapshot of the repo `cwd` is in, or null when it is in none. */
export function snapshotRepo(cwd: string): RepoSnapshot | null {
  const found = git(cwd, ['rev-parse', '--git-common-dir'])
  if (!found.ok || !found.out) return null
  return snapshotCommonDir(resolve(cwd, found.out))
}

/** What changed between two snapshots, one line per entry, empty when nothing did. */
export function repoChanges(before: RepoSnapshot, after: RepoSnapshot): string[] {
  const diff = (label: string, was: string[], now: string[]): string[] => [
    ...now.filter((l) => !was.includes(l)).map((l) => `${label} added:   ${l}`),
    ...was.filter((l) => !now.includes(l)).map((l) => `${label} removed: ${l}`),
  ]
  return [...diff('config', before.core, after.core), ...diff('stash', before.stash, after.stash)]
}

/**
 * Record the repo `cwd` is in, and hand back the check that throws if its
 * `[core]` config or stash changed since. Nothing to guard outside a repo.
 */
export function guardRepo(cwd: string): (() => void) | undefined {
  const before = snapshotRepo(cwd)
  if (!before) return undefined
  return () => {
    const changes = repoChanges(before, snapshotCommonDir(before.commonDir))
    if (changes.length === 0) return
    throw new Error(
      [
        `This test run changed the git repo it runs from (${before.commonDir}):`,
        ...changes.map((c) => `  ${c}`),
        'A test may have reached the real repo instead of its scratch dir; check its git calls and env.',
        'Another session working in the same repo during the run could also have made this change.',
        'Nothing was repaired.',
      ].join('\n'),
    )
  }
}

/**
 * Vitest's global setup: strip the main process, then guard the repo for the
 * whole run. Vitest only logs an error thrown from a global teardown and still
 * exits 0, so the teardown also fails the process itself.
 */
export default function setup(): (() => void) | undefined {
  stripGitRepoEnv()
  const check = guardRepo(process.cwd())
  if (!check) return undefined
  return () => {
    try {
      check()
    } catch (err) {
      process.exitCode = 1
      throw err
    }
  }
}
