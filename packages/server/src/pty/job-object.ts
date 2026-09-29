import { createRequire } from 'node:module'

/** Type-only; `bun:ffi` itself is loaded lazily inside {@link loadKernel32}. */
type BunFfi = typeof import('bun:ffi')
type Pointer = import('bun:ffi').Pointer

/**
 * Windows Job Objects for the process trees the server spawns (decisions 2–6 of
 * `session-process-trees-die-with-their-session-on-windows`).
 *
 * `taskkill /T` walks the parent-pid chain, so once claude.exe exits its stdio
 * MCP servers lose their parent and nothing can reach them — they run on for
 * days, some holding the server's :4512 socket. Job membership follows every
 * descendant regardless of parentage, and a kill-on-close job dies when its last
 * handle closes. The server holds that handle, so ending a unit kills its whole
 * tree, and the server's own death (crash included) takes every job with it.
 *
 * One seam: `contain(pid)`. Off win32, or under node (vitest), it returns null
 * without ever loading `bun:ffi` and callers keep today's `killProcessTree` path.
 * A failed setup also returns null — a job is never a reason to refuse a spawn.
 */

/** A kernel32 HANDLE, carried as the pointer-sized number bun:ffi hands back. */
export type Handle = number

/** The raw kernel32 calls the bookkeeping needs, injectable so tests fake them. */
export interface Kernel32 {
  /** CreateJobObjectW(null, null): a fresh, unnamed, NON-inheritable job. */
  createJob(): Handle | null
  /** SetInformationJobObject(job, JobObjectExtendedLimitInformation, info, info.length). */
  setKillOnClose(job: Handle, limitInfo: Uint8Array): boolean
  /** OpenProcess(SET_QUOTA | TERMINATE | SYNCHRONIZE | QUERY_LIMITED_INFORMATION, false, pid). */
  openProcess(pid: number): Handle | null
  /** AssignProcessToJobObject(job, process). */
  assign(job: Handle, process: Handle): boolean
  /** TerminateJobObject(job, 1). */
  terminateJob(job: Handle): boolean
  closeHandle(handle: Handle): boolean
  /** WaitForSingleObject(process, 0) === WAIT_OBJECT_0 — never a blocking wait. */
  isProcessExited(process: Handle): boolean
}

export interface Containment {
  readonly pid: number
  /** Terminate + close the job, then resolve true once the root process is observed exited
   *  (false if timeoutMs passed first). Never rejects. Idempotent: 2nd call resolves the 1st's result. */
  kill(opts?: { timeoutMs?: number }): Promise<boolean>
}

/** sizeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION) on x64/arm64. */
const EXTENDED_LIMIT_INFO_SIZE = 144
/** Byte offset of BasicLimitInformation.LimitFlags (a u32). */
const LIMIT_FLAGS_OFFSET = 16
/**
 * The ONLY limit set. Deliberately not BREAKAWAY_OK (0x800) nor
 * SILENT_BREAKAWAY_OK (0x1000): nothing started inside a job may leave it
 * (decision 3).
 */
const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000

/** Default bound on waiting for the root to exit — inside the registry's 5s deadline. */
const KILL_TIMEOUT_MS = 3000
/** Exit poll interval. Polled, never waited on: a blocking wait freezes Bun's loop. */
const EXIT_POLL_MS = 50

function defaultLog(msg: string): void {
  console.error(msg)
}

/** The zeroed limit-info buffer with only kill-on-close set. */
function killOnCloseLimitInfo(): Uint8Array {
  const info = new Uint8Array(EXTENDED_LIMIT_INFO_SIZE)
  new DataView(info.buffer).setUint32(LIMIT_FLAGS_OFFSET, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE, true)
  return info
}

/** Close every handle, swallowing failures — cleanup must not throw. */
function closeAll(k32: Kernel32, handles: Handle[]): void {
  for (const h of handles) {
    try {
      k32.closeHandle(h)
    } catch {
      // Best-effort: a handle we cannot close is one the process exit reclaims.
    }
  }
}

/** Test seam: build contain() over an injected kernel32. */
export function createContainer(
  k32: Kernel32 | null,
  log: (m: string) => void = defaultLog,
): (pid: number) => Containment | null {
  return (pid) => {
    if (k32 === null) {
      log(`[pty-teardown] job: unavailable pid=${pid} (not Bun on win32, or kernel32 failed to load); falling back to taskkill`)
      return null
    }
    const opened: Handle[] = []
    let step = 'createJob'
    try {
      const job = k32.createJob()
      if (job === null) throw new Error('returned null')
      opened.push(job)

      step = 'setKillOnClose'
      if (!k32.setKillOnClose(job, killOnCloseLimitInfo())) throw new Error('returned false')

      step = 'openProcess'
      const proc = k32.openProcess(pid)
      if (proc === null) throw new Error('returned null')
      opened.push(proc)

      step = 'assign'
      if (!k32.assign(job, proc)) throw new Error('returned false')

      log(`[pty-teardown] job: contained pid=${pid}`)
      return makeContainment(k32, log, pid, job, proc)
    } catch (err) {
      closeAll(k32, opened.reverse())
      const why = err instanceof Error ? err.message : String(err)
      log(`[pty-teardown] job: contain failed pid=${pid} step=${step} (${why}); falling back to taskkill`)
      return null
    }
  }
}

