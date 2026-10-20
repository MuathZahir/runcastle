import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Feature, Project, SessionRow } from '@runcastle/core'
import { sessionDir } from '@runcastle/core/paths'
import { eq } from 'drizzle-orm'
import { simpleGit } from 'simple-git'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { projects } from '../src/db/schema'
import type { AppCtx } from '../src/db/types'
import { GateError, InvalidInputError } from '../src/errors'
import { type ScenarioBrief, renderScenarioPrompt, renderSettings } from '../src/launcher/artifacts'
import { evaluateEditGuard } from '../src/launcher/edit-guard'
import { launchScenarioSession, launchSession } from '../src/launcher/launcher'
import { createSessionRow, getSessionRow, markSessionEnded } from '../src/launcher/sessions'
import { toolRunScenario, toolSetScenarioRunner } from '../src/mcp/server'
import { listAfter, listByProject } from '../src/services/events'
import { recordFinding } from '../src/services/findings'
import {
  __resetTestDriveState,
  __setAppReadinessTiming,
  activeDriveInfo,
  createFeatureBranch,
  projectDrive,
  recordDriveUrl,
  reviewDrive,
  runScenarioOnDrive,
  testDrive,
} from '../src/services/git'
import { createNativePtySession } from '../src/pty/pty'
import { type PtyEntry, ptyRegistry } from '../src/pty/registry'
import { getProjectById } from '../src/services/repo'
import { resolveBun } from './helpers/bun'
import { useDataDir } from './helpers/data-dir'
import { makeTestCtx } from './helpers/db'
import { rmTemp, seedFeature, seedProject } from './helpers/fixtures'

/**
 * The scenario session (drive-scenarios decision 8): ＋ New scenario / Fix it
 * docked beside a running drive. Tested at its seams — the launcher, the
 * rendered briefing, the edit guard and the two MCP tools — on a real repo and
 * a real drive whose "app" is a loopback server.
 */

const WIN = process.platform === 'win32'
const BUN = resolveBun()
const RUNNER = BUN ? `"${BUN}" {file}` : undefined
const LAND = '.runcastle/scenarios/checkout/land.ts'

const tmpDirs: string[] = []
const servers: Server[] = []

function mkTmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tmpDirs.push(dir)
  return dir
}

function put(repo: string, rel: string, body: string): void {
  const abs = join(repo, ...rel.split('/'))
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, body)
}

async function freePort(): Promise<number> {
  const probe = createServer()
  await new Promise<void>((r) => probe.listen(0, '127.0.0.1', () => r()))
  const port = (probe.address() as AddressInfo).port
  await new Promise<void>((r) => probe.close(() => r()))
  return port
}

async function serveApp(port?: number): Promise<string> {
  const p = port ?? (await freePort())
  const server = createServer((_req, res) => res.end('app'))
  servers.push(server)
  await new Promise<void>((r) => server.listen(p, '127.0.0.1', () => r()))
  return `http://127.0.0.1:${p}/`
}

async function waitFor(fn: () => boolean, tries = 1000): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (fn()) return
    await new Promise((r) => setTimeout(r, 10))
  }
  throw new Error('waitFor timed out')
}

function ptyAvailable(): boolean {
  try {
    const p = createNativePtySession('/bin/sh', ['-c', 'true'], { cwd: process.cwd(), env: process.env })
    p.kill()
    return true
  } catch {
    return false
  }
}
const PTY = !WIN && ptyAvailable()

function setupCommand(): string {
  const envFile = join('.runcastle', 'drive.env')
  return WIN
    ? `echo DB_NAME=app_%RUNCASTLE_ID%> "${envFile}"`
    : `echo "DB_NAME=app_$RUNCASTLE_ID" > "${envFile}"`
}

