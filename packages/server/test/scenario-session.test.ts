import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Feature, Project, SessionRow } from '@runcastle/core'
import { eq } from 'drizzle-orm'
import { simpleGit } from 'simple-git'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { projects } from '../src/db/schema'
import type { AppCtx } from '../src/db/types'
import { GateError, InvalidInputError } from '../src/errors'
import { type ScenarioBrief, renderScenarioPrompt } from '../src/launcher/artifacts'
import { evaluateCheckoutGuard } from '../src/launcher/checkout-guard'
import { evaluateEditGuard } from '../src/launcher/edit-guard'
import {
  createSessionRow,
  getSessionRow,
} from '../src/launcher/sessions'
import { toolRunScenario, toolSetScenarioRunner } from '../src/mcp/server'
import { listByProject } from '../src/services/events'
import { recordFinding } from '../src/services/findings'
import {
  __resetTestDriveState,
  __setAppReadinessTiming,
  activeDriveInfo,
  attachScenarioSession,
  createFeatureBranch,
  recordDriveUrl,
  testDrive,
} from '../src/services/git'
import { usePipePty } from './helpers/pipe-pty'
import { getProjectById } from '../src/services/repo'
import { resolveBun } from './helpers/bun'
import { useDataDir } from './helpers/data-dir'
import { makeTestCtx } from './helpers/db'
import { rmTemp, seedDriveWorker, seedFeature, seedProject } from './helpers/fixtures'

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

usePipePty()

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

  /** The Scenarios worker of this feature, docked beside the drive as its button docks it. */
  function launch(): { sessionId: string } {
    const { id } = seedDriveWorker(ctx, { feature }, 'scenario', repo)
    attachScenarioSession(project.id, id)
    return { sessionId: id }
  }

  function session(id: string): SessionRow {
    return getSessionRow(ctx, id) as SessionRow
  }

  describe('MCP tools', () => {
    it('run_scenario lands the drive for its own session, and refuses others', async () => {
      const url = await driveUp()
      const { sessionId } = launch()
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
      const scn = seedDriveWorker(ctx, { project }, 'scenario', repo)
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
      'first ask the human what state they want to land in',
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
    // The checkout guard holds this line now that every kind runs without prompts.
    const add = (command: string, purpose?: 'scenario-setup') =>
      evaluateCheckoutGuard({ kind: 'scenario', purpose, toolName: 'Bash', command, worktreePath: join(tmpdir(), 'checkout') })
    expect(add('git add app/routes/drive-login.ts', 'scenario-setup')).toBeNull()
    expect(add('git add .runcastle/scenarios/a.ts')).toBeNull()
    expect(add('git add app/routes/drive-login.ts')).not.toBeNull()
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
