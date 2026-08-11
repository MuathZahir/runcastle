/**
 * Cross-platform dev launcher.
 *
 * `bun run --filter A --filter B dev` runs filtered scripts in dependency order
 * on POSIX and blocks on the server's never-returning `bun --hot`, so the web
 * dev server is queued behind it and never starts (docs/research/POSIX-VERIFICATION.md
 * §2 — verified on Linux). Spawning each package's `dev` script as its own
 * concurrent child sidesteps that: both start immediately, on every platform.
 */
import { execFile, spawn, type SpawnOptions } from 'node:child_process'
import { promisify } from 'node:util'
import { devDataDir } from '../packages/core/src/paths.ts'

const execFileAsync = promisify(execFile)

/** Packages whose `dev` script the root launcher starts concurrently. */
export const DEV_FILTERS = ['@runcastle/server', '@runcastle/web'] as const

/** Args for `<bun> run --filter <filter> dev`, spawned per package. */
export function devArgs(filter: string): string[] {
  return ['run', '--filter', filter, 'dev']
}

/**
 * Environment for the dev children. Two additions, both about keeping dev and a
 * real install apart:
 *
 * - `RUNCASTLE_DATA_DIR` → `~/.runcastle-dev/`, so the dev server gets its own
 *   db, config, `.env` and worktrees. Without it `bun run dev` and an installed
 *   `runcastle` share one db, and every destructive test (wipe the projects,
 *   force a phase, re-run onboarding) hits the developer's real work.
 * - `RUNCASTLE_DEV=1` — the marker that says "this process is a checkout, not an
 *   install". The published bin never sets it.
 *
 * An explicit `RUNCASTLE_DATA_DIR` from the caller wins, so a contributor can
 * still point dev at a scratch tree of their choosing.
 */
export function devEnv(
  base: NodeJS.ProcessEnv = process.env,
  dataDir: string = devDataDir(),
): NodeJS.ProcessEnv {
  return { ...base, RUNCASTLE_DEV: '1', RUNCASTLE_DATA_DIR: base.RUNCASTLE_DATA_DIR ?? dataDir }
}

/**
 * Spawn options for one dev child. Split out as a pure unit because the spawn
 * itself cannot be observed by a test, and `detached` is load-bearing.
 *
 * Each child is `bun run --filter <pkg> dev`, so the process that actually binds
 * 4512/4513 is its GRANDCHILD. On POSIX a group signal is the only way to reach
 * it, and a child gets its own group only when detached — otherwise it shares
 * ours, which a group signal must never name. Windows walks the child list
 * instead (`taskkill /T`), and `detached` there means a new console window.
 */
export function devSpawnOptions(env: NodeJS.ProcessEnv): SpawnOptions {
  return { stdio: 'inherit', env, detached: process.platform !== 'win32' }
}

/**
 * Kill the process tree rooted at `pid`, best-effort. A local copy of
 * `packages/server/src/pty/kill-tree.ts` — deliberately duplicated rather than
 * imported, because a repo-root script reaching into a package's internals to
 * share ten lines costs more than the ten lines.
 *
 * Never rejects: a tree that is already gone is the normal case at teardown.
 */
export async function killTree(pid: number): Promise<void> {
  try {
    if (process.platform === 'win32') {
      await execFileAsync('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true })
    } else {
      // Negative pid → the whole process group (see `devSpawnOptions`).
      process.kill(-pid, 'SIGTERM')
    }
  } catch {
    // Already gone, or a pid the OS has since reused — nothing to do either way.
  }
}

export function startDev(): void {
  const env = devEnv()
  console.log(`runcastle dev — data dir: ${env.RUNCASTLE_DATA_DIR}`)

  // `process.execPath` is the running bun binary — avoids PATH/`.exe` resolution
  // differences between POSIX and Windows.
  const children = DEV_FILTERS.map((filter) =>
    spawn(process.execPath, devArgs(filter), devSpawnOptions(env)),
  )

  let down = false
  const stop = (signal: NodeJS.Signals): void => {
    if (down) return
    down = true
    // Tree first, then the direct child as a backstop: killing the child first
    // breaks the parent → child link `taskkill /T` walks, which is how a dev
    // server kept holding 4512 after Ctrl-C — the next run then either failed on
    // Vite's `strictPort` or was fooled by the stale server still answering
    // /health.
    for (const c of children) {
      if (c.pid === undefined) continue
      void killTree(c.pid).then(() => c.kill(signal))
    }
  }

  for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => stop(sig))

  for (const child of children) {
    child.on('exit', (code) => {
      if (down) return
      // One dev process died — tear the rest down and propagate the failure.
      stop('SIGTERM')
      process.exitCode = code ?? 1
    })
  }
}

if (import.meta.main) startDev()