describe.skipIf(!RUNNER)('the scenario session', () => {
  let ctx: AppCtx
  let project: Project
  let feature: Feature
  let repo: string
  let restoreDataDir: () => void

  beforeEach(async () => {
    __resetTestDriveState()
    __setAppReadinessTiming({ intervalMs: 10, budgetMs: 10_000 })
    restoreDataDir = useDataDir(mkTmp('rc-scs-home-'))
    ctx = await makeTestCtx()
    repo = mkTmp('rc-scs-')
    const g = simpleGit(repo)
    await g.init(['-b', 'main'])
    await g.addConfig('user.email', 'test@runcastle.dev')
    await g.addConfig('user.name', 'Runcastle Test')
    await g.addConfig('core.autocrlf', 'false')
    put(repo, '.gitignore', '.runcastle/drive.env\n')
    put(repo, LAND, "console.log('ENTRY_URL=/cart?db=' + process.env.DB_NAME)")
    put(repo, '.runcastle/scenarios/_fixtures/buyer.ts', 'export const buyer = 1')
    put(repo, '.runcastle/scenarios/broken.ts', "console.log('no such table'); process.exit(2)")
    await g.add('.')
    await g.commit('initial commit')
    project = seedProject(ctx, repo)
    feature = seedFeature(ctx, project.id, { slug: 'scn', title: 'Checkout' })
    await createFeatureBranch(project, feature.slug, 'main')
    recordFinding(ctx, project.id, { key: 'driveSetupCommand', value: setupCommand(), source: 'human' })
    ctx.db.update(projects).set({ scenarioRunner: RUNNER }).where(eq(projects.id, project.id)).run()
    project = getProjectById(ctx, project.id) as Project
  })

  afterEach(async () => {
    __resetTestDriveState()
    __setAppReadinessTiming()
    restoreDataDir()
    while (servers.length) {
      const server = servers.pop()
      if (server) await new Promise<void>((r) => server.close(() => r()))
    }
    for (const dir of tmpDirs.splice(0)) {
      try {
        rmTemp(dir)
      } catch {
        // best-effort on Windows
      }
    }
  })

  async function driveUp(): Promise<string> {
    expect((await testDrive(ctx, project, feature, 'start')).ok).toBe(true)
    const url = await serveApp()
    recordDriveUrl(ctx, project.id, feature.id, url)
    await waitFor(() => activeDriveInfo(project.id)?.devReady === true)
    return url
  }

  function launch(input: { description?: string; fixFile?: string } = {}): Promise<{ sessionId: string }> {
    return launchScenarioSession(ctx, { projectId: project.id, ...input }, { spawn: false })
  }

  function session(id: string): SessionRow {
    return getSessionRow(ctx, id) as SessionRow
  }

  function prompt(id: string): string {
    return readFileSync(join(sessionDir(id), 'system-prompt.md'), 'utf8')
  }

  describe('launching', () => {
    it('refuses without a live human drive whose app answers', async () => {
      await expect(launch()).rejects.toThrow(GateError)
      await testDrive(ctx, project, feature, 'start')
      await expect(launch()).rejects.toThrow(/Open app/)
      await testDrive(ctx, project, feature, 'stop')
      await reviewDrive(ctx, project, { ...feature, phase: 'review' }, 'start')
      await expect(launch()).rejects.toThrow(GateError)
    }, 30_000)

    it('opens a feature-scoped session in the checkout, docked to the drive', async () => {
      await driveUp()
      const { sessionId } = await launch({ description: 'a buyer with a full cart' })
      expect(session(sessionId)).toMatchObject({
        kind: 'scenario',
        featureId: feature.id,
        worktreePath: project.repoPath,
      })
      // Scenarios exist on this branch, so this is not setup mode.
      expect(session(sessionId).purpose).toBeUndefined()
      expect(activeDriveInfo(project.id)?.scenarioSessionId).toBe(sessionId)
      expect(listAfter(ctx, feature.id, 0).map((e) => e.type)).toContain('scenario.chat_opened')

      const text = prompt(sessionId)
      expect(text).toContain('a buyer with a full cart')
      expect(text).toContain('`DB_NAME` = `app_scn`')
      expect(text).toContain('`.runcastle/scenarios/_fixtures/buyer.ts`')
      expect(text).not.toContain('Setup mode')
    }, 30_000)

    it('reopens the live scenario session of this drive instead of starting a second', async () => {
      await driveUp()
      const first = await launch()
      expect((await launch()).sessionId).toBe(first.sessionId)

      markSessionEnded(ctx, first.sessionId)
      expect((await launch()).sessionId).not.toBe(first.sessionId)
    }, 30_000)

    it('starts in setup mode, decided at launch, when the branch has no scenarios yet', async () => {
      await driveUp()
      rmSync(join(repo, '.runcastle', 'scenarios'), { recursive: true, force: true })
      const { sessionId } = await launch({ description: 'signed in as an admin' })
      expect(session(sessionId).purpose).toBe('scenario-setup')
      expect(prompt(sessionId)).toContain('Setup mode')
    }, 30_000)

    it('briefs Fix it with the failed file, its reason and its output tail', async () => {
      await driveUp()
      await runScenarioOnDrive(ctx, project.id, '.runcastle/scenarios/broken.ts')
      const { sessionId } = await launch({ fixFile: '.runcastle/scenarios/broken.ts' })
      const text = prompt(sessionId)
      expect(text).toContain('**Fix it** on `.runcastle/scenarios/broken.ts`')
      expect(text).toContain('exited 2')
      expect(text).toContain('no such table')
    }, 30_000)

    it('hands a live docked chat the failed file, its reason and its output tail on Fix it', async () => {
      await driveUp()
      const first = await launch()
      const typed: string[] = []
      const entry = {
        sessionId: first.sessionId,
        exited: false,
        pty: { write: (data: string) => typed.push(data) },
      } as unknown as PtyEntry
      const get = vi
        .spyOn(ptyRegistry(), 'get')
        .mockImplementation((id) => (id === first.sessionId ? entry : undefined))
      try {
        await runScenarioOnDrive(ctx, project.id, '.runcastle/scenarios/broken.ts')
        const fixed = await launch({ fixFile: '.runcastle/scenarios/broken.ts' })
        expect(fixed.sessionId).toBe(first.sessionId)
        const line = typed[0] ?? ''
        expect(line).toContain('**Fix it** on `.runcastle/scenarios/broken.ts`')
        expect(line).toContain('exited 2')
        expect(line).toContain('no such table')
        const kickoff = listAfter(ctx, feature.id, 0).filter((e) => e.type === 'session.kickoff').at(-1)
        expect(kickoff?.data).toMatchObject({ sessionId: first.sessionId, mechanism: 'pty', line })

        await launch({ description: 'a buyer with an expired coupon' })
        await waitFor(() => typed.some((t) => t.includes('a buyer with an expired coupon')))
      } finally {
        get.mockRestore()
      }
    }, 30_000)

    it('refuses to hand a live chat its ask when its terminal is gone', async () => {
      await driveUp()
      await launch()
      await expect(launch({ description: 'anything' })).rejects.toThrow(GateError)
    }, 30_000)

    it.runIf(PTY)('opens a project-scoped session on a project drive', async () => {
      const port = await freePort()
      await serveApp(port)
      recordFinding(ctx, project.id, {
        key: 'devCommand',
        value: `echo http://127.0.0.1:${port}/; sleep 30`,
        source: 'human',
      })
      project = getProjectById(ctx, project.id) as Project
      expect((await projectDrive(ctx, project, 'start')).ok).toBe(true)
      await waitFor(() => activeDriveInfo(project.id)?.devReady === true)

      const { sessionId } = await launch()
      expect(session(sessionId)).toMatchObject({ kind: 'scenario', projectId: project.id })
      expect(session(sessionId).featureId ?? null).toBeNull()
      expect(listByProject(ctx, project.id, 0).map((e) => e.type)).toContain('scenario.chat_opened')
      await projectDrive(ctx, project, 'stop')
    }, 30_000)

    it('is never opened as a plain talk session', async () => {
      await expect(launchSession(ctx, { featureId: feature.id, kind: 'scenario' })).rejects.toThrow(
        GateError,
      )
    })
  })

  describe('MCP tools', () => {
    it('run_scenario lands the drive for its own session, and refuses others', async () => {
      const url = await driveUp()
      const { sessionId } = await launch()
      expect(await toolRunScenario(ctx, session(sessionId), LAND)).toMatchObject({
        ok: true,
        entryUrl: `${url}cart?db=app_scn`,
      })
      expect(activeDriveInfo(project.id)?.scenario?.status).toBe('landed')

      const failed = await toolRunScenario(ctx, session(sessionId), '.runcastle/scenarios/broken.ts')
      expect(failed).toMatchObject({ ok: false, failure: { reason: 'exit', exitCode: 2 } })

      const chat = createSessionRow(ctx, { featureId: feature.id, kind: 'chat', worktreePath: repo })
      await expect(toolRunScenario(ctx, chat, LAND)).rejects.toThrow(GateError)

      // A scenario session whose drive is gone has nothing to land on.
      await testDrive(ctx, project, feature, 'stop')
      await expect(toolRunScenario(ctx, session(sessionId), LAND)).rejects.toThrow(/no longer running/)
    }, 30_000)

    it('set_scenario_runner records the runner through the settings service', () => {
      const scn = createSessionRow(ctx, { projectId: project.id, kind: 'scenario', worktreePath: repo })
      expect(() => toolSetScenarioRunner(ctx, scn, 'bun run')).toThrow(InvalidInputError)

      expect(toolSetScenarioRunner(ctx, scn, 'bun {file}')).toEqual({ scenarioRunner: 'bun {file}' })
      expect(getProjectById(ctx, project.id)?.scenarioRunner).toBe('bun {file}')
      const updated = listByProject(ctx, project.id, 0).find((e) => e.type === 'settings.updated')
      expect(updated?.data).toMatchObject({ key: 'scenarioRunner', value: 'bun {file}' })

      const chat = createSessionRow(ctx, { featureId: feature.id, kind: 'chat', worktreePath: repo })
      expect(() => toolSetScenarioRunner(ctx, chat, 'bun {file}')).toThrow(GateError)
    })
  })
})

