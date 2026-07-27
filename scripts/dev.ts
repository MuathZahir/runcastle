/**
 * Cross-platform dev launcher.
 *
 * `bun run --filter A --filter B dev` runs filtered scripts in dependency order
 * on POSIX and blocks on the server's never-returning `bun --hot`, so the web
 * dev server is queued behind it and never starts (docs/research/POSIX-VERIFICATION.md
 * §2 — verified on Linux). Spawning each package's `dev` script as its own
 * concurrent child sidesteps that: both start immediately, on every platform.
 */
import { spawn } from 'node:child_process'
import { devDataDir } from '../packages/core/src/paths.ts'

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

export function startDev(): void {
  const env = devEnv()
  console.log(`runcastle dev — data dir: ${env.RUNCASTLE_DATA_DIR}`)

  // `process.execPath` is the running bun binary — avoids PATH/`.exe` resolution
  // differences between POSIX and Windows.
  const children = DEV_FILTERS.map((filter) =>
    spawn(process.execPath, devArgs(filter), { stdio: 'inherit', env }),
  )

  let down = false
  const stop = (signal: NodeJS.Signals): void => {
    if (down) return
    down = true
    for (const c of children) c.kill(signal)
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
