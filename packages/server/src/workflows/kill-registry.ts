import { spawn } from 'node:child_process'
import { killProcessTree } from '../pty/kill-tree'

/**
 * The kill-handle registry — what a running headless agent is killable BY.
 *
 * Aborting a sandcastle run only interrupts an Effect fiber: the container it
 * started keeps running, and so do the shells its host provider spawned. So the
 * abort has to be followed by a real kill, and a real kill needs a handle. The
 * patched sandcastle hands both out (`containerName` in, `onChildSpawn` out);
 * this registry is where a lane's handle lives between "an agent launched" and
 * "the run settled", and {@link KillRegistry.killAndWait} is the one place that
 * turns a handle into a dead process and waits to see it die.
 *
 * A lane is keyed by an opaque string — the ticket id for a ticket lane, the run
 * id for a run-scoped agent. The registry does not care which; callers pick. It
 * does care which RUN owns a lane, because Cancel run kills every lane of one
 * ({@link KillRegistry.killAllForRun}) and no key spelling makes them findable.
 *
 * The instance is pinned on `globalThis` under a symbol so a `bun --hot` reload
 * — which re-evaluates modules and would otherwise strand live handles behind a
 * fresh module-level Map — reuses the same registry across reloads. Same reason
 * `ptyRegistry()` does it.
 */

/** What a lane is currently killable by: a container to remove, or a tree to reap. */
type KillTarget =
  | { readonly kind: 'container'; readonly containerName: string }
  | { readonly kind: 'host'; readonly pid: number }

/**
 * Which run a lane's agent belongs to. Cancelling a run has to kill every agent
 * it started, and a run's lane keys are not derivable from its id — a ticket
 * lane is keyed by ticket, a run-scoped one by run — so the owner is recorded
 * with the handle and {@link KillRegistry.killAllForRun} reads it back.
 */
export interface LaneOwner {
  readonly runId?: string
}

/** A registered lane: what to kill, plus who owns it. */
type KillHandle = KillTarget & LaneOwner

/** The outcome of a kill: whether the process was OBSERVED to be gone. */
export interface KillOutcome {
  /**
   * True when the target is known dead — the container no longer exists, the
   * tree-kill settled, or there was nothing registered to kill. False only when
   * the deadline fired first, which the caller is expected to say out loud
   * rather than report as a clean stop.
   */
  readonly confirmed: boolean
}

export interface KillAndWaitOptions {
  /** How long to wait for confirmed death before giving up. Default 10s. */
  readonly timeoutMs?: number
}

/** How long the whole kill — command plus confirmation — may take. */
const DEFAULT_TIMEOUT_MS = 10_000

/** Gap between `docker inspect` probes while waiting for the container to vanish. */
const DEATH_POLL_INTERVAL_MS = 100

/**
 * How long a single `docker` invocation may run before we stop waiting on it. A
 * backstop, not a budget — see {@link runDockerCommand}.
 */
const DOCKER_COMMAND_TIMEOUT_MS = 5000

/** Concise breadcrumb on stderr, in the shape `[pty-teardown]` lines take. */
function log(msg: string): void {
  console.error(`[kill-registry] ${msg}`)
}

/**
 * Run `docker <args>` and resolve with whether it exited 0, on `exit`/`close`/
 * `error` listeners WE attach plus a timer backstop. Never rejects.
 *
 * Deliberately not `promisify(execFile)`: under Bun on win32 that promise never
 * settled and hung the caller indefinitely, which is exactly the class of bug
 * `packages/server/src/pty/kill-tree.ts` was written to remove. A kill that
 * hangs is the failure this whole registry exists to fix, so it owns its own
 * settlement here too.
 */
function runDockerCommand(args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false
    const settle = (ok: boolean): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(ok)
    }
    const timer = setTimeout(() => settle(false), DOCKER_COMMAND_TIMEOUT_MS)
    // Never hold the process open on this backstop — a kill is best-effort.
    timer.unref?.()

    try {
      const child = spawn('docker', args, { windowsHide: true, stdio: 'ignore' })
      child.on('exit', (code) => settle(code === 0))
      child.on('close', (code) => settle(code === 0))
      // `docker` not on PATH at all — nothing to wait for.
      child.on('error', () => settle(false))
    } catch {
      settle(false)
    }
  })
}

/**
 * The two system calls the registry makes, injectable so its behaviour can be
 * driven without a container engine or a real process to kill.
 */
export interface KillRegistryDeps {
  /** Run `docker <args>`; resolves true when it exited 0. Never rejects. */
  readonly runDocker: (args: string[]) => Promise<boolean>
  /** Kill the process tree rooted at `pid`; resolves once it settles. Never rejects. */
  readonly killTree: (pid: number) => Promise<void>
}

const REAL_DEPS: KillRegistryDeps = { runDocker: runDockerCommand, killTree: killProcessTree }

/**
 * Resolve whether `body` reported death, or false if `ms` elapses first — in
 * which case the body keeps running, unobserved, and the caller proceeds anyway.
 * Never rejects. Same shape, and same reasoning, as the PTY registry's deadline:
 * a bound that covers one step is a bound the next step can escape.
 */
