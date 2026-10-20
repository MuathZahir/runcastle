/**
 * Lockfiles, newest-convention first — the first one present names the manager.
 * The prepare host probe reads the manager off it.
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
