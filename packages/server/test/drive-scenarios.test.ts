import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Feature, PreparedKey, Project } from '@runcastle/core'
import { eq } from 'drizzle-orm'
import { simpleGit } from 'simple-git'
import type { SimpleGit } from 'simple-git'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { projects } from '../src/db/schema'
import type { AppCtx } from '../src/db/types'
import { createNativePtySession } from '../src/pty/pty'
import { listAfter, listByProject } from '../src/services/events'
import { recordFinding } from '../src/services/findings'
import {
  __resetTestDriveState,
  __setAppReadinessTiming,
  activeDriveInfo,
  attachScenarioSession,
  createFeatureBranch,
  projectDrive,
  recordDriveUrl,
  reviewDrive,
  runScenarioOnDrive,
  testDrive,
} from '../src/services/git'
import { getProjectById } from '../src/services/repo'
import { createCallerFactory } from '../src/trpc/context'
import { appRouter } from '../src/trpc/router'
import { resolveBun } from './helpers/bun'
import { useDataDir } from './helpers/data-dir'
import { makeTestCtx } from './helpers/db'
import { rmTemp, seedFeature, seedProject } from './helpers/fixtures'

/**
 * Drive scenarios on the live drive (drive-scenarios spec, "Drive state and
 * events"): a scenario chosen at start runs once the app answers, lands the
 * drive or fails while the drive stays up, and can be rerun against the live
 * drive without a restart. Real git, real hooks, a real `bun {file}` runner and
 * a loopback server standing in for the app.
 */

const WIN = process.platform === 'win32'
const BUN = resolveBun()
const RUNNER = BUN ? `"${BUN}" {file}` : undefined

const tmpDirs: string[] = []
const servers: Server[] = []

function mkTmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tmpDirs.push(dir)
  return dir
}

async function freePort(): Promise<number> {
  const probe = createServer()
  await new Promise<void>((r) => probe.listen(0, '127.0.0.1', () => r()))
  const port = (probe.address() as AddressInfo).port
  await new Promise<void>((r) => probe.close(() => r()))
  return port
}

/** A loopback "app" that answers every request, so readiness turns true. */
async function serveApp(): Promise<string> {
  const port = await freePort()
  const server = createServer((_req, res) => res.end('app'))
  servers.push(server)
  await new Promise<void>((r) => server.listen(port, '127.0.0.1', () => r()))
  return `http://127.0.0.1:${port}/`
}

async function waitFor(fn: () => boolean, tries = 1000): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (fn()) return
    await new Promise((r) => setTimeout(r, 10))
  }
  throw new Error('waitFor timed out')
}

function put(repo: string, rel: string, body: string): void {
  const abs = join(repo, ...rel.split('/'))
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, body)
}

async function initRepo(dir: string): Promise<SimpleGit> {
  const g = simpleGit(dir)
  await g.init(['-b', 'main'])
  await g.addConfig('user.email', 'test@runcastle.dev')
  await g.addConfig('user.name', 'Runcastle Test')
  await g.addConfig('core.autocrlf', 'false')
  // The drive's own scratch file, ignored as a real project ignores it.
  put(dir, '.gitignore', '.runcastle/drive.env\n')
  // Prints what a scenario sees, landing relative to the drive's URL.
  put(
    dir,
    '.runcastle/scenarios/checkout/land.ts',
    [
      'const e = process.env',
      "console.log('seeding buyer_' + e.RUNCASTLE_SCENARIO_RUN)",
      'console.log(`ENTRY_URL=/cart?slug=${e.RUNCASTLE_SLUG}&db=${e.DB_NAME}`)',
    ].join('\n'),
  )
  put(dir, '.runcastle/scenarios/broken.ts', "console.log('no such table: buyers'); process.exit(2)")
  put(dir, '.runcastle/scenarios/slow.ts', "await Bun.sleep(1500); console.log('ENTRY_URL=/slow')")
  await g.add('.')
  await g.commit('initial commit')
  return g
}

