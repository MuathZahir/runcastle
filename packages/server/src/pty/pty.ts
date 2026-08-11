import { createRequire } from 'node:module'
import { explainSpawnFailure } from '../util/resolve-executable'
import { killProcessTree } from './kill-tree'
import { createSidecarPtySession } from './pty-sidecar'

/**
 * The single PTY interface (UI-SPEC §5). Everything above this line — registry,
 * WebSocket transport, launcher — talks to `createPtySession` and never imports
 * `node-pty` directly, so the backend implementation stays swappable behind this
 * one function.
 *
 * SHIPPED PATH — TWO BACKENDS, selected at spawn time (`selectBackend`):
 *
 * - **sidecar** (`pty-sidecar.ts` + `pty-host.cjs` under system `node`): the
 *   default under **Bun on win32**. node-pty v1.1.0's Windows ConPTY backend
 *   writes keystrokes to the child through a Node `net.Socket` input pipe; under
 *   Bun that socket is unusable and `write()` throws `ERR_SOCKET_CLOSED`, so
 *   INPUT is silently dropped (OUTPUT works — it uses a different read path).
 *   Hosting node-pty in a real `node` process restores input. Reproduced: under
 *   Bun `write()` threw and echo delta was 0; under Node the same write echoed.
 *
 * - **native** (bun/node-native `node-pty`, below): used off-win32, and under a
 *   `node` runtime (e.g. the vitest suite) where the input pipe works fine. Kept
 *   present and exercised by tests so it never bit-rots.
 *
 * Selection is deterministic (no async probe — the write failure is not flaky
 * but a fixed Bun↔node-pty incompatibility) and overridable via
 * `RUNCASTLE_PTY_BACKEND=sidecar|native`. `node-pty` is a native CommonJS addon
 * loaded lazily via `createRequire` on first native spawn (not at import time),
 * so importing the launcher/index — as the tests and `buildApp` do — never
 * touches the binding.
 */

export interface PtySession {
  /** Subscribe to raw PTY output. Returns a disposer. */
  onData(listener: (data: Buffer) => void): { dispose(): void }
  /** Subscribe to process exit. Returns a disposer. */
  onExit(listener: (event: { exitCode: number; signal?: number }) => void): {
    dispose(): void
  }
  /** Write keystrokes/bytes to the PTY. */
  write(data: string): void
  /** Resize the pseudo-terminal. */
  resize(cols: number, rows: number): void
  /** Terminate the process (ConPTY on Windows). */
  kill(): void
  /**
   * Kill the whole process tree this backend owns, best-effort. Distinct from
   * `kill()`, which ends only the PTY itself and leaves grandchildren running —
   * on win32 that is the dev server behind the `cmd.exe` shim, still holding its
   * port. Each backend kills a process it owns rather than one it inferred, so
   * the pid is never guessed across a process boundary. Never rejects.
   */
  killTree(): Promise<void>
  /** OS process id of the spawned shell. */
  readonly pid: number
  /** True once the process has exited. */
  readonly killed: boolean
}

export interface CreatePtyOptions {
  cwd: string
  env: Record<string, string | undefined>
  cols?: number
  rows?: number
  /** Use ConPTY on Windows (default true — the modern, correct backend). */
  useConpty?: boolean
}

// --- node-pty shape (structural; avoids depending on its exported types at the
// import graph level so the lazy-load boundary is honoured) --------------------

interface IDisposable {
  dispose(): void
}
interface NodePtyProcess {
  readonly pid: number
  onData(cb: (d: string | Buffer) => void): IDisposable
  onExit(cb: (e: { exitCode: number; signal?: number }) => void): IDisposable
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(signal?: string): void
}
interface NodePtySpawnOptions {
  name?: string
  cols?: number
  rows?: number
  cwd?: string
  env?: Record<string, string>
  useConpty?: boolean
}
interface NodePtyModule {
  spawn(file: string, args: string[] | string, opts: NodePtySpawnOptions): NodePtyProcess
}

let cached: NodePtyModule | null = null

/** Lazily load the native `node-pty` addon (once). */
function loadNodePty(): NodePtyModule {
  if (cached) return cached
  const require = createRequire(import.meta.url)
  cached = require('node-pty') as NodePtyModule
  return cached
}

