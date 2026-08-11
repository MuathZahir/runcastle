/**
 * The server's SIGINT/SIGTERM handler, split out of `src/index.ts` as a pure
 * function of its injected side effects — the boot block it is wired into cannot
 * be exercised by a test, and this is the only place the ordering is observable.
 */

/** How long shutdown waits for PTY trees to die before exiting anyway. */
export const SHUTDOWN_TIMEOUT_MS = 5000

export interface ShutdownDeps {
  /** Tear down every live PTY's process TREE (`ptyRegistry().killAllTrees`). */
  killAllTrees: () => Promise<void>
  /** Stop accepting connections (`Bun.serve`'s handle). */
  stop: () => void
  exit: (code: number) => void
}

/**
 * Build the signal handler. Tearing down PTY trees is ASYNC (it shells out to
 * `taskkill` on Windows), so the synchronous handler this replaced could never do
 * more than signal the direct children before `process.exit` — which is how a
 * burn's `claude` grandchild outlived the server that spawned it. So: start the
 * teardown, then exit when it settles or when `timeoutMs` runs out, whichever
 * comes first (a hung `taskkill` must not turn Ctrl-C into a no-op). A second
 * signal means the operator asked twice and is done waiting: exit at once,
 * non-zero, teardown unfinished.
 */
export function createShutdown(deps: ShutdownDeps, timeoutMs = SHUTDOWN_TIMEOUT_MS): () => void {
  let settling = false
  return () => {
    if (settling) {
      deps.exit(1)
      return
    }
    settling = true
    void (async () => {
      const deadline = new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, timeoutMs)
        timer.unref?.()
      })
      await Promise.race([deps.killAllTrees().catch(() => {}), deadline])
      deps.stop()
      deps.exit(0)
    })()
  }
}
