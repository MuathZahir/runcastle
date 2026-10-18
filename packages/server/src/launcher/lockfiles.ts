/**
 * Lockfiles, newest-convention first — the first one present names the manager.
 *
 * Shared by the prepare host probe (which reads the manager off it) and the edit
 * guard (which lets a `prepare` session write it when it installs the UI-states
 * dev dependencies), so the two can never disagree about what a lockfile is.
 */
export const LOCKFILES: readonly (readonly [file: string, manager: string])[] = [
  ['bun.lock', 'bun'],
  ['bun.lockb', 'bun'],
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['package-lock.json', 'npm'],
  ['uv.lock', 'uv'],
  ['poetry.lock', 'poetry'],
  ['Cargo.lock', 'cargo'],
  ['go.sum', 'go'],
]
