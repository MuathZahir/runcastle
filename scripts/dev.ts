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

/** Packages whose `dev` script the root launcher starts concurrently. */
export const DEV_FILTERS = ['@runcastle/server', '@runcastle/web'] as const

/** Args for `<bun> run --filter <filter> dev`, spawned per package. */
export function devArgs(filter: string): string[] {
  return ['run', '--filter', filter, 'dev']
}

export function startDev(): void {
  // `process.execPath` is the running bun binary — avoids PATH/`.exe` resolution
  // differences between POSIX and Windows.
  const children = DEV_FILTERS.map((filter) =>
    spawn(process.execPath, devArgs(filter), { stdio: 'inherit' }),
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
