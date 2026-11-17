import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Feature, PreparedKey, Project, SessionRow } from '@runcastle/core'
import { eq } from 'drizzle-orm'
import { simpleGit } from 'simple-git'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { projects } from '../src/db/schema'
import type { AppCtx } from '../src/db/types'
import { GateError } from '../src/errors'
import { createSessionRow } from '../src/launcher/sessions'
import { toolFeatureDrive, toolFeatureScenario, toolReviewDrive, toolReviewScenario } from '../src/mcp/server'
import { recordFinding } from '../src/services/findings'
import {
  __resetTestDriveState,
  __setAppReadinessTiming,
  activeDriveInfo,
  createFeatureBranch,
  leadDriveFor,
  recordDriveUrl,
  releaseLeadDrive,
  reviewDriveFor,
  testDrive,
} from '../src/services/git'
import { getProjectById } from '../src/services/repo'
import { resolveBun } from './helpers/bun'
import { useDataDir } from './helpers/data-dir'
import { makeTestCtx } from './helpers/db'
import { rmTemp, seedFeature, seedHostReview, seedProject } from './helpers/fixtures'
import { usePipePty } from './helpers/pipe-pty'

/**
 * The feature lead's drive (features-set-up-scenarios-themselves decision 5):
 * `feature_drive` starts a real drive of the lead's own feature, runs a
 * scenario on it through the project runner, and is the lead's alone — while
 * the review's own drive checks never mistake it for a review drive.
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

async function serveApp(): Promise<string> {
  const server = createServer((_req, res) => res.end('app'))
  servers.push(server)
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/`
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

async function initRepo(dir: string): Promise<void> {
  const g = simpleGit(dir)
  await g.init(['-b', 'main'])
  await g.addConfig('user.email', 'test@runcastle.dev')
  await g.addConfig('user.name', 'Runcastle Test')
  await g.addConfig('core.autocrlf', 'false')
  put(dir, '.gitignore', '.runcastle/drive.env\n')
  put(
    dir,
    '.runcastle/scenarios/base/onboarded.ts',
    "console.log('ENTRY_URL=/home?db=' + process.env.DB_NAME); console.log('TOKEN=tok_' + process.env.RUNCASTLE_SCENARIO_RUN)",
  )
  put(dir, '.runcastle/scenarios/broken.ts', "console.log('no such table: users'); process.exit(2)")
  await g.add('.')
  await g.commit('initial commit')
}

function setupCommand(): string {
  const envFile = join('.runcastle', 'drive.env')
  return WIN ? `echo DB_NAME=app_%RUNCASTLE_ID%> "${envFile}"` : `echo "DB_NAME=app_$RUNCASTLE_ID" > "${envFile}"`
}

usePipePty()

describe.skipIf(!RUNNER)('feature_drive, the lead’s drive', () => {
  let ctx: AppCtx
  let project: Project
  let feature: Feature
  let lead: SessionRow
  let restoreDataDir: () => void

  beforeEach(async () => {
    __resetTestDriveState()
    __setAppReadinessTiming({ intervalMs: 10, budgetMs: 10_000 })
    restoreDataDir = useDataDir(mkTmp('rc-lead-home-'))
    ctx = await makeTestCtx()
    const repo = mkTmp('rc-lead-')
    await initRepo(repo)
    project = seedProject(ctx, repo)
    feature = seedFeature(ctx, project.id, { slug: 'signup' })
    await createFeatureBranch(project, feature.slug, 'main')
    await configure('driveSetupCommand', setupCommand())
    ctx.db.update(projects).set({ scenarioRunner: RUNNER }).where(eq(projects.id, project.id)).run()
    project = getProjectById(ctx, project.id) as Project
    lead = createSessionRow(ctx, { featureId: feature.id, kind: 'chat', worktreePath: repo })
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

  /** The lead starts its drive and the app comes up at a live URL. */
  async function leadUp(): Promise<void> {
    const started = await toolFeatureDrive(ctx, lead, { action: 'start' })
    expect(started).toMatchObject({ ok: true, action: 'start' })
    recordDriveUrl(ctx, project.id, feature.id, await serveApp())
    await waitFor(() => activeDriveInfo(project.id)?.devReady === true)
  }

  it('starts a drive of its own feature named as the lead’s, lands a scenario or reports its failure, and stops', async () => {
    await leadUp()
    const info = activeDriveInfo(project.id)
    expect(info).toMatchObject({
      featureId: feature.id,
      branch: 'feature/signup',
      purpose: 'lead',
      workerLabel: 'Lead',
      holderLabel: "the feature lead's drive of feature/signup",
      state: 'review-agent-driving',
    })
    // The lead's holder is a chat session, not a worker: no worker chat to open.
    expect(info).not.toHaveProperty('workerId')
    expect(leadDriveFor(project.id, feature.id)).toBe(true)
    expect(await toolFeatureDrive(ctx, lead, { action: 'status' })).toMatchObject({ ok: true, action: 'status', drive: { purpose: 'lead' } })

    expect(await toolFeatureScenario(ctx, lead, {})).toMatchObject({ ok: false, deniedReason: expect.stringContaining('needs `file`') })
    expect(await toolFeatureScenario(ctx, lead, { file: '.runcastle/scenarios/base/onboarded.ts' })).toEqual({
      ok: true,
      action: 'scenario',
      entryUrl: expect.stringContaining('/home?db=app_signup'),
      token: expect.stringMatching(/^tok_/),
    })
    expect(await toolFeatureScenario(ctx, lead, { file: '.runcastle/scenarios/broken.ts' })).toEqual({
      ok: false,
      action: 'scenario',
      failure: { reason: 'exit', exitCode: 2, outputTail: expect.stringContaining('no such table') },
    })

    expect(await toolFeatureDrive(ctx, lead, { action: 'stop' })).toMatchObject({ ok: true, action: 'stop', drive: null })
    expect(activeDriveInfo(project.id)).toBeNull()
    expect(await toolFeatureScenario(ctx, lead, { file: '.runcastle/scenarios/base/onboarded.ts' })).toMatchObject({
      ok: false,
      retriable: false,
    })
  }, 30_000)

  it('is never a review drive to the review’s checks, nor the reverse', async () => {
    await leadUp()
    expect(reviewDriveFor(project.id, feature.id)).toBe(false)
    // The feature's Review worker finds no review drive of its own to use or stop.
    const review = seedHostReview(ctx, feature, project.repoPath)
    expect(await toolReviewScenario(ctx, { session: review }, { action: 'scenario', file: '.runcastle/scenarios/base/onboarded.ts' }))
      .toMatchObject({ ok: false, deniedReason: expect.stringContaining('No review drive') })
    expect(await toolReviewDrive(ctx, { session: review }, { action: 'stop' })).toMatchObject({ ok: false })
    expect(leadDriveFor(project.id, feature.id)).toBe(true)
    // The human's Stop still ends it.
    expect((await testDrive(ctx, project, feature, 'stop')).ok).toBe(true)

    // A review drive holding the slot is no lead drive: the lead can neither use nor stop it.
    expect((await toolReviewDrive(ctx, { session: review }, { action: 'start' })).ok).toBe(true)
    expect(leadDriveFor(project.id, feature.id)).toBe(false)
    expect(await toolFeatureDrive(ctx, lead, { action: 'stop' })).toMatchObject({ ok: false })
    expect(await toolFeatureScenario(ctx, lead, { file: '.runcastle/scenarios/base/onboarded.ts' })).toMatchObject({ ok: false })
    expect(reviewDriveFor(project.id, feature.id)).toBe(true)
  }, 30_000)

  it('refuses a held slot retriably', async () => {
    expect((await testDrive(ctx, project, feature, 'start', 'human')).ok).toBe(true)
    expect(await toolFeatureDrive(ctx, lead, { action: 'start' })).toMatchObject({
      ok: false,
      action: 'start',
      deniedCode: 'slot_held',
      retriable: true,
    })
    expect(activeDriveInfo(project.id)?.purpose).toBe('human')
  }, 30_000)

  it('admits only the feature’s own lead: workers, the Review worker, side sessions and orchestrators are refused', async () => {
    const worker = createSessionRow(ctx, { featureId: feature.id, kind: 'worker', worktreePath: project.repoPath })
    const review = seedHostReview(ctx, feature, project.repoPath)
    const side = createSessionRow(ctx, { featureId: feature.id, kind: 'side', worktreePath: project.repoPath })
    const orchestrator = createSessionRow(ctx, { projectId: project.id, kind: 'project', worktreePath: project.repoPath })
    for (const session of [worker, review, side, orchestrator]) {
      await expect(toolFeatureDrive(ctx, session, { action: 'start' }), session.kind).rejects.toThrow(GateError)
      await expect(toolFeatureScenario(ctx, session, { file: '.runcastle/scenarios/base/onboarded.ts' })).rejects.toThrow(GateError)
    }
    await expect(toolFeatureDrive(ctx, worker, { action: 'start' })).rejects.toThrow(/belongs to the feature's lead/)
    expect(activeDriveInfo(project.id)).toBeNull()
  })

  it('leaves another feature’s lead nothing to act on but its own feature', async () => {
    await leadUp()
    const other = seedFeature(ctx, project.id, { slug: 'billing' })
    await createFeatureBranch(project, other.slug, 'main')
    const otherLead = createSessionRow(ctx, { featureId: other.id, kind: 'chat', worktreePath: project.repoPath })
    expect(await toolFeatureDrive(ctx, otherLead, { action: 'status' })).toMatchObject({ ok: false, drive: null })
    expect(await toolFeatureDrive(ctx, otherLead, { action: 'stop' })).toMatchObject({ ok: false })
    expect(await toolFeatureScenario(ctx, otherLead, { file: '.runcastle/scenarios/base/onboarded.ts' })).toMatchObject({ ok: false })
    // Its own start finds the slot held, retriably.
    expect(await toolFeatureDrive(ctx, otherLead, { action: 'start' })).toMatchObject({ ok: false, retriable: true })
    expect(leadDriveFor(project.id, feature.id)).toBe(true)
  }, 30_000)

  it('goes back when the lead’s session ends, and only that session’s', async () => {
    await leadUp()
    const otherSession = createSessionRow(ctx, { featureId: feature.id, kind: 'chat', worktreePath: project.repoPath })
    await releaseLeadDrive(ctx, otherSession.id, feature.id)
    expect(leadDriveFor(project.id, feature.id)).toBe(true)
    await releaseLeadDrive(ctx, lead.id, feature.id)
    expect(activeDriveInfo(project.id)).toBeNull()
  }, 30_000)
})