describe('the scenario briefing', () => {
  const project = { name: 'shop', repoPath: '/repo' } as Project
  const brief = (over: Partial<ScenarioBrief> = {}): ScenarioBrief => ({
    project,
    branch: 'feature/checkout',
    identity: { RUNCASTLE_SLUG: 'checkout', RUNCASTLE_BRANCH: 'feature/checkout', RUNCASTLE_ID: 'checkout' },
    envOverlay: { DATABASE_URL: 'postgres://localhost/shop_checkout' },
    driveUrl: 'http://localhost:3000',
    runner: 'bun {file}',
    files: ['.runcastle/scenarios/checkout/cart.ts', '.runcastle/scenarios/_fixtures/buyer.ts'],
    description: 'a buyer with an expired coupon',
    setup: false,
    ...over,
  })

  it('carries the drive, the runner, the scenarios, the ask and the rules', () => {
    const text = renderScenarioPrompt(brief())
    for (const expected of [
      '`RUNCASTLE_SLUG` = `checkout`',
      '`RUNCASTLE_ID` = `checkout`',
      '`DATABASE_URL` = `postgres://localhost/shop_checkout`',
      '`http://localhost:3000`',
      '`bun {file}`',
      '`.runcastle/scenarios/checkout/cart.ts`',
      '`.runcastle/scenarios/_fixtures/buyer.ts`',
      'a buyer with an expired coupon',
      'RUNCASTLE_SCENARIO_RUN',
      'ENTRY_URL=',
      '/__drive/login',
      '**Commit before landing.**',
      '**Land only through `run_scenario({ file })`.**',
      'Only `.runcastle/`',
    ]) {
      expect(text).toContain(expected)
    }
    expect(text).not.toContain('Setup mode')
  })

  it('teaches TOKEN and the sibling .http call', () => {
    const text = renderScenarioPrompt(brief())
    for (const expected of [
      '`TOKEN=<value>` (the last such line wins)',
      'sibling `.http` file at the same path',
      'request line `METHOD path`',
      'One request per scenario.',
      '`{{token}}` is',
      '`{{run}}` with `RUNCASTLE_SCENARIO_RUN`',
      'a relative path',
      '**Try it**',
    ]) {
      expect(text).toContain(expected)
    }
    expect(renderScenarioPrompt(brief({ setup: true }))).toContain('mints one for the seeded user')
    expect(text).not.toContain('mints one for the seeded user')
  })

  it('renders the setup block exactly in setup mode', () => {
    const text = renderScenarioPrompt(brief({ setup: true, files: [], runner: undefined }))
    expect(text).toContain('Setup mode')
    expect(text).toContain('set_scenario_runner')
    expect(text).toContain('_fixtures/')
    expect(text).toContain('**not set**')
    expect(text).not.toContain('Only `.runcastle/`')
  })

  it('asks the human first when nothing was described, and briefs a fix with its failure', () => {
    expect(renderScenarioPrompt(brief({ description: undefined }))).toContain(
      'First ask the human what state they want to land in',
    )
    const fix = renderScenarioPrompt(
      brief({
        description: undefined,
        fix: {
          file: '.runcastle/scenarios/checkout/cart.ts',
          failure: { reason: 'no-entry-url', exitCode: 0, outputTail: 'seeded buyer_7f3a' },
        },
      }),
    )
    expect(fix).toContain('`.runcastle/scenarios/checkout/cart.ts`')
    expect(fix).toContain('printed no ENTRY_URL')
    expect(fix).toContain('seeded buyer_7f3a')
  })

  it('lets setup mode `git add` anywhere, and a normal session only .runcastle/', () => {
    expect(renderSettings('/h.ts', 'scenario', undefined, 'scenario-setup').permissions.allow).toContain(
      'Bash(git add:*)',
    )
    const normal = renderSettings('/h.ts', 'scenario').permissions.allow
    expect(normal).toContain('Bash(git add .runcastle:*)')
    expect(normal).not.toContain('Bash(git add:*)')
  })
})

describe('the scenario edit guard', () => {
  const worktreePath = join(tmpdir(), 'checkout')
  const edit = (filePath: string, purpose?: 'scenario-setup') =>
    evaluateEditGuard({ kind: 'scenario', purpose, worktreePath, toolName: 'Edit', filePath })

  it('opens the whole checkout in setup mode', () => {
    expect(edit('app/routes/drive-login.ts', 'scenario-setup')).toBeNull()
    expect(edit('tsconfig.json', 'scenario-setup')).toBeNull()
    expect(edit('.runcastle/scenarios/a.ts', 'scenario-setup')).toBeNull()
    expect(edit(join(tmpdir(), 'elsewhere', 'x.ts'), 'scenario-setup')).not.toBeNull()
  })

  it('allows only .runcastle/ otherwise', () => {
    expect(edit('.runcastle/scenarios/checkout/cart.ts')).toBeNull()
    expect(edit('.runcastle/scenarios/_fixtures/buyer.ts')).toBeNull()
    expect(edit('app/models/user.ts')?.reason).toContain('.runcastle/')
    expect(edit('.gitignore')).not.toBeNull()
  })
})
