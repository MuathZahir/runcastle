import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { createSessionRow } from '../src/launcher/sessions'
import type { AcpLaunchSpec } from '../src/launcher/runtimes/types'
import { stopProcessTree } from '../src/pty/kill-tree'
import { createAgentHost, spawnAdapter, type AgentTransport } from '../src/threads/host'
import type { AgentHost } from '../src/threads/types'
import { makeTestCtx } from './helpers/db'
import { seedFeature, seedProject } from './helpers/fixtures'
import { processesWith, until } from './helpers/processes'
import { createFakeAcp, FAKE_LAUNCH } from './support/fake-acp-agent'

/**
 * Stopping a session kills its process (stopping-a-session-kills-its-process):
 * real process trees, stopped for real. POSIX only: on Windows the tree stop is
 * `taskkill /T`, and these trees are built from process groups.
 */

const FIXTURE = join(__dirname, 'fixtures', 'process-tree.cjs')
const posix = process.platform !== 'win32'

let n = 0
/** A tag no other test's (or other run's) processes carry. */
const freshTag = () => `rc-stop-${process.pid}-${Date.now().toString(36)}-${++n}`

/** Start the fixture's adapter stand-in the way the server starts one: leading its own group. */
function startTree(tag: string, flags: string[] = [], detached = true): number {
  const child = spawn(process.execPath, [FIXTURE, 'adapter', tag, ...flags], { stdio: 'ignore', detached })
  child.unref()
  return child.pid ?? -1
}

const leftover: string[] = []
afterEach(() => {
  // A failed test must not leave its tree behind for the next.
  for (const tag of leftover.splice(0)) for (const pid of processesWith(tag)) try { process.kill(pid, 'SIGKILL') } catch {}
})

describe.runIf(posix)('stopProcessTree', () => {
  it('ends a process and the child it started, when asked', async () => {
    const tag = freshTag()
    leftover.push(tag)
    const pid = startTree(tag)
    await until(() => processesWith(tag).length === 2, 'the tree to start')

    const result = await stopProcessTree(pid, { group: true })

    expect(result).toEqual({ gone: true, forced: false })
    expect(processesWith(tag)).toEqual([])
  })

  it('forces a child that ignores SIGTERM once the grace runs out', async () => {
    const tag = freshTag()
    leftover.push(tag)
    const pid = startTree(tag, ['--stubborn'])
    await until(() => processesWith(tag).length === 2, 'the tree to start')
    // Its command line shows before node has run the script that ignores SIGTERM.
    await new Promise((r) => setTimeout(r, 500))

    const started = Date.now()
    const result = await stopProcessTree(pid, { group: true, graceMs: 300 })

    expect(result).toEqual({ gone: true, forced: true })
    expect(Date.now() - started).toBeGreaterThanOrEqual(300)
    expect(processesWith(tag)).toEqual([])
  })

  it('still ends the process when it does not lead a group (the old bug)', async () => {
    const tag = freshTag()
    leftover.push(tag)
    const pid = startTree(tag, [], false)
    await until(() => processesWith(tag).length === 2, 'the tree to start')

    const result = await stopProcessTree(pid, { group: true })

    expect(result.gone).toBe(true)
    expect(processesWith(`${tag} `).filter((p) => p === pid)).toEqual([])
  })

  it('says a pid that is not there is gone, at once', async () => {
    const started = Date.now()
    expect(await stopProcessTree(0x7ffffffe, { group: true })).toEqual({ gone: true, forced: false })
    expect(Date.now() - started).toBeLessThan(1000)
  })
})

describe.runIf(posix)('an agent session’s stop', () => {
  let ctx: AppCtx
  let featureId: string
  let host: AgentHost
  let worktree: string

  beforeEach(async () => {
    ctx = await makeTestCtx()
    ctx.config.model = 'claude-opus-5-5'
    featureId = seedFeature(ctx, seedProject(ctx).id).id
    worktree = mkdtempSync(join(tmpdir(), 'rc-stop-wt-'))
  })
  afterEach(async () => {
    await host?.stopAll('shutdown')
    rmSync(worktree, { recursive: true, force: true })
  })

  /**
   * The real adapter spawn (`spawnAdapter`) running the fixture's tree, with the
   * ACP conversation itself played by the in-process fake agent.
   */
  function hostOnRealProcesses(tag: string, flags: string[] = []): void {
    const fake = createFakeAcp()
    const transport: AgentTransport = async (spec, row) => {
      const real = spawnAdapter({ ...spec, command: process.execPath, args: [FIXTURE, 'adapter', tag, ...flags], env: {}, envScrub: [] } as AcpLaunchSpec, row)
      const played = await fake.transport(spec, row)
      return { ...played, exited: real.exited, kill: real.kill }
    }
    host = createAgentHost({ ctx, transport, launch: FAKE_LAUNCH, idleMs: 60_000 })
  }

  function thread(): string {
    return createSessionRow(ctx, { featureId, kind: 'chat', worktreePath: worktree }).id
  }

  it('leaves neither the adapter nor its child running', async () => {
    const tag = freshTag()
    leftover.push(tag)
    hostOnRealProcesses(tag)
    const id = thread()
    await host.prompt(id, { text: 'Hello' }, { source: 'human' })
    await until(() => processesWith(tag).length === 2, 'the adapter and its child to start')

    await host.stop(id, 'idle')

    expect(processesWith(tag)).toEqual([])
  })

  it('ends what a crashed adapter left behind', async () => {
    const tag = freshTag()
    leftover.push(tag)
    hostOnRealProcesses(tag, ['--crash'])
    const id = thread()
    await host.prompt(id, { text: 'Hello' }, { source: 'human' })
    await until(() => processesWith(`--resume=${tag}`).length === 1, 'the child to start')

    // The adapter exits by itself; the host notices and stops what is left of its group.
    await until(() => processesWith(tag).length === 0, 'the orphaned child to be ended', 8000)
    expect(host.isRunning(id)).toBe(false)
  }, 15_000)

  it('resumed five times, only one process ever holds the conversation', async () => {
    const tag = freshTag()
    leftover.push(tag)
    // Slow to quit, so a restart that does not wait would overlap the old process.
    hostOnRealProcesses(tag, ['--slow'])
    const id = thread()
    const holders = () => processesWith(`--resume=${tag}`).length
    let most = 0
    const watch = setInterval(() => {
      most = Math.max(most, holders())
    }, 10)
    try {
      await host.prompt(id, { text: 'Hello' }, { source: 'human' })
      await until(() => holders() === 1, 'the first process')
      for (let i = 0; i < 5; i++) {
        // A message straight after a stop, as a model change or an edit fork does.
        const stopping = host.stop(id, 'idle')
        await host.prompt(id, { text: `Again ${i}` }, { source: 'human' })
        await stopping
        await until(() => holders() === 1 && host.isRunning(id), `resume ${i + 1}`)
      }
    } finally {
      clearInterval(watch)
    }

    expect(most).toBe(1)
    expect(holders()).toBe(1)
  }, 30_000)
})