/** A setup hook that writes `DB_NAME` from the drive identity into `drive.env`. */
function setupCommand(): string {
  const envFile = join('.runcastle', 'drive.env')
  return WIN
    ? `echo DB_NAME=app_%RUNCASTLE_ID%> "${envFile}"`
    : `echo "DB_NAME=app_$RUNCASTLE_ID" > "${envFile}"`
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

describe.skipIf(!RUNNER)('drive scenarios', () => {
  let ctx: AppCtx
  let project: Project
  let feature: Feature
  let g: SimpleGit
  let restoreDataDir: () => void

  beforeEach(async () => {
    __resetTestDriveState()
    __setAppReadinessTiming({ intervalMs: 10, budgetMs: 10_000 })
    restoreDataDir = useDataDir(mkTmp('rc-scn-home-'))
    ctx = await makeTestCtx()
    const repo = mkTmp('rc-scn-')
    g = await initRepo(repo)
    project = seedProject(ctx, repo)
    feature = seedFeature(ctx, project.id, { slug: 'drive' })
    await createFeatureBranch(project, feature.slug, 'main')
    await configure('driveSetupCommand', setupCommand())
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

  async function configure(key: PreparedKey, value: string): Promise<void> {
    recordFinding(ctx, project.id, { key, value, source: 'human' })
    project = getProjectById(ctx, project.id) as Project
  }

  const types = (): string[] => listAfter(ctx, feature.id, 0).map((e) => e.type)
  const scenario = () => activeDriveInfo(project.id)?.scenario

  /** Start the human's feature drive and bring its app up at a live URL. */
  async function driveUp(opts: { scenario?: string } = {}): Promise<string> {
    expect((await testDrive(ctx, project, feature, 'start', 'human', opts)).ok).toBe(true)
    const url = await serveApp()
    recordDriveUrl(ctx, project.id, feature.id, url)
    await waitFor(() => activeDriveInfo(project.id)?.devReady === true)
    return url
  }

  it('runs the scenario chosen at start once the app answers, and lands the drive on it', async () => {
    expect((await testDrive(ctx, project, feature, 'start', 'human', {
      scenario: '.runcastle/scenarios/checkout/land.ts',
    })).ok).toBe(true)
    // No URL yet: nothing to run against, so nothing ran.
    expect(scenario()).toBeUndefined()

    const url = await serveApp()
    recordDriveUrl(ctx, project.id, feature.id, url)
    await waitFor(() => scenario()?.status === 'landed')

    expect(scenario()).toMatchObject({
      file: '.runcastle/scenarios/checkout/land.ts',
      name: 'Land',
      status: 'landed',
      // Identity plus the drive.env overlay reached the scenario.
      entryUrl: `${url}cart?slug=drive&db=app_drive`,
      landingId: expect.any(String),
    })
    expect(types()).toEqual(expect.arrayContaining(['scenario.started', 'scenario.landed']))
    expect(types().indexOf('testdrive.ready')).toBeLessThan(types().indexOf('scenario.started'))
  }, 30_000)

  it('keeps the drive up on its plain URL when the scenario fails, with the reason and output', async () => {
    const url = await driveUp({ scenario: '.runcastle/scenarios/broken.ts' })
    await waitFor(() => scenario()?.status === 'failed')

    expect(scenario()).toMatchObject({
      name: 'Broken',
      status: 'failed',
      failure: { reason: 'exit', exitCode: 2, outputTail: expect.stringContaining('no such table') },
    })
    expect(activeDriveInfo(project.id)).toMatchObject({ devUrl: url, devReady: true, featureId: feature.id })
    const failed = listAfter(ctx, feature.id, 0).find((e) => e.type === 'scenario.failed')
    expect(failed?.message).toContain('exited 2')
    expect(failed?.data).toMatchObject({ file: '.runcastle/scenarios/broken.ts', reason: 'exit', exitCode: 2 })
  }, 30_000)

  it('switches scenarios on the live drive without a restart, refusing a concurrent run', async () => {
    await driveUp()
    const first = runScenarioOnDrive(ctx, project.id, '.runcastle/scenarios/slow.ts')
    expect(scenario()).toMatchObject({ status: 'running', name: 'Slow' })
    expect(await runScenarioOnDrive(ctx, project.id, '.runcastle/scenarios/checkout/land.ts')).toEqual({
      ok: false,
      denied: expect.stringContaining('already running'),
    })
    expect(await first).toMatchObject({ ok: true })

    const landed = await runScenarioOnDrive(ctx, project.id, '.runcastle/scenarios/checkout/land.ts')
    expect(landed).toMatchObject({ ok: true })
    const firstLanding = scenario()?.landingId
    await runScenarioOnDrive(ctx, project.id, '.runcastle/scenarios/checkout/land.ts')
    // Same URL, fresh landing: the panel reloads anyway.
    expect(scenario()?.landingId).not.toBe(firstLanding)
    expect(types().filter((t) => t === 'testdrive.started')).toHaveLength(1)
  }, 30_000)

  it('refuses a run with no live human drive, or before the app answers', async () => {
    const file = '.runcastle/scenarios/checkout/land.ts'
    expect(await runScenarioOnDrive(ctx, project.id, file)).toMatchObject({ ok: false, denied: expect.any(String) })

    await testDrive(ctx, project, feature, 'start')
    expect(await runScenarioOnDrive(ctx, project.id, file)).toMatchObject({
      ok: false,
      denied: expect.stringContaining('not answering'),
    })
    // Only a path under the scenarios dir ever reaches the runner's shell line.
    for (const bad of ['package.json', '.runcastle/scenarios/../x.ts', '.runcastle/scenarios/a".ts']) {
      expect(await runScenarioOnDrive(ctx, project.id, bad)).toMatchObject({
        ok: false,
        denied: expect.stringContaining('is not a scenario'),
      })
    }
    await testDrive(ctx, project, feature, 'stop')

    // A review agent's drive is not the human's to land on.
    await reviewDrive(ctx, project, { ...feature, phase: 'review' }, 'start')
    expect(await runScenarioOnDrive(ctx, project.id, file)).toMatchObject({ ok: false })
  }, 30_000)

  it('carries the docked scenario session on the drive info until the drive stops', async () => {
    await testDrive(ctx, project, feature, 'start')
    attachScenarioSession(project.id, 'sess_1')
    expect(activeDriveInfo(project.id)?.scenarioSessionId).toBe('sess_1')
    attachScenarioSession(project.id, undefined)
    expect(activeDriveInfo(project.id)?.scenarioSessionId).toBeUndefined()
    attachScenarioSession(project.id, 'sess_2')
    await testDrive(ctx, project, feature, 'stop')
    await testDrive(ctx, project, feature, 'start')
    expect(activeDriveInfo(project.id)?.scenarioSessionId).toBeUndefined()
  })

  it.runIf(PTY)('lands a project drive at project scope', async () => {
    const port = await freePort()
    const server = createServer((_req, res) => res.end('app'))
    servers.push(server)
    await new Promise<void>((r) => server.listen(port, '127.0.0.1', () => r()))
    await configure('devCommand', `echo http://127.0.0.1:${port}/; sleep 30`)

    expect((await projectDrive(ctx, project, 'start', {
      scenario: '.runcastle/scenarios/checkout/land.ts',
    })).ok).toBe(true)
    await waitFor(() => scenario()?.status === 'landed')
    expect(scenario()?.entryUrl).toBe(
      `http://127.0.0.1:${port}/cart?slug=project-drive&db=app_project_drive`,
    )
    expect(listByProject(ctx, project.id, 0).map((e) => e.type)).toEqual(
      expect.arrayContaining(['scenario.started', 'scenario.landed']),
    )
    await projectDrive(ctx, project, 'stop')
  }, 30_000)

  describe('over tRPC', () => {
    const caller = () => createCallerFactory(appRouter)(ctx)

    it('lists the drive scenarios, own first, and says whether a runner is set', async () => {
      await g.checkout('feature/drive')
      put(project.repoPath, '.runcastle/scenarios/review/own.ts', "console.log('ENTRY_URL=/')")
      await g.add('.')
      await g.commit('own scenario')
      await g.checkout('main')

      const featureList = await caller().feature.driveScenarios({ projectId: project.id, featureId: feature.id })
      expect(featureList.runnerConfigured).toBe(true)
      expect(featureList.scenarios.map((s) => [s.file, s.own])).toEqual([
        ['.runcastle/scenarios/review/own.ts', true],
        ['.runcastle/scenarios/broken.ts', false],
        ['.runcastle/scenarios/checkout/land.ts', false],
        ['.runcastle/scenarios/slow.ts', false],
      ])
      // A project drive reads HEAD, where the feature's scenario does not exist.
      const projectList = await caller().feature.driveScenarios({ projectId: project.id })
      expect(projectList.scenarios.map((s) => s.file)).not.toContain('.runcastle/scenarios/review/own.ts')
    })

    it('starts a drive with a scenario and runs another fire-and-forget', async () => {
      await caller().feature.testDrive({
        featureId: feature.id,
        action: 'start',
        scenario: '.runcastle/scenarios/checkout/land.ts',
      })
      recordDriveUrl(ctx, project.id, feature.id, await serveApp())
      await waitFor(() => scenario()?.status === 'landed')

      expect(await caller().feature.runScenario({ projectId: project.id, file: '.runcastle/scenarios/broken.ts' }))
        .toEqual({ ok: true })
      expect(scenario()?.status).toBe('running')
      await waitFor(() => scenario()?.status === 'failed')
    }, 30_000)

    it('answers runScenario with the refusal when there is no drive', async () => {
      expect(await caller().feature.runScenario({ projectId: project.id, file: 'x.ts' })).toEqual({
        ok: false,
        denied: expect.any(String),
      })
    })

    it('reaches the scenario session launcher, which refuses without a running drive', async () => {
      await expect(
        caller().feature.openScenarioChat({ projectId: project.id, description: 'a buyer with a cart' }),
      ).rejects.toThrow(/running test drive/)
    })
  })
})
