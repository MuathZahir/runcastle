import { createPtySession, type CreatePtyOptions, type PtySession } from './pty'
import { RingBuffer } from './ring-buffer'

/**
 * The live-PTY registry (UI-SPEC §5). One entry per runcastle session id, each
 * owning a `PtySession` + its 512 KiB scrollback `RingBuffer` + the set of
 * currently-attached transports (WebSocket sinks). The registry is the single
 * source of truth every surface talks to: the launcher creates entries, the WS
 * endpoint attaches/detaches, and `endSession` / shutdown kill them.
 *
 * The instance is pinned on `globalThis` under a symbol so a `bun --hot` reload
 * — which re-evaluates modules and would otherwise orphan running PTYs behind a
 * fresh module-level Map — reuses the same registry across reloads.
 */

/** A control frame pushed to attached transports (resize is client→server). */
export type ControlFrame =
  | { t: 'status'; status: 'live' | 'ended'; exitCode?: number }
  | { t: 'resize'; cols: number; rows: number }

/** A transport attached to a PTY (implemented by the WS layer). */
export interface TerminalSink {
  sendData(chunk: Buffer): void
  sendControl(frame: ControlFrame): void
}

export interface CreateEntryInput {
  sessionId: string
  cmd: string
  args: string[]
  opts: CreatePtyOptions
  /** Fired once when the PTY process exits (launcher emits `session.pty_exited`). */
  onExit?: (info: { exitCode: number; signal?: number }) => void
}

export interface PtyEntry {
  readonly sessionId: string
  readonly pty: PtySession
  readonly buffer: RingBuffer
  readonly sinks: Set<TerminalSink>
  exited: boolean
  exitCode: number | null
}

/** How long a tree-kill may take before teardown gives up and proceeds anyway. */
const KILL_TREE_TIMEOUT_MS = 5000

/**
 * Tree-kill a PTY's process tree, bounded. The backend owns the pid (see
 * `kill-tree.ts`); all we own is the deadline — a `taskkill` that hangs must not
 * wedge the drive-stop mutation or the shutdown that is waiting on us, so on
 * timeout the caller proceeds regardless. Never rejects: teardown is best-effort.
 */
function killTreeBounded(pty: PtySession): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, KILL_TREE_TIMEOUT_MS)
    void pty
      .killTree()
      .catch(() => {})
      .then(() => {
        clearTimeout(timer)
        resolve()
      })
  })
}

class PtyRegistry {
  private entries = new Map<string, PtyEntry>()

  /** Spawn + register a PTY for a session. Throws if the id is already live. */
  create(input: CreateEntryInput): PtyEntry {
    const existing = this.entries.get(input.sessionId)
    if (existing && !existing.exited) {
      throw new Error(`pty already live for session ${input.sessionId}`)
    }
    if (existing) this.entries.delete(input.sessionId)

    const pty = createPtySession(input.cmd, input.args, input.opts)
    const entry: PtyEntry = {
      sessionId: input.sessionId,
      pty,
      buffer: new RingBuffer(),
      sinks: new Set(),
      exited: false,
      exitCode: null,
    }
    this.entries.set(input.sessionId, entry)

    pty.onData((chunk) => {
      entry.buffer.push(chunk)
      for (const sink of entry.sinks) sink.sendData(chunk)
    })

    pty.onExit(({ exitCode, signal }) => {
      entry.exited = true
      entry.exitCode = exitCode
      for (const sink of entry.sinks) sink.sendControl({ t: 'status', status: 'ended', exitCode })
      input.onExit?.({ exitCode, signal })
    })

    return entry
  }

  get(sessionId: string): PtyEntry | undefined {
    return this.entries.get(sessionId)
  }

  has(sessionId: string): boolean {
    return this.entries.has(sessionId)
  }

  /**
   * Attach a transport: replay the scrollback, announce current status, then let
   * live `sendData` broadcasts flow. Returns false if there is no such session.
   */
  attach(sessionId: string, sink: TerminalSink): boolean {
    const entry = this.entries.get(sessionId)
    if (!entry) return false
    const replay = entry.buffer.snapshot()
    if (replay.length > 0) sink.sendData(replay)
    sink.sendControl(
      entry.exited
        ? { t: 'status', status: 'ended', exitCode: entry.exitCode ?? 0 }
        : { t: 'status', status: 'live' },
    )
    entry.sinks.add(sink)
    return true
  }

  /** Detach a transport. Detach is NOT kill — the PTY keeps running. */
  detach(sessionId: string, sink: TerminalSink): void {
    this.entries.get(sessionId)?.sinks.delete(sink)
  }

  /**
   * Kill the PTY and everything it spawned, without waiting (onExit fires →
   * status broadcast + launcher hook). Returns whether a PTY was there to kill.
   *
   * The teardown is async and continues in the background, because every caller
   * of this form is a synchronous service (`endSession`, and the archive, delete
   * and waypoint-sweep paths behind it) with nothing downstream that waits on a
   * freed port. Callers that DO wait — drive stop, server shutdown — use
   * `killTree` / `killAllTrees`.
   */
  kill(sessionId: string): boolean {
    const entry = this.entries.get(sessionId)
    if (!entry) return false
    void this.tearDown(entry)
    return true
  }

  /** Kill the PTY's whole process tree and wait for it. */
  async killTree(sessionId: string): Promise<boolean> {
    const entry = this.entries.get(sessionId)
    if (!entry) return false
    await this.tearDown(entry)
    return true
  }

  /** Forget an entry (after its process has exited / on endSession cleanup). */
  remove(sessionId: string): void {
    this.entries.delete(sessionId)
  }

  /**
   * Kill every live PTY's process tree and wait for them (server shutdown).
   * `allSettled`, so one hung tree cannot leave the others un-torn-down.
   */
  async killAllTrees(): Promise<void> {
    const all = [...this.entries.values()]
    this.entries.clear()
    await Promise.allSettled(all.map((entry) => this.tearDown(entry)))
  }

  /**
   * Tree-kill an entry, then kill the PTY itself as a backstop. The order is the
   * whole point on Windows: killing the direct child first breaks the parent →
   * child link `taskkill /T` walks, orphaning the dev server / claude grandchild
   * that holds the port. An already-exited entry is skipped rather than killed
   * again — the OS may have reused its pid, and taskkilling a stranger's tree is
   * worse than leaking nothing.
   *
   * Never rejects, so no form of kill can fail a caller (or, for the sync form,
   * become an unhandled rejection): teardown is best-effort by construction.
   */
  private async tearDown(entry: PtyEntry): Promise<void> {
    if (entry.exited) return
    await killTreeBounded(entry.pty)
    try {
      entry.pty.kill()
    } catch {
      // Backend already reaped it between the tree kill and here.
    }
  }

  /** Live session ids (diagnostics/tests). */
  ids(): string[] {
    return [...this.entries.keys()]
  }
}

const REGISTRY_KEY = Symbol.for('runcastle.pty.registry')

type GlobalWithRegistry = typeof globalThis & { [REGISTRY_KEY]?: PtyRegistry }

/** The process-wide PTY registry (survives `bun --hot` module reloads). */
export function ptyRegistry(): PtyRegistry {
  const g = globalThis as GlobalWithRegistry
  if (!g[REGISTRY_KEY]) g[REGISTRY_KEY] = new PtyRegistry()
  return g[REGISTRY_KEY]
}

export type { PtyRegistry }