function makeContainment(
  k32: Kernel32,
  log: (m: string) => void,
  pid: number,
  job: Handle,
  proc: Handle,
): Containment {
  let killing: Promise<boolean> | null = null

  function exited(): boolean {
    try {
      return k32.isProcessExited(proc)
    } catch {
      return false
    }
  }

  function run(timeoutMs: number): Promise<boolean> {
    const started = Date.now()
    try {
      k32.terminateJob(job)
    } catch {
      // Closing the last handle below kills the job anyway (kill-on-close).
    }
    closeAll(k32, [job])

    return new Promise((resolve) => {
      const finish = (ok: boolean): void => {
        closeAll(k32, [proc])
        log(`[pty-teardown] job: kill pid=${pid} exited=${ok ? 'yes' : 'no'} after ${Date.now() - started}ms`)
        resolve(ok)
      }
      const poll = (): void => {
        if (exited()) return finish(true)
        if (Date.now() - started >= timeoutMs) return finish(false)
        setTimeout(poll, EXIT_POLL_MS)
      }
      poll()
    })
  }

  return {
    pid,
    kill(opts) {
      killing ??= run(opts?.timeoutMs ?? KILL_TIMEOUT_MS)
      return killing
    },
  }
}

const PROCESS_TERMINATE = 0x0001
const PROCESS_SET_QUOTA = 0x0100
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
const SYNCHRONIZE = 0x0010_0000
const JOB_OBJECT_EXTENDED_LIMIT_INFORMATION_CLASS = 9
const WAIT_OBJECT_0 = 0

/**
 * The real kernel32, bound through `bun:ffi` — or null off win32, under node, or
 * when the load fails. Loaded synchronously (contain() must be sync) and lazily,
 * via `createRequire`, so Linux/macOS/vitest never so much as resolve `bun:ffi`.
 */
function loadKernel32(): Kernel32 | null {
  if (process.platform !== 'win32' || typeof Bun === 'undefined') return null
  try {
    const ffi = createRequire(import.meta.url)('bun:ffi') as BunFfi
    const { symbols: k } = ffi.dlopen('kernel32.dll', {
      CreateJobObjectW: { args: ['ptr', 'ptr'], returns: 'ptr' },
      SetInformationJobObject: { args: ['ptr', 'i32', 'ptr', 'u32'], returns: 'i32' },
      OpenProcess: { args: ['u32', 'i32', 'u32'], returns: 'ptr' },
      AssignProcessToJobObject: { args: ['ptr', 'ptr'], returns: 'i32' },
      TerminateJobObject: { args: ['ptr', 'u32'], returns: 'i32' },
      CloseHandle: { args: ['ptr'], returns: 'i32' },
      WaitForSingleObject: { args: ['ptr', 'u32'], returns: 'u32' },
    })
    const h = (handle: Handle): Pointer => handle as Pointer
    return {
      // Null security attributes: the job handle is NOT inheritable. An inherited
      // copy in a child would keep the job alive past the server.
      createJob: () => k.CreateJobObjectW(null, null),
      setKillOnClose: (job, info) =>
        k.SetInformationJobObject(h(job), JOB_OBJECT_EXTENDED_LIMIT_INFORMATION_CLASS, info, info.length) !== 0,
      openProcess: (pid) =>
        k.OpenProcess(
          PROCESS_SET_QUOTA | PROCESS_TERMINATE | SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION,
          0,
          pid,
        ),
      assign: (job, proc) => k.AssignProcessToJobObject(h(job), h(proc)) !== 0,
      terminateJob: (job) => k.TerminateJobObject(h(job), 1) !== 0,
      closeHandle: (handle) => k.CloseHandle(h(handle)) !== 0,
      isProcessExited: (proc) => k.WaitForSingleObject(h(proc), 0) === WAIT_OBJECT_0,
    }
  } catch (err) {
    defaultLog(`[pty-teardown] job: kernel32 load failed (${err instanceof Error ? err.message : String(err)})`)
    return null
  }
}

/** Built on first use and cached — including a failed load, which is not retried. */
let container: ((pid: number) => Containment | null) | undefined

/** Put `pid` in a fresh kill-on-close job. Returns null (and logs one warning line) when not
 *  win32, not running under Bun, the FFI load fails, or any kernel32 call fails. Never throws. */
export function contain(pid: number): Containment | null {
  container ??= createContainer(loadKernel32())
  return container(pid)
}