/** Drop only the keys node-pty rejects: env values must be strings. */
function cleanEnv(env: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(env)) {
    if (typeof v === 'string') out[k] = v
  }
  return out
}

type Backend = 'native' | 'sidecar'

function isBun(): boolean {
  return typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined'
}

const BACKEND_LOGGED = Symbol.for('runcastle.pty.backend.logged')

/**
 * Pick a PTY backend. Sidecar is the default under Bun on win32 (node-pty's
 * ConPTY input pipe is unusable there — see the file header); native everywhere
 * else. `RUNCASTLE_PTY_BACKEND` overrides for tests / escape hatch. The choice is
 * logged exactly once per process (survives `bun --hot` via a global symbol).
 */
function selectBackend(): Backend {
  const override = process.env.RUNCASTLE_PTY_BACKEND
  let backend: Backend
  let why: string
  if (override === 'sidecar' || override === 'native') {
    backend = override
    why = 'RUNCASTLE_PTY_BACKEND override'
  } else if (isBun() && process.platform === 'win32') {
    backend = 'sidecar'
    why = 'Bun+win32: node-pty ConPTY input pipe (node:net socket) unusable under Bun'
  } else {
    backend = 'native'
    why = isBun() ? 'Bun off-win32' : 'node runtime'
  }
  const g = globalThis as typeof globalThis & { [BACKEND_LOGGED]?: boolean }
  if (!g[BACKEND_LOGGED]) {
    g[BACKEND_LOGGED] = true
    console.error(`[pty] backend=${backend} (${why})`)
  }
  return backend
}

/**
 * Spawn a process inside a pseudo-terminal and return the runcastle PTY handle.
 * Dispatches to the sidecar or native backend (`selectBackend`); both honour the
 * same interface so registry / WS / launcher are backend-agnostic.
 */
export function createPtySession(
  cmd: string,
  args: string[],
  opts: CreatePtyOptions,
): PtySession {
  return selectBackend() === 'sidecar'
    ? createSidecarPtySession(cmd, args, opts)
    : createNativePtySession(cmd, args, opts)
}

/**
 * Native (in-process `node-pty`) backend. Output listeners always receive a
 * `Buffer` (node-pty is spawned WITHOUT an encoding so bytes pass through
 * untouched — the consumer's UTF-8 decoder owns reassembly). Works fully under a
 * `node` runtime; under Bun on win32 its `write()` throws `ERR_SOCKET_CLOSED`,
 * which is why `selectBackend` routes Bun+win32 to the sidecar instead.
 */
export function createNativePtySession(
  cmd: string,
  args: string[],
  opts: CreatePtyOptions,
): PtySession {
  const pty = loadNodePty()
  let proc: NodePtyProcess
  try {
    proc = pty.spawn(cmd, args, {
      name: 'xterm-256color',
      cols: opts.cols ?? 80,
      rows: opts.rows ?? 24,
      cwd: opts.cwd,
      env: cleanEnv(opts.env),
      useConpty: opts.useConpty ?? true,
    })
  } catch (err) {
    // This throw is synchronous, so it reaches the launcher's try/catch and
    // becomes a `session.spawn_failed` event — worth carrying the explanation
    // rather than node-pty's bare `File not found: ` (see explainSpawnFailure).
    throw new Error(explainSpawnFailure(cmd, err instanceof Error ? err.message : String(err)))
  }

  let killed = false
  proc.onExit(() => {
    killed = true
  })

  return {
    onData(listener) {
      return proc.onData((d) => listener(typeof d === 'string' ? Buffer.from(d, 'utf8') : d))
    },
    onExit(listener) {
      return proc.onExit(listener)
    },
    write(data) {
      proc.write(data)
    },
    resize(cols, rows) {
      // ConPTY throws on a 0 dimension; clamp to a sane minimum.
      proc.resize(Math.max(1, cols), Math.max(1, rows))
    },
    kill() {
      if (killed) return
      try {
        proc.kill()
      } catch {
        // Process may have already exited between the killed check and kill().
      }
    },
    killTree() {
      // node-pty's own pid: the ConPTY cmd shim on win32 (taskkill /T walks down
      // to the dev server behind it), the process-group leader on POSIX.
      return killProcessTree(proc.pid)
    },
    get pid() {
      return proc.pid
    },
    get killed() {
      return killed
    },
  }
}
