import { constants } from 'node:os'
import { explainSpawnFailure } from '../util/resolve-executable'
import { contain } from './job-object'
import { killProcessTree } from './kill-tree'
import { windowsArgsLine, windowsArgv0 } from './windows-command-line'

/**
 * The single PTY interface (UI-SPEC §5). Everything above this line — registry,
 * WebSocket transport, launcher — talks to `createPtySession`, so what hosts a
 * terminal stays swappable behind this one function.
 *
 * The backend is Bun's own terminal (`Bun.spawn` with `terminal`): openpty on
 * POSIX, ConPTY on Windows. It needs nothing installed beyond Bun itself, which
 * is why it replaced node-pty in a Node sidecar (ADR-0016).
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
   * Kill the whole process tree this session owns, best-effort. Distinct from
   * `kill()`, which ends only the PTY's own process and leaves grandchildren
   * running — on win32 that is the dev server behind the `cmd.exe` shim, still
   * holding its port. Never rejects.
   */
  killTree(): Promise<void>
  /** OS process id of the spawned program. */
  readonly pid: number
  /** True once the process has exited. */
  readonly killed: boolean
}

export interface CreatePtyOptions {
  cwd: string
  env: Record<string, string | undefined>
  cols?: number
  rows?: number
}

export type PtyFactory = (cmd: string, args: string[], opts: CreatePtyOptions) => PtySession

/**
 * How long after a program exits to wait for the end of its output. The exit can
 * arrive before the last bytes are read; a grandchild that kept the terminal open
 * would hold the stream past any wait, so this is a bound, not a promise.
 */
const OUTPUT_TAIL_MS = 250

/**
 * How long a program on Windows gets to act on Ctrl-C before its tree is ended.
 * Bun's ConPTY delivers `\x03` to a raw-mode program as a key, but never raises
 * the console interrupt a line-mode program (a dev server, `docker build`) listens
 * for, so without this Ctrl-C would do nothing there.
 */
const WINDOWS_INTERRUPT_GRACE_MS = 2000

const TERMINAL_NAME = 'xterm-256color'

/** Inherited settings that describe some other terminal, not the one being opened. */
const FOREIGN_TERMINAL_ENV = ['TMUX', 'TMUX_PANE', 'STY', 'WINDOW', 'WINDOWID', 'TERMCAP', 'COLUMNS', 'LINES']

/**
 * The part of Bun's API the backend uses, declared here because this module also
 * reaches `apps/web`'s typecheck through the router types, where Bun's globals do
 * not exist. (Bun's own types still call `terminal` POSIX-only; it runs on Windows
 * from the 1.3.14 floor on, measured and covered by `pty-bun.test.ts`.)
 */
interface BunTerminal {
  readonly closed: boolean
  write(data: string): number
  resize(cols: number, rows: number): void
  close(): void
}
interface BunSubprocess {
  readonly pid: number
  readonly exited: Promise<number>
  readonly signalCode: NodeJS.Signals | null
  readonly terminal: BunTerminal
  kill(signal?: string): void
}
interface BunSpawnOptions {
  cwd: string
  env: Record<string, string>
  terminal: {
    cols: number
    rows: number
    name: string
    data(terminal: BunTerminal, data: Uint8Array): void
    exit(): void
  }
  windowsHide?: boolean
  windowsVerbatimArguments?: boolean
  argv0?: string
}
interface BunRuntime {
  spawn(cmd: string[], opts: BunSpawnOptions): BunSubprocess
}

function bunRuntime(): BunRuntime | undefined {
  return (globalThis as unknown as { Bun?: BunRuntime }).Bun
}

let standIn: PtyFactory | null = null

/**
 * Tests only. vitest runs on node, which has no `Bun.spawn`, so a suite that just
 * needs a process to talk to installs a stand-in here; real terminal behaviour is
 * tested from a real Bun child (`test/fixtures/pty-bun.ts`).
 */
export function installPtyStandIn(factory: PtyFactory | null): void {
  standIn = factory
}

/** Spawn a process inside a pseudo-terminal and return the runcastle PTY handle. */
export function createPtySession(cmd: string, args: string[], opts: CreatePtyOptions): PtySession {
  if (standIn) return standIn(cmd, args, opts)
  const bun = bunRuntime()
  if (!bun) throw new Error('runcastle terminals need Bun: run the server with bun, not node')
  return createBunPtySession(bun, cmd, args, opts)
}

/** The environment a terminal starts with: strings only, and describing this terminal. */
function terminalEnv(env: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(env)) {
    if (typeof v === 'string') out[k] = v
  }
  if (process.platform === 'win32') return out
  for (const key of FOREIGN_TERMINAL_ENV) delete out[key]
  return { ...out, TERM: TERMINAL_NAME }
}

/** The exit signal as a number, as `PtySession.onExit` reports it. */
function signalNumber(signal: NodeJS.Signals | null): number | undefined {
  return signal ? constants.signals[signal] : undefined
}

