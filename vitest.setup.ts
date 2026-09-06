/**
 * Test-env firewall: the state a test file must never inherit — the
 * developer's runcastle env, and Bun's unusable `localStorage`.
 *
 * Runs in every worker before any test file. It deletes every `RUNCASTLE_*`
 * variable it finds, so a test process can never inherit the developer's live
 * runcastle state.
 *
 * The footgun this closes: a test run started from a shell that has runcastle
 * env exported — `bun run dev` sets `RUNCASTLE_DATA_DIR`, and a talk session
 * spawns its agent with the whole runcastle env — silently reads the real
 * install. `RUNCASTLE_DATA_DIR` in particular OUTRANKS the home override in
 * core's `dataDir()`, so the temp-`HOME` isolation the git/runner/session tests
 * rely on is bypassed entirely and they run against the developer's actual
 * `~/.runcastle`: stale migrations, real projects, real worktrees.
 *
 * Deleting is safe because no test reads an inherited value: the ones that
 * exercise env handling either inject an env object (`resolveTool({ env })`,
 * `getSettings(…, io({…}))`) or set the variable themselves and restore it
 * afterwards.
 */
for (const key of Object.keys(process.env)) {
  if (key.startsWith('RUNCASTLE_')) delete process.env[key]
}

/** The whole of the DOM `Storage` contract, which this file has no DOM lib for. */
type StorageLike = {
  readonly length: number
  clear(): void
  getItem(key: string): string | null
  key(index: number): string | null
  removeItem(key: string): void
  setItem(key: string, value: string): void
}

/**
 * A `localStorage` that works.
 *
 * `bun run test` runs the vitest bin under the Bun runtime, whose global
 * `localStorage` throws `SecurityError: Cannot initialize local storage without
 * a --localstorage-file path` the moment anything touches it. A DOM environment
 * does not save the day: vitest only copies a window global onto `globalThis`
 * when the key is not already taken, so Bun's placeholder outlives happy-dom
 * setup and crashes every test file that stores anything — in `beforeEach`,
 * before a line of app code runs.
 *
 * The alternative, handing the runner `--localstorage-file`, buys a real file on
 * disk shared by every worker; an in-memory stub is per-worker by construction.
 * It is left `configurable` because tests swap the descriptor for a fake of
 * their own and put back what they found (`apps/web/test/projects.test.ts`).
 */
function localStorageWorks(): boolean {
  try {
    const storage = (globalThis as { localStorage?: StorageLike }).localStorage
    if (!storage) return false
    // Bun's placeholder throws on the property read above; a stricter one would
    // throw here instead, so the probe has to actually store something.
    storage.setItem('runcastle.storage.probe', '1')
    storage.removeItem('runcastle.storage.probe')
    return true
  } catch {
    return false
  }
}

function memoryStorage(): StorageLike {
  const entries = new Map<string, string>()
  return {
    get length() {
      return entries.size
    },
    clear: () => entries.clear(),
    getItem: (key) => entries.get(key) ?? null,
    key: (index) => [...entries.keys()][index] ?? null,
    removeItem: (key) => void entries.delete(key),
    setItem: (key, value) => void entries.set(key, value),
  }
}

if (!localStorageWorks()) {
  Object.defineProperty(globalThis, 'localStorage', {
    value: memoryStorage(),
    configurable: true,
    writable: true,
  })
}
