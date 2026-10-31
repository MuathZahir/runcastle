import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Feature, Project } from '@runcastle/core'
import { Hono } from 'hono'
import { simpleGit } from 'simple-git'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { clearRuntimeCtx, setRuntimeCtx } from '../src/launcher/runtime'
import { threadLifecycle } from '../src/threads/lifecycle'
import { createSessionRow, getSessionRow, markSessionEnded, markSessionLive } from '../src/launcher/sessions'
import type { StopReason } from '../src/threads/types'
import mcpApp, { toolsForAudience } from '../src/mcp/server'
import { usePipePty } from './helpers/pipe-pty'
import { devSpawnTarget, drivePaneId, startDevPane, stopDevPane } from '../src/pty/dev-pane'
import { endSession } from '../src/pty/end-session'
import { ptyRegistry } from '../src/pty/registry'
import {
  configureDesignServers,
  designPaneId,
  designServerStatus,
  heartbeatDesignServer,
  IDLE_MS,
  restartDesignServer,
  sessionEndStopsServer,
  startDesignServer,
  stopDesignServer,
  substituteDesignPort,
  sweepIdleDesignServers,
  withPort,
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

usePipePty()
const AVAILABLE = process.platform !== 'win32'

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
  feature = seedFeature(ctx, project.id, { slug: 'shop' })
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

/** A thread's process stopping, as the agent host reports it to the lifecycle. */
function processStopped(sessionId: string, reason: StopReason = 'crashed'): void {
  threadLifecycle(ctx).stopped?.(markSessionEnded(ctx, sessionId)!, reason, 'human')
}

async function waitFor(fn: () => boolean, ms = 5000): Promise<void> {
  const end = Date.now() + ms
  while (!fn()) {
    if (Date.now() > end) throw new Error('waitFor timed out')
    await new Promise((r) => setTimeout(r, 20))
  }
}

describe('design port helpers', () => {
  it('substitutes every spelling of the port variable', () => {
    expect(substituteDesignPort('vite --port $RUNCASTLE_DESIGN_PORT --strictPort', 31000)).toBe(
      'vite --port 31000 --strictPort',
    )
    expect(substituteDesignPort('vite --port ${RUNCASTLE_DESIGN_PORT}', 31000)).toBe('vite --port 31000')
    expect(substituteDesignPort('vite --port %RUNCASTLE_DESIGN_PORT%', 31000)).toBe('vite --port 31000')
    expect(substituteDesignPort('vite --port 5173', 31000)).toBe('vite --port 5173')
  })

  it('gives a port-less sniffed URL the server’s own port', () => {
    expect(withPort('http://localhost', 33113)).toBe('http://localhost:33113/')
    expect(withPort('http://localhost:5173/app', 33113)).toBe('http://localhost:5173/app')
  })
})

describe('which session ends stop the design server', () => {
  const chat = { id: 'ses_chat', kind: 'chat' as const, headless: false, featureId: 'feat_1' }
  const run = { id: 'ses_run', kind: 'chat' as const, headless: false, purpose: 'self-plan' as const, featureId: 'feat_1' }
  const legacy = { ...run, headless: true, purpose: undefined }

  it('the human’s feature chat always stops it', () => {
    expect(sessionEndStopsServer(chat, undefined)).toBe(true)
    expect(sessionEndStopsServer(chat, 'ses_run')).toBe(true)
  })

  it('an unattended run stops only the server it started and still owns — a self-plan, or a headless row from before threads', () => {
    for (const unattended of [run, legacy]) {
      expect(sessionEndStopsServer(unattended, 'ses_run')).toBe(true)
      expect(sessionEndStopsServer(unattended, undefined)).toBe(false)
      expect(sessionEndStopsServer(unattended, 'ses_other')).toBe(false)
    }
  })

  it('a session of another kind never does', () => {
    expect(sessionEndStopsServer({ ...chat, kind: 'project' as const }, undefined)).toBe(false)
  })
})

describe.skipIf(!AVAILABLE)('design server', () => {
  it('substitutes the port in the command it runs, and records the command as given', async () => {
    const given =
      `node -e "console.log('Local: http://localhost:'+$RUNCASTLE_DESIGN_PORT+'/'); setInterval(()=>{},1000)"`
    const info = await startDesignServer(ctx, feature.id, given)
    expect(info.url).toBe(`http://localhost:${info.port}/`)
    expect(info.command).toBe(given)
    expect(JSON.parse(readFileSync(join(worktree, '.runcastle', 'design.json'), 'utf8'))).toEqual({
      command: given,
    })
  }, 15000)

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

  it('stops when the feature’s chat process exits on its own', async () => {
    const session = createSessionRow(ctx, { featureId: feature.id, kind: 'chat', worktreePath: worktree })
    markSessionLive(ctx, session.id)
    await startDesignServer(ctx, feature.id, FAKE_DEV)

    processStopped(session.id)

    await waitFor(() => stoppedReasons().length > 0)
    expect(stoppedReasons()).toEqual(['session-ended'])
  }, 15000)

  // The human never sees an idle stop, so it must not take their design view away.
  it('keeps running when the feature’s chat process is stopped for idling', async () => {
    const session = createSessionRow(ctx, { featureId: feature.id, kind: 'chat', worktreePath: worktree })
    markSessionLive(ctx, session.id)
    await startDesignServer(ctx, feature.id, FAKE_DEV)

    processStopped(session.id, 'idle')

    expect(designServerStatus(ctx, feature.id).running).toBe(true)
    expect(stoppedReasons()).toEqual([])
  }, 15000)

  it('keeps running when an unattended run of the feature that did not start it ends', async () => {
    const run = createSessionRow(ctx, { featureId: feature.id, kind: 'chat', worktreePath: worktree, purpose: 'self-plan' })
    await startDesignServer(ctx, feature.id, FAKE_DEV)

    processStopped(run.id)

    expect(designServerStatus(ctx, feature.id).running).toBe(true)
    expect(stoppedReasons()).toEqual([])
  }, 15000)

  it('stops when the unattended run that started it ends', async () => {
    const run = createSessionRow(ctx, { featureId: feature.id, kind: 'chat', worktreePath: worktree, purpose: 'self-plan' })
    await startDesignServer(ctx, feature.id, FAKE_DEV, { sessionId: run.id })

    processStopped(run.id)

    await waitFor(() => stoppedReasons().length > 0)
    expect(stoppedReasons()).toEqual(['session-ended'])
    expect(ptyRegistry().has(designPaneId(feature.id))).toBe(false)
  }, 15000)

  it('keeps running past the unattended run that started it once the human has opened it', async () => {
    const viaHeartbeat = createSessionRow(ctx, { featureId: feature.id, kind: 'chat', worktreePath: worktree, purpose: 'self-plan' })
    await startDesignServer(ctx, feature.id, FAKE_DEV, { sessionId: viaHeartbeat.id })
    heartbeatDesignServer(feature.id)
    processStopped(viaHeartbeat.id)
    expect(designServerStatus(ctx, feature.id).running).toBe(true)

    await stopDesignServer(ctx, feature.id, 'stopped')
    const viaWebStart = createSessionRow(ctx, { featureId: feature.id, kind: 'chat', worktreePath: worktree, purpose: 'self-plan' })
    await startDesignServer(ctx, feature.id, FAKE_DEV, { sessionId: viaWebStart.id })
    await startDesignServer(ctx, feature.id)
    processStopped(viaWebStart.id)

    expect(designServerStatus(ctx, feature.id).running).toBe(true)
    expect(stoppedReasons()).toEqual(['stopped'])
  }, 20000)

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

  it('a server that dies leaves its last output lines on status, until the next start', async () => {
    const dying =
      `node -e "console.log('Local: http://localhost:'+process.env.RUNCASTLE_DESIGN_PORT+'/'); ` +
      `setTimeout(()=>{console.log('Module not found: talkinghead'); process.exit(1)},300)"`
    await startDesignServer(ctx, feature.id, dying)

    await waitFor(() => stoppedReasons().length > 0)
    expect(stoppedReasons()).toEqual(['failed'])
    const status = designServerStatus(ctx, feature.id)
    expect(status.running).toBe(false)
    expect(status.lastError).toContain('Module not found: talkinghead')

    await startDesignServer(ctx, feature.id, FAKE_DEV)
    expect(designServerStatus(ctx, feature.id).lastError).toBeUndefined()
  }, 15000)

  it('restart stops the running server and starts it again from the recorded command', async () => {
    const first = await startDesignServer(ctx, feature.id, FAKE_DEV)

    const again = await restartDesignServer(ctx, feature.id)

    expect(again).toEqual(first)
    expect(stoppedReasons()).toEqual(['restarted'])
    expect(types().filter((t) => t === 'design.server_started')).toHaveLength(2)
    expect(designServerStatus(ctx, feature.id)).toMatchObject({ running: true, url: first.url })
  }, 15000)

  it('restart starts a server that is down, from the recorded command', async () => {
    mkdirSync(join(worktree, '.runcastle'), { recursive: true })
    writeFileSync(join(worktree, '.runcastle', 'design.json'), JSON.stringify({ command: FAKE_DEV }))

    const info = await createCallerFactory(appRouter)(ctx).design.restart({ featureId: feature.id })

    expect(info.command).toBe(FAKE_DEV)
    expect(stoppedReasons()).toEqual([])
    expect(designServerStatus(ctx, feature.id).running).toBe(true)
  }, 15000)
})

describe('design restart with nothing recorded', () => {
  it('refuses with a clear message', async () => {
    await expect(createCallerFactory(appRouter)(ctx).design.restart({ featureId: feature.id })).rejects.toThrow(
      /no design command recorded[\s\S]*ask the chat to start the design server/,
    )
    expect(stoppedReasons()).toEqual([])
  })
})

describe('design MCP tools', () => {
  let app: Hono
  let sessionId: string

  beforeEach(() => {
    sessionId = createSessionRow(ctx, { featureId: feature.id, kind: 'chat', worktreePath: worktree }).id
    markSessionLive(ctx, sessionId)
    setRuntimeCtx(ctx)
    app = new Hono()
    app.route('/mcp', mcpApp)
  })

  afterEach(() => {
    clearRuntimeCtx()
  })

  /** The tool's answer, unwrapped from the JSON-RPC envelope, with its error flag. */
  async function call(name: string, args: Record<string, unknown>): Promise<{ isError: boolean; text: string }> {
    const res = await app.request('/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'X-Runcastle-Session': sessionId,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    })
    expect(res.status).toBe(200)
    const envelope = (await res.json()) as { result: { isError?: boolean; content: [{ text: string }] } }
    return { isError: !!envelope.result.isError, text: envelope.result.content[0].text }
  }

  const panelShows = (): unknown[] =>
    listAfter(ctx, feature.id, 0)
      .filter((e) => e.type === 'panel.show')
      .map((e) => e.data)

  it('offers both tools to the feature chat only', () => {
    for (const tool of ['start_design_server', 'show_panel']) {
      expect(toolsForAudience('chat')).toContain(tool)
      for (const other of ['drive-fix', 'project', 'prepare', 'scenario', 'run'] as const) {
        expect(toolsForAudience(other), `${tool} for ${other}`).not.toContain(tool)
      }
    }
  })

  it('show_panel emits panel.show with the view and path', async () => {
    const out = await call('show_panel', { view: 'work' })
    expect(out.isError).toBe(false)
    expect(JSON.parse(out.text)).toEqual({ ok: true })
    expect(panelShows()).toEqual([{ view: 'work' }])
  })

  it('show_panel refuses an unknown view', async () => {
    const out = await call('show_panel', { view: 'storybook' })
    expect(out.isError).toBe(true)
    expect(panelShows()).toEqual([])
  })

  it('show_panel refuses design with no server and no recorded command, and opens it once one is recorded', async () => {
    const refused = await call('show_panel', { view: 'design', path: '/preview/cart.html' })
    expect(refused.isError).toBe(true)
    expect(refused.text).toMatch(/start_design_server/)
    expect(panelShows()).toEqual([])

    mkdirSync(join(worktree, '.runcastle'), { recursive: true })
    writeFileSync(join(worktree, '.runcastle', 'design.json'), JSON.stringify({ command: FAKE_DEV }))
    const opened = await call('show_panel', { view: 'design', path: '/preview/cart.html' })
    expect(opened.isError).toBe(false)
    expect(panelShows()).toEqual([{ view: 'design', path: '/preview/cart.html' }])
  })

  it('show_panel carries the screen width the design view opens at, and refuses a width no screen has', async () => {
    mkdirSync(join(worktree, '.runcastle'), { recursive: true })
    writeFileSync(join(worktree, '.runcastle', 'design.json'), JSON.stringify({ command: FAKE_DEV }))
    const opened = await call('show_panel', { view: 'design', path: '/preview/cart.html', width: 390 })
    expect(opened.isError).toBe(false)
    expect(panelShows()).toEqual([{ view: 'design', path: '/preview/cart.html', width: 390 }])

    const refused = await call('show_panel', { view: 'design', width: -1 })
    expect(refused.isError).toBe(true)
    expect(panelShows()).toHaveLength(1)
  })

  it('show_panel remembers the design path it opened, for design.status to hand back', async () => {
    mkdirSync(join(worktree, '.runcastle'), { recursive: true })
    writeFileSync(join(worktree, '.runcastle', 'design.json'), JSON.stringify({ command: FAKE_DEV }))
    expect(designServerStatus(ctx, feature.id).lastPath).toBeUndefined()

    await call('show_panel', { view: 'design', path: '/preview/cart.html' })
    await call('show_panel', { view: 'body' })

    expect(designServerStatus(ctx, feature.id)).toEqual({
      running: false,
      hasRecordedCommand: true,
      lastPath: '/preview/cart.html',
    })
  })

  it.skipIf(!AVAILABLE)('start_design_server returns the running server’s URL and port', async () => {
    const out = await call('start_design_server', { command: FAKE_DEV })
    expect(out.isError).toBe(false)
    const info = JSON.parse(out.text) as { url: string; port: number }
    expect(info.url).toBe(`http://localhost:${info.port}/`)
    expect(designServerStatus(ctx, feature.id)).toMatchObject({ running: true, url: info.url })
  }, 15000)

  it('start_design_server refuses with a clear message when nothing is recorded', async () => {
    const out = await call('start_design_server', {})
    expect(out.isError).toBe(true)
    expect(out.text).toMatch(/no design command/)
  })
})

describe('the design path the web opens', () => {
  it('is remembered per feature and returned by design.status', async () => {
    const design = createCallerFactory(appRouter)(ctx).design
    const other = seedFeature(ctx, project.id, { slug: 'other' })

    expect(await design.showPath({ featureId: feature.id, path: '/preview/invites.html' })).toEqual({ ok: true })

    expect((await design.status({ featureId: feature.id })).lastPath).toBe('/preview/invites.html')
    expect((await design.status({ featureId: other.id })).lastPath).toBeUndefined()
    await design.showPath({ featureId: feature.id, path: '/preview/empty.html' })
    expect((await design.status({ featureId: feature.id })).lastPath).toBe('/preview/empty.html')
  })
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
      paneId: designPaneId(feature.id),
      hasRecordedCommand: true,
    })

    expect(await design.heartbeat({ featureId: feature.id })).toEqual({ running: true })
    expect(await design.stop({ featureId: feature.id })).toEqual({ stopped: true })
    expect(stoppedReasons()).toEqual(['stopped'])
    expect((await design.status({ featureId: feature.id })).running).toBe(false)
    expect(await design.heartbeat({ featureId: feature.id })).toEqual({ running: false })
  }, 15000)
})
