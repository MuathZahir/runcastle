import { ptyRegistry } from '../../src/pty/registry'
import { awaitDead, openStubTerminal, pidAlive } from './job-object-terminal'

/**
 * Session end under Bun on win32: does a terminal's job reach the MCP server a
 * claude stand-in orphaned? Prints one `EVIDENCE {json}` line; exit 0 means yes.
 * Run BY `bun`, spawned from `job-object-win32.test.ts` (bun:ffi exists only there).
 *
 * Two shapes, because they end through two different paths:
 * - selfExit: the stub orphans its MCP child and exits, so the PTY and its host
 *   exit on their own — the sidecar releases the job from its `exit` handler.
 * - killTree: a "nest" parent keeps the terminal alive after the stub orphans its
 *   MCP child; `ptyRegistry().killTree()` must then reach an orphan that
 *   `taskkill /T` no longer can (its parent is gone).
 */

/** Grace for Windows to reap job members after the root is observed dead. */
const REAP_GRACE_MS = 3000
const WATCHDOG_MS = 45_000

async function main(): Promise<void> {
  const evidence: Record<string, unknown> = {
    platform: process.platform,
    isBun: typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined',
  }
  const leaks: number[] = []
  const report = (ok: boolean): never => {
    evidence.ok = ok
    // Never leave a failed run's processes behind.
    for (const pid of leaks) {
      try {
        process.kill(pid)
      } catch {
        // Already gone.
      }
    }
    process.stdout.write(`EVIDENCE ${JSON.stringify(evidence)}\n`)
    process.exit(ok ? 0 : 1)
  }
  const watchdog = setTimeout(() => {
    evidence.failure = `fixture exceeded ${WATCHDOG_MS}ms`
    report(false)
  }, WATCHDOG_MS)

  try {
    // --- the host exits on its own ---
    const self = await openStubTerminal('job-self-exit', 'exit')
    leaks.push(self.mcpPid)
    await self.exited
    const selfAlive = await awaitDead([self.mcpPid, self.hostPid], REAP_GRACE_MS)
    evidence.selfExit = { ...self, exited: undefined, aliveAfter: selfAlive }

    // --- the session is ended while the terminal is still live ---
    const live = await openStubTerminal('job-kill-tree', 'nest')
    const livePids = [live.mcpPid, live.hostPid, ...(live.nestPid === null ? [] : [live.nestPid])]
    leaks.push(...livePids)
    // Wait out the stub, so the MCP stand-in is a genuine orphan before teardown.
    const stubGone = (await awaitDead([live.stubPid], 5000)).length === 0
    const orphanedBeforeKill = stubGone && pidAlive(live.mcpPid)
    await ptyRegistry().killTree('job-kill-tree')
    const liveAlive = await awaitDead(livePids, REAP_GRACE_MS)
    evidence.killTree = { ...live, exited: undefined, orphanedBeforeKill, aliveAfter: liveAlive }

    clearTimeout(watchdog)
    report(selfAlive.length === 0 && orphanedBeforeKill && liveAlive.length === 0)
  } catch (err) {
    clearTimeout(watchdog)
    evidence.failure = err instanceof Error ? err.message : String(err)
    report(false)
  }
}

void main()
