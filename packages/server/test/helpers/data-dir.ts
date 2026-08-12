import { join } from 'node:path'

/**
 * Redirect runcastle's data dir into `home` for the duration of one test, and
 * return the function that restores the previous environment.
 *
 * Overriding HOME/USERPROFILE alone is not enough. Core's `dataDir()` reads
 * `RUNCASTLE_DATA_DIR` first and only falls back to `~/.runcastle`, so a test
 * that pins the home but not the variable still resolves to whatever the
 * ambient environment says. A run started from a shell with runcastle env
 * exported — `bun run dev` sets it, and a talk session hands its whole env to
 * the agent it spawns — therefore reads the developer's real install: real
 * projects, real worktrees, migrations from a different build. `vitest.setup.ts`
 * strips that state before any test file loads; pinning the variable here means
 * these tests do not depend on it having been stripped.
 */
export function useDataDir(home: string): () => void {
  const prev = {
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    RUNCASTLE_DATA_DIR: process.env.RUNCASTLE_DATA_DIR,
  }
  process.env.HOME = home
  process.env.USERPROFILE = home
  process.env.RUNCASTLE_DATA_DIR = join(home, '.runcastle')
  return () => {
    for (const [key, value] of Object.entries(prev)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}
