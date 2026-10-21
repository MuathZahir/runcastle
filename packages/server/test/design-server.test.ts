import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Feature, Project } from '@runcastle/core'
import { simpleGit } from 'simple-git'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { createSessionRow, markSessionLive } from '../src/launcher/sessions'
import { createNativePtySession } from '../src/pty/pty'
import { devSpawnTarget, drivePaneId, startDevPane, stopDevPane } from '../src/pty/dev-pane'
import { endSession } from '../src/pty/end-session'
import { ptyRegistry } from '../src/pty/registry'
import {
  configureDesignServers,
  designPaneId,
  designServerStatus,
  heartbeatDesignServer,
  IDLE_MS,
  startDesignServer,
  stopDesignServer,
  sweepIdleDesignServers,
} from '../src/services/design'
import { listAfter } from '../src/services/events'
import { __resetTestDriveState, createFeatureBranch, ensureTalkWorktree } from '../src/services/git'
import { createCallerFactory } from '../src/trpc/context'
import { appRouter } from '../src/trpc/router'
import { useDataDir } from './helpers/data-dir'
import { makeTestCtx } from './helpers/db'
import { rmTemp, seedFeature, seedProject } from './helpers/fixtures'

/**
 * The design server (design-mode decisions 3 and 10), against a real PTY and a
 * real talk worktree: the agent's command runs on a port runcastle picks, the
 * sniffed URL comes back, the command is recorded, and every stop rule fires
 * with its reason on the timeline.
 */

/** Probe whether node-pty can spawn here (CI without prebuilds cannot). */
function ptyAvailable(): boolean {
  const { file, args } = devSpawnTarget(process.platform === 'win32' ? 'rem' : 'true')
  try {
    const p = createNativePtySession(file, args, { cwd: process.cwd(), env: process.env })
    p.kill()
    return true
  } catch {
    return false
  }
}
const AVAILABLE = process.platform !== 'win32' && ptyAvailable()

/** A fake dev server: prints its local URL on the injected port, then idles. */
const FAKE_DEV =
  `node -e "console.log('Local: http://localhost:'+process.env.RUNCASTLE_DESIGN_PORT+'/'); ` +
  `setInterval(()=>{},1000)"`

const tmpDirs: string[] = []
function mkTmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tmpDirs.push(dir)
  return dir
}

let ctx: AppCtx
let project: Project
let feature: Feature
let worktree: string
let restoreDataDir: () => void

beforeEach(async () => {
  restoreDataDir = useDataDir(mkTmp('rc-home-'))
  __resetTestDriveState()
  ctx = await makeTestCtx()
  const repo = mkTmp('rc-design-')
  const g = simpleGit(repo)
  await g.init(['-b', 'main'])
  await g.addConfig('user.email', 'test@runcastle.dev')
  await g.addConfig('user.name', 'Runcastle Test')
  writeFileSync(join(repo, 'README.md'), 'base\n')
  await g.add(['README.md'])
  await g.commit('initial commit')
  project = seedProject(ctx, repo)
  await createFeatureBranch(project, 'shop', 'main')
  feature = seedFeature(ctx, project.id, { slug: 'shop', phase: 'review' })
  worktree = await ensureTalkWorktree(project, feature)
})

afterEach(async () => {
  configureDesignServers({})
  for (const id of ptyRegistry().ids()) {
    if (id.startsWith('design:') || id.startsWith('drive:')) await stopDevPane(id)
  }
  await stopDesignServer(ctx, feature.id, 'stopped')
  restoreDataDir()
  __resetTestDriveState()
  while (tmpDirs.length) rmTemp(tmpDirs.pop()!)
})

const types = (): string[] => listAfter(ctx, feature.id, 0).map((e) => e.type)
const stoppedReasons = (): unknown[] =>
  listAfter(ctx, feature.id, 0)
    .filter((e) => e.type === 'design.server_stopped')
    .map((e) => (e.data as { reason: string }).reason)

async function waitFor(fn: () => boolean, ms = 5000): Promise<void> {
  const end = Date.now() + ms
  while (!fn()) {
    if (Date.now() > end) throw new Error('waitFor timed out')
    await new Promise((r) => setTimeout(r, 20))
  }
}