function withDeadline(body: Promise<boolean>, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), ms)
    void body
      .catch(() => false)
      .then((confirmed) => {
        clearTimeout(timer)
        resolve(confirmed)
      })
  })
}

/** Sleep, without holding the process open on the timer. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    timer.unref?.()
  })
}

class KillRegistry {
  private readonly handles = new Map<string, KillHandle>()

  constructor(private readonly deps: KillRegistryDeps = REAL_DEPS) {}

  /** The lane runs in a container of this name — `docker rm -f` is the kill. */
  registerContainer(laneKey: string, containerName: string, owner: LaneOwner = {}): void {
    this.handles.set(laneKey, { kind: 'container', containerName, ...owner })
  }

  /**
   * The lane's newest host child. Overwrites: the host provider spawns a fresh
   * child per exec, so only the latest pid names a process still alive.
   */
  registerHostPid(laneKey: string, pid: number, owner: LaneOwner = {}): void {
    this.handles.set(laneKey, { kind: 'host', pid, ...owner })
  }

  /** Forget the lane — its run settled and there is nothing left to kill. */
  release(laneKey: string): void {
    this.handles.delete(laneKey)
  }

  /**
   * Kill the lane's process and wait, bounded, for it to be gone.
   *
   * Never rejects: a lane with no handle resolves confirmed (nothing to kill),
   * and a target that outlives the deadline resolves UNconfirmed rather than
   * holding the caller — the caller's job is then to say so, not to pretend.
   *
   * A confirmed kill releases the handle; an unconfirmed one keeps it, so a
   * retry kills again instead of reading as a lane that was never registered.
   */
  async killAndWait(laneKey: string, opts?: KillAndWaitOptions): Promise<KillOutcome> {
    const handle = this.handles.get(laneKey)
    if (!handle) return { confirmed: true }

    const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const started = Date.now()
    const confirmed = await withDeadline(this.kill(handle, started + timeoutMs), timeoutMs)
    if (confirmed) this.handles.delete(laneKey)

    const target = handle.kind === 'container' ? handle.containerName : `pid=${handle.pid}`
    log(
      `killAndWait: lane=${laneKey} ${handle.kind}=${target} ${
        confirmed ? 'confirmed dead' : `NOT confirmed dead (${timeoutMs}ms deadline)`
      } after ${Date.now() - started}ms`,
    )
    return { confirmed }
  }

  /**
   * Kill every live lane a run owns — Cancel run, which stops the whole burn
   * rather than one ticket. Lanes die concurrently, each under its own deadline,
   * so a run of N lanes still resolves in one lane's worth of waiting, and the
   * result is confirmed only when EVERY lane was seen to die. A run with nothing
   * registered resolves confirmed: there is nothing left of it to kill.
   */
  async killAllForRun(runId: string, opts?: KillAndWaitOptions): Promise<KillOutcome> {
    const lanes = [...this.handles]
      .filter(([, handle]) => handle.runId === runId)
      .map(([laneKey]) => laneKey)
    const outcomes = await Promise.all(lanes.map((laneKey) => this.killAndWait(laneKey, opts)))
    return { confirmed: outcomes.every((outcome) => outcome.confirmed) }
  }

  /** Registered lanes (diagnostics/tests). */
  keys(): string[] {
    return [...this.handles.keys()]
  }

  /**
   * The kill itself, resolving true once death is observed. Stops probing at
   * `deadline` so a container that will not die leaves nothing looping behind
   * the caller; {@link killAndWait}'s own timer is the backstop for a step that
   * never settles at all.
   */
  private async kill(handle: KillHandle, deadline: number): Promise<boolean> {
    if (handle.kind === 'host') {
      // The tree-kill settling IS the death: `taskkill /T /F` has reaped the
      // whole tree by the time it exits, and a process group signal likewise.
      await this.deps.killTree(handle.pid)
      return true
    }

    // `rm -f`, not `stop`: an immediate SIGKILL and removal, no 10s grace period
    // spent asking an agent mid-burn to wind down politely.
    await this.deps.runDocker(['rm', '-f', handle.containerName])
    // The removal is asynchronous engine-side, and `rm -f` also reports failure
    // for a container that was already gone — so existence, not the exit code,
    // is what confirms death. `inspect` failing means there is no such container.
    do {
      if (!(await this.deps.runDocker(['inspect', handle.containerName]))) return true
      await delay(DEATH_POLL_INTERVAL_MS)
    } while (Date.now() < deadline)
    return false
  }
}

const REGISTRY_KEY = Symbol.for('runcastle.kill.registry')

type GlobalWithRegistry = typeof globalThis & { [REGISTRY_KEY]?: KillRegistry }

/** The process-wide kill-handle registry (survives `bun --hot` module reloads). */
export function killRegistry(): KillRegistry {
  const g = globalThis as GlobalWithRegistry
  if (!g[REGISTRY_KEY]) g[REGISTRY_KEY] = new KillRegistry()
  return g[REGISTRY_KEY]
}

/** Construct an isolated registry — used by tests to inject the two system calls. */
export function createKillRegistry(deps: KillRegistryDeps): KillRegistry {
  return new KillRegistry(deps)
}

export type { KillRegistry }
