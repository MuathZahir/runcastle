import { mkdirSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { dirname, join } from 'node:path'
import { type Feature, type PreparedKey, type Project, resolveModelEntry } from '@runcastle/core'
import { simpleGit, type SimpleGit } from 'simple-git'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { createSessionRow, getSessionRow } from '../src/launcher/sessions'
import { toolRunScenario } from '../src/mcp/server'
import { recordFinding } from '../src/services/findings'
import {
  __resetTestDriveState,
  __setAppReadinessTiming,
  activeDriveInfo,
  createFeatureBranch,
  projectDrive,
  recordDriveUrl,
  testDrive,
} from '../src/services/git'
import { rosterConfig } from '../src/services/model-discovery'
import { getProjectById } from '../src/services/repo'
import { createCallerFactory } from '../src/trpc/context'
import { appRouter } from '../src/trpc/router'
import { type AgentHost, createAgentHost, setAgentHostForTests } from '../src/threads/host'
import { threadLifecycle } from '../src/threads/lifecycle'
import { appendThreadEvent } from '../src/threads/log'
import { forgetDriveTurnBasesForTests } from '../src/workers/drive'
import { writeHostHandback } from '../src/workers/review'
import { getWorker, listProjectWorkers, listWorkers, withWorkers, workerTurnSlot } from '../src/workers/service'
import { useDataDir } from './helpers/data-dir'
import { makeTestCtx } from './helpers/db'
import { rmTemp, seedDriveWorker, seedFeature, seedProject, tmpRepo } from './helpers/fixtures'
import { usePipePty } from './helpers/pipe-pty'
import { createFakeAcp, FAKE_LAUNCH, type FakeTurn } from './support/fake-acp-agent'
import { briefOf, promptsOf } from './support/thread-launch'

/**
 * Drive workers started from the drive's buttons (drive-chats-become-workers
 * ticket 2): Fix drive and New scenario / Fix it start or resume the owner's
 * worker, its commits on the driven branch are recorded on its row, and its
 * handback reaches the lead (or the project chat) held, without a turn.
 * Real git, real drives, a fake agent behind the real agent host.
 */

const WIN = process.platform === 'win32'
usePipePty()

let ctx: AppCtx
let repo: string
let g: SimpleGit
let project: Project
let feature: Feature
let host: AgentHost
let restoreDataDir: () => void
const servers: Server[] = []
/** What the fake agent does in each worker turn; says "Done." by default. */
let onTurn: (t: FakeTurn) => Promise<void> = async (t) => void (await t.say('Done.'))

function put(rel: string, body: string): void {
  const abs = join(repo, ...rel.split('/'))
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, body)
}

async function until(done: () => boolean, ms = 5000): Promise<void> {
  const deadline = Date.now() + ms
  while (!done()) {
    if (Date.now() > deadline) throw new Error('never got there')
    await new Promise((r) => setTimeout(r, 10))
  }
}

async function configure(key: PreparedKey, value: string): Promise<void> {
  recordFinding(ctx, project.id, { key, value, source: 'human' })
  project = getProjectById(ctx, project.id) as Project
}