/**
 * A terminal whose program could not start. The explanation goes into the
 * terminal stream as well as the log: that is what the person is watching, and
 * without it the pane just opens empty and dies.
 */
function failedPtySession(why: string): PtySession {
  process.stderr.write(`[pty] ${why}\n`)
  const dataListeners = new Set<(data: Buffer) => void>()
  const exitListeners = new Set<(event: { exitCode: number; signal?: number }) => void>()
  // A later tick, because the registry attaches its listeners after this returns.
  setTimeout(() => {
    const text = Buffer.from(`\r\n${why.replace(/\n/g, '\r\n')}\r\n`, 'utf8')
    for (const l of dataListeners) l(text)
    for (const l of exitListeners) l({ exitCode: 1 })
  }, 0)
  return {
    onData(listener) {
      dataListeners.add(listener)
      return { dispose: () => dataListeners.delete(listener) }
    },
    onExit(listener) {
      exitListeners.add(listener)
      return { dispose: () => exitListeners.delete(listener) }
    },
    write() {},
    resize() {},
    kill() {},
    killTree: () => Promise.resolve(),
    pid: -1,
    killed: true,
  }
}

/**
 * Bun's terminal. Output listeners receive a copy of the raw bytes, so the
 * consumer's UTF-8 decoder owns reassembly and the ring buffer can keep them.
 */
function createBunPtySession(bun: BunRuntime, cmd: string, args: string[], opts: CreatePtyOptions): PtySession {
  const isWin32 = process.platform === 'win32'
  const dataListeners = new Set<(data: Buffer) => void>()
  const exitListeners = new Set<(event: { exitCode: number; signal?: number }) => void>()
  let exited = false
  let interrupting: ReturnType<typeof setTimeout> | null = null
  let outputEnded = (): void => {}
  const outputDone = new Promise<void>((resolve) => {
    outputEnded = resolve
  })

  let proc: BunSubprocess
  try {
    proc = bun.spawn(isWin32 ? [cmd, windowsArgsLine(args)].filter(Boolean) : [cmd, ...args], {
      cwd: opts.cwd,
      env: terminalEnv(opts.env),
      terminal: {
        cols: opts.cols ?? 80,
        rows: opts.rows ?? 24,
        name: TERMINAL_NAME,
        data(_terminal, data) {
          const chunk = Buffer.from(data)
          for (const l of dataListeners) l(chunk)
        },
        exit() {
          outputEnded()
        },
      },
      ...(isWin32
        ? { windowsHide: true, windowsVerbatimArguments: true, argv0: windowsArgv0(cmd) }
        : {}),
    })
  } catch (err) {
    return failedPtySession(explainSpawnFailure(cmd, err instanceof Error ? err.message : String(err)))
  }

  const { terminal } = proc

  // On the spawn's own tick: every descendant the program starts from here on is
  // born inside the job, and dies with it even once its parent has exited. Null
  // off win32, or when setup failed; teardown then keeps the `taskkill /T` path.
  const containment = isWin32 ? contain(proc.pid) : null

  void proc.exited.then(async (exitCode) => {
    if (interrupting) clearTimeout(interrupting)
    await Promise.race([outputDone, new Promise((resolve) => setTimeout(resolve, OUTPUT_TAIL_MS))])
    exited = true
    terminal.close()
    // A program that ended on its own releases its job too: whatever it left
    // behind dies, and no handle leaks.
    void containment?.kill()
    const signal = signalNumber(proc.signalCode)
    for (const l of exitListeners) l({ exitCode, ...(signal === undefined ? {} : { signal }) })
  })

  async function killTree(): Promise<void> {
    if (containment) {
      await containment.kill()
      return
    }
    // The ConPTY child on win32 (taskkill /T walks down to the dev server behind
    // it), the process-group leader on POSIX.
    await killProcessTree(proc.pid)
  }

  return {
    onData(listener) {
      dataListeners.add(listener)
      return { dispose: () => dataListeners.delete(listener) }
    },
    onExit(listener) {
      exitListeners.add(listener)
      return { dispose: () => exitListeners.delete(listener) }
    },
    write(data) {
      if (exited || terminal.closed) return
      terminal.write(data)
      if (isWin32 && data.includes('\x03') && !interrupting) {
        interrupting = setTimeout(() => void killTree(), WINDOWS_INTERRUPT_GRACE_MS)
        interrupting.unref?.()
      }
    },
    resize(cols, rows) {
      if (exited || terminal.closed) return
      // ConPTY throws on a 0 dimension; clamp to a sane minimum.
      terminal.resize(Math.max(1, cols), Math.max(1, rows))
    },
    kill() {
      if (exited) return
      // Closing a terminal hangs up on its program; on win32 kill() takes no signal.
      proc.kill(isWin32 ? undefined : 'SIGHUP')
    },
    killTree,
    get pid() {
      return proc.pid
    },
    get killed() {
      return exited
    },
  }
}