describe.skipIf(!AVAILABLE)('design server', () => {
  it('runs the command in the talk worktree on the injected port, returns the URL and records the command', async () => {
    const info = await startDesignServer(ctx, feature.id, FAKE_DEV)

    expect(info.port).toBeGreaterThanOrEqual(30000)
    expect(info.url).toBe(`http://localhost:${info.port}/`)
    expect(info.command).toBe(FAKE_DEV)
    expect(JSON.parse(readFileSync(join(worktree, '.runcastle', 'design.json'), 'utf8'))).toEqual({
      command: FAKE_DEV,
    })
    const started = listAfter(ctx, feature.id, 0).find((e) => e.type === 'design.server_started')
    expect(started?.data).toEqual({ url: info.url, port: info.port, command: FAKE_DEV })
    expect(ptyRegistry().has(designPaneId(feature.id))).toBe(true)
  }, 15000)

  it('runs in the talk worktree', async () => {
    const info = await startDesignServer(
      ctx,
      feature.id,
      `node -e "console.log(process.cwd()); console.log('http://localhost:'+process.env.RUNCASTLE_DESIGN_PORT)" ; sleep 30`,
    )
    expect(info.url).toBe(`http://localhost:${info.port}`)
    const output = ptyRegistry().get(designPaneId(feature.id))!.buffer.snapshot().toString('utf8')
    expect(output).toContain(worktree)
  }, 15000)

  it('reuses the running server for a second start, and starts from design.json without a command', async () => {
    const first = await startDesignServer(ctx, feature.id, FAKE_DEV)
    const again = await startDesignServer(ctx, feature.id)
    expect(again).toEqual(first)
    expect(types().filter((t) => t === 'design.server_started')).toHaveLength(1)

    await stopDesignServer(ctx, feature.id, 'stopped')
    const restarted = await startDesignServer(ctx, feature.id)
    expect(restarted.command).toBe(FAKE_DEV)
    expect(types().filter((t) => t === 'design.server_started')).toHaveLength(2)
  }, 15000)

  it('refuses a start with no command and nothing recorded', async () => {
    await expect(startDesignServer(ctx, feature.id)).rejects.toThrow(/no design command/)
    expect(existsSync(join(worktree, '.runcastle', 'design.json'))).toBe(false)
  })

  it('restarts when given a different command', async () => {
    await startDesignServer(ctx, feature.id, FAKE_DEV)
    const other = `${FAKE_DEV} # other`
    const next = await startDesignServer(ctx, feature.id, other)
    expect(next.command).toBe(other)
    expect(stoppedReasons()).toEqual(['stopped'])
  }, 15000)

  it('coexists with a drive dev pane of the same feature under a distinct pane id', async () => {
    const drivePane = startDevPane({
      ctx,
      scope: { featureId: feature.id },
      repoPath: worktree,
      devCommand: 'sleep 30',
      onUrl: () => {},
    })
    await startDesignServer(ctx, feature.id, FAKE_DEV)

    expect(drivePane).toBe(drivePaneId(feature.id))
    expect(designPaneId(feature.id)).not.toBe(drivePane)
    expect(ptyRegistry().has(drivePane!)).toBe(true)
    expect(ptyRegistry().has(designPaneId(feature.id))).toBe(true)
  }, 15000)

  it('stops when the feature’s chat session ends', async () => {
    const session = createSessionRow(ctx, { featureId: feature.id, kind: 'chat', worktreePath: worktree })
    markSessionLive(ctx, session.id)
    await startDesignServer(ctx, feature.id, FAKE_DEV)

    endSession(ctx, session.id)

    await waitFor(() => stoppedReasons().length > 0)
    expect(stoppedReasons()).toEqual(['session-ended'])
    expect(ptyRegistry().has(designPaneId(feature.id))).toBe(false)
  }, 15000)

  it('stops when the feature ships', async () => {
    await startDesignServer(ctx, feature.id, FAKE_DEV)

    const res = await createCallerFactory(appRouter)(ctx).feature.merge({ featureId: feature.id })

    expect(res.ok).toBe(true)
    expect(stoppedReasons()).toEqual(['shipped'])
  }, 20000)

  it('stops after 30 minutes without a heartbeat', async () => {
    let clock = 1_000_000
    configureDesignServers({ now: () => clock })
    await startDesignServer(ctx, feature.id, FAKE_DEV)

    clock += IDLE_MS - 60_000
    expect(heartbeatDesignServer(feature.id)).toBe(true)
    clock += IDLE_MS - 60_000
    await sweepIdleDesignServers()
    expect(stoppedReasons()).toEqual([])

    clock += IDLE_MS
    await sweepIdleDesignServers()
    expect(stoppedReasons()).toEqual(['idle'])
    expect(heartbeatDesignServer(feature.id)).toBe(false)
  }, 15000)

  it('stops a server that never prints a URL and rejects with its output tail', async () => {
    configureDesignServers({ urlTimeoutMs: 800 })

    await expect(startDesignServer(ctx, feature.id, 'echo "compiling the world"; sleep 30')).rejects.toThrow(
      /no localhost URL[\s\S]*compiling the world/,
    )
    await waitFor(() => stoppedReasons().length > 0)
    expect(stoppedReasons()).toEqual(['failed'])
    expect(designServerStatus(ctx, feature.id).running).toBe(false)
  }, 15000)
})

describe.skipIf(!AVAILABLE)('design tRPC procedures', () => {
  it('status, start from the recorded command, heartbeat and stop', async () => {
    const design = createCallerFactory(appRouter)(ctx).design

    expect(await design.status({ featureId: feature.id })).toEqual({ running: false, hasRecordedCommand: false })
    await expect(design.start({ featureId: feature.id })).rejects.toThrow(/no design command/)

    mkdirSync(join(worktree, '.runcastle'), { recursive: true })
    writeFileSync(join(worktree, '.runcastle', 'design.json'), JSON.stringify({ command: FAKE_DEV }))
    const started = await design.start({ featureId: feature.id })
    expect(started.url).toBe(`http://localhost:${started.port}/`)
    expect(await design.status({ featureId: feature.id })).toEqual({
      running: true,
      url: started.url,
      port: started.port,
      hasRecordedCommand: true,
    })

    expect(await design.heartbeat({ featureId: feature.id })).toEqual({ running: true })
    expect(await design.stop({ featureId: feature.id })).toEqual({ stopped: true })
    expect(stoppedReasons()).toEqual(['stopped'])
    expect((await design.status({ featureId: feature.id })).running).toBe(false)
    expect(await design.heartbeat({ featureId: feature.id })).toEqual({ running: false })
  }, 15000)
})