async function serveApp(): Promise<string> {
  const server = createServer((_req, res) => res.end('app'))
  servers.push(server)
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/`
}

const caller = () => createCallerFactory(appRouter)(ctx)
const status = (id: string) => getWorker(ctx, id)?.status
const scenarioWorkerOf = (featureId: string) => listWorkers(ctx, featureId).find((w) => w.kind === 'scenario')!.id

/** A feature drive whose setup fails: what Fix drive works from. */
async function failedDrive(): Promise<void> {
  await configure('driveSetupCommand', 'echo could-not-reach-postgres && exit 3')
  expect((await testDrive(ctx, project, feature, 'start')).hookFailure?.command).toContain('exit 3')
}

/** The human's feature drive with its app answering: what the scenario buttons work from. */
async function driveUp(): Promise<void> {
  await configure('driveSetupCommand', 'echo ok')
  expect((await testDrive(ctx, project, feature, 'start', 'human')).ok).toBe(true)
  recordDriveUrl(ctx, project.id, feature.id, await serveApp())
  await until(() => activeDriveInfo(project.id)?.devReady === true)
}

/** A conversation under way, so a delivery reaches it rather than opening a new one. */
function underway(id: string): void {
  appendThreadEvent(id, { type: 'prompt', id: `p-${id}`, text: 'hello', source: 'human' })
}

beforeEach(async () => {
  __resetTestDriveState()
  __setAppReadinessTiming({ intervalMs: 10, budgetMs: 10_000 })
  restoreDataDir = useDataDir(tmpRepo())
  ctx = await makeTestCtx()
  repo = tmpRepo()
  g = simpleGit(repo)
  await g.init(['-b', 'main'])
  await g.addConfig('user.email', 'test@runcastle.dev')
  await g.addConfig('user.name', 'Runcastle Test')
  await g.addConfig('core.autocrlf', 'false')
  put('.gitignore', '.runcastle/drive.env\n')
  put('.runcastle/scenarios/checkout/land.ts', "console.log('ENTRY_URL=/')\n")
  await g.add('.')
  await g.commit('initial commit')
  project = seedProject(ctx, repo)
  feature = seedFeature(ctx, project.id, { slug: 'drive-me', title: 'Billing rewrite' })
  await createFeatureBranch(project, feature.slug, 'main')
  onTurn = async (t) => void (await t.say('Done.'))
  const fake = createFakeAcp({ turn: (t) => onTurn(t) })
  host = createAgentHost({
    ctx,
    transport: withWorkers(ctx, fake.transport),
    launch: FAKE_LAUNCH,
    lifecycle: threadLifecycle(ctx),
    turnSlot: workerTurnSlot(ctx),
    idleMs: 60_000,
  })
  setAgentHostForTests(host)
})

afterEach(async () => {
  await host.stopAll('shutdown')
  setAgentHostForTests(undefined)
  forgetDriveTurnBasesForTests()
  __resetTestDriveState()
  __setAppReadinessTiming()
  while (servers.length) await new Promise<void>((r) => servers.pop()?.close(() => r()))
  restoreDataDir()
  rmTemp(repo)
})

describe('Fix drive', () => {
  it('is refused with no failed drive of the feature, as today', async () => {
    await expect(caller().feature.fixDrive({ featureId: feature.id })).rejects.toThrow(/no failed drive to fix on drive-me/)
    expect(listWorkers(ctx, feature.id)).toEqual([])
  })

  it("starts the feature's Fix-drive worker on the drive chats' model, carrying the failure, and resumes it in a later drive", async () => {
    await failedDrive()
    const { sessionId, resumed } = await caller().feature.fixDrive({ featureId: feature.id })

    expect(resumed).toBe(false)
    expect(getWorker(ctx, sessionId)).toMatchObject({
      kind: 'fix-drive',
      label: 'Fix drive',
      featureId: feature.id,
      projectId: project.id,
      startedBy: 'human',
      featureBranch: 'feature/drive-me',
      model: resolveModelEntry('prepare', rosterConfig(ctx), project).id,
    })
    expect(getSessionRow(ctx, sessionId)).toMatchObject({ kind: 'worker', worktreePath: repo })
    const first = promptsOf(sessionId)[0]?.text ?? ''
    expect(first).toContain('could-not-reach-postgres')
    expect(first).toContain('exit 3')
    await until(() => status(sessionId) === 'needs-you')

    // The drive stops; a later drive fails again and the same worker picks it up.
    await testDrive(ctx, project, feature, 'stop')
    await failedDrive()
    const again = await caller().feature.fixDrive({ featureId: feature.id })
    expect(again).toEqual({ sessionId, resumed: true })
    expect(listWorkers(ctx, feature.id)).toHaveLength(1)
    expect(promptsOf(sessionId).at(-1)?.text).toContain('The human pressed Fix drive')
  })

  it("briefs it with today's drive-fix brief and the worker's rules", async () => {
    await failedDrive()
    const { sessionId } = await caller().feature.fixDrive({ featureId: feature.id })
    const brief = await briefOf(ctx, sessionId)
    expect(brief).toContain('## What failed')
    expect(brief).toContain('could-not-reach-postgres')
    expect(brief).toContain('Only the human talks to you')
    expect(brief).toContain('which branch it landed on** (`feature/drive-me`)')
    expect(brief).toContain('call `hand_back`')
    expect(brief).toContain('Once `retry_drive` has the app answering again')
  })
})

describe('New scenario / Fix it', () => {
  it("starts the feature's Scenarios worker docked beside the drive, so run_scenario accepts it", async () => {
    await driveUp()
    const { sessionId } = await caller().feature.openScenarioChat({ projectId: project.id, description: 'a buyer with a cart' })

    expect(getWorker(ctx, sessionId)).toMatchObject({ kind: 'scenario', label: 'Scenarios', featureId: feature.id })
    expect(activeDriveInfo(project.id)?.scenarioSessionId).toBe(sessionId)
    expect(promptsOf(sessionId)[0]?.text).toContain('a buyer with a cart')
    await expect(toolRunScenario(ctx, getSessionRow(ctx, sessionId)!, '.runcastle/scenarios/checkout/land.ts')).resolves.toBeDefined()
    const brief = await briefOf(ctx, sessionId)
    expect(brief).toContain('## The scenario contract')
    expect(brief).toContain('Only the human talks to you')

    // A second press sends the new ask into the same worker.
    await until(() => status(sessionId) === 'needs-you')
    const again = await caller().feature.openScenarioChat({ projectId: project.id, description: 'an empty cart' })
    expect(again.sessionId).toBe(sessionId)
    expect(promptsOf(sessionId).at(-1)?.text).toContain('an empty cart')
  })

  it('is refused while the Fix-drive worker of the same feature is working, naming it', async () => {
    await driveUp()
    seedDriveWorker(ctx, { feature }, 'fix-drive', repo, { status: 'working' })
    await expect(caller().feature.openScenarioChat({ projectId: project.id, description: 'x' })).rejects.toThrow(
      'Fix drive is working — wait for it to finish',
    )
    expect(listWorkers(ctx, feature.id).filter((w) => w.kind === 'scenario')).toEqual([])
  })
})

describe('the commits it makes and its handback', () => {
  it("records the turn's commits on the driven branch, then hands back to the lead as a held card that starts no turn", async () => {
    const lead = createSessionRow(ctx, { featureId: feature.id, kind: 'chat', worktreePath: repo })
    underway(lead.id)
    await driveUp()
    onTurn = async (t) => {
      put('.runcastle/scenarios/cart/full.ts', "console.log('ENTRY_URL=/cart')\n")
      await g.add('.runcastle/scenarios/cart/full.ts')
      await g.commit('scenario: a full cart')
      writeHostHandback(scenarioWorkerOf(feature.id), 'Wrote the full-cart scenario.')
      await t.say('Committed on feature/drive-me.')
    }
    const workerId = (await caller().feature.openScenarioChat({ projectId: project.id, description: 'a full cart' })).sessionId
    await until(() => status(workerId) === 'handed-back')

    const w = getWorker(ctx, workerId)!
    expect(w.featureBranch).toBe('feature/drive-me')
    expect(w.handbackCommits).toEqual([expect.stringMatching(/^[0-9a-f]{7} scenario: a full cart$/)])
    expect(w.handbackFiles).toEqual(['.runcastle/scenarios/cart/full.ts'])
    expect(w.outcome).toBeNull()

    const card = promptsOf(lead.id).at(-1)
    expect(card?.held).toBe(true)
    expect(card?.text).toContain('feature/drive-me')
    expect(card?.text).toContain('scenario: a full cart')
    expect(card?.text).toContain('.runcastle/scenarios/cart/full.ts')
    expect(card?.display).toMatchObject({ handback: { workerId, branch: 'feature/drive-me', files: ['.runcastle/scenarios/cart/full.ts'] } })
    expect(host.isRunning(lead.id)).toBe(false)

    // The next press in a later drive starts its tally afresh and works again.
    onTurn = async (t) => void (await t.say('Done.'))
    await caller().feature.openScenarioChat({ projectId: project.id, description: 'another' })
    expect(getWorker(ctx, workerId)).toMatchObject({ status: 'working', handbackCommits: [], handbackFiles: [] })
  })

  it.runIf(!WIN)("puts a project drive's Scenarios worker's card in the project chat, held", async () => {
    const chat = createSessionRow(ctx, { projectId: project.id, kind: 'project', worktreePath: repo })
    underway(chat.id)
    const server = createServer((_req, res) => res.end('app'))
    servers.push(server)
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
    await configure('devCommand', `echo http://127.0.0.1:${(server.address() as AddressInfo).port}/; sleep 30`)
    expect((await projectDrive(ctx, project, 'start')).ok).toBe(true)
    await until(() => activeDriveInfo(project.id)?.devReady === true, 10_000)

    onTurn = async (t) => {
      writeHostHandback(listProjectWorkers(ctx, project.id)[0]!.id, 'Set nothing up yet.')
      await t.say('Done.')
    }
    const workerId = (await caller().feature.openScenarioChat({ projectId: project.id })).sessionId
    expect(getWorker(ctx, workerId)).toMatchObject({ featureId: null, projectId: project.id, featureBranch: 'main' })
    expect(listProjectWorkers(ctx, project.id).map((w) => w.id)).toEqual([workerId])
    await until(() => status(workerId) === 'handed-back')

    const card = promptsOf(chat.id).at(-1)
    expect(card?.held).toBe(true)
    expect(card?.text).toContain('Set nothing up yet.')
    expect(card?.display).toMatchObject({ handback: { workerId, branch: 'main' } })
    expect(host.isRunning(chat.id)).toBe(false)
    await projectDrive(ctx, project, 'stop')
  }, 30_000)
})
