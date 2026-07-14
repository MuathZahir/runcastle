import { createRequire } from 'node:module'

/**
 * The single PTY interface (UI-SPEC §5). Everything above this line — registry,
 * WebSocket transport, launcher — talks to `createPtySession` and never imports
 * `node-pty` directly, so the backend implementation (bun-native `node-pty`
 * here; a `node` sidecar if the native module ever fails under Bun) stays
 * swappable behind this one function.
 *
 * SHIPPED PATH: bun-native `node-pty` (v1.1.0). A runtime probe confirmed a real
 * ConPTY spawn + data roundtrip works under Bun 1.3 on Windows, so no sidecar is
 * needed. `node-pty` is a native CommonJS addon; it is loaded lazily via
 * `createRequire` on first spawn (not at import time) so that merely importing
 * the launcher/index — as the unit tests and `buildApp` do — never touches the
 * native binding. This mirrors the lazy `bun:sqlite` load in `launcher/runtime`.
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

/**
 * Spawn a process inside a pseudo-terminal and return the runcastle PTY handle.
 * Output listeners always receive a `Buffer` (node-pty is spawned WITHOUT an
 * encoding so bytes pass through untouched — the consumer's UTF-8 decoder owns
 * reassembly).
 */
export function createPtySession(
  cmd: string,
  args: string[],
  opts: CreatePtyOptions,
): PtySession {
  const pty = loadNodePty()
  const proc = pty.spawn(cmd, args, {
    name: 'xterm-256color',
    cols: opts.cols ?? 80,
    rows: opts.rows ?? 24,
    cwd: opts.cwd,
    env: cleanEnv(opts.env),
    useConpty: opts.useConpty ?? true,
  })

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
    get pid() {
      return proc.pid
    },
    get killed() {
      return killed
    },
  }
}
