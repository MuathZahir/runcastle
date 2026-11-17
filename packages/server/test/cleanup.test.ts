import { existsSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type Feature, LABEL_DATA_DIR, LABEL_DOCKERFILE_HASH, LABEL_PROJECT, LABEL_WORKER } from '@runcastle/core'
import { dataDir } from '@runcastle/core/paths'
import type { AppCtx } from '../src/db/types'
import { workers } from '../src/db/schema'
import { createSessionRow, getSessionRow, markSessionEnded, markSessionLive } from '../src/launcher/sessions'
import { toolDropWorker, toolLandWorker, toolMessageWorker, toolStartWorker } from '../src/mcp/server'
import { listByProject } from '../src/services/events'
import { createShutdown } from '../src/shutdown'
import { setAgentHostForTests } from '../src/threads/host'
import type { AgentHost } from '../src/threads/types'
import { setSandboxEngineForTests } from '../src/workers/engine'
import { ORIGIN_MOUNT, ownershipOf } from '../src/workers/ownership'
import { getWorker, keptConversationPath, removeFeatureWorkers, workerStopped, workerTurnEnded } from '../src/workers/service'
import {
  extraSweepSteps,
  registerSweepStep,
  removeInstallResources,
  stopOwnWorkerContainers,
  sweepLeftovers,
  sweptMessage,
  NOUNS,
} from '../src/workers/sweep'
import { runtimeDirName, workerLabels, workerOrigin } from '../src/workers/worker'
import { useDataDir } from './helpers/data-dir'
import { makeTestCtx } from './helpers/db'
import { rmTemp, seedFeature, seedProject, tmpRepo } from './helpers/fixtures'
import { commitOn, fakeEngine, fakeHost, git, initRepo, type FakeEngine } from './support/fake-workers'

/**
 * Runcastle cleans up after itself (docs/features/runcastle-cleans-up-after-itself):
 * which containers each lifecycle path removes or stops, and what the sweep
 * removes for every ownership label case. No container: the fake engine, with
 * labels and a listing.
 */

let ctx: AppCtx
let home: string
let other: string
let restoreDataDir: () => void
let repo: string
let feature: Feature
let lead: string
let engine: FakeEngine
let host: ReturnType<typeof fakeHost>

beforeEach(async () => {
  home = tmpRepo()
  other = tmpRepo()
  restoreDataDir = useDataDir(home)
  ctx = await makeTestCtx()
  repo = initRepo('work')
  feature = seedFeature(ctx, seedProject(ctx, repo).id, { slug: 'work' })
  lead = createSessionRow(ctx, { featureId: feature.id, kind: 'chat', worktreePath: '/wt' }).id
  markSessionLive(ctx, lead, { ccSessionId: `cc-${lead}` })
  markSessionEnded(ctx, lead)
  engine = fakeEngine()
  setSandboxEngineForTests(engine)
  host = fakeHost()
  setAgentHostForTests(host.host)
  vi.stubEnv('CLAUDE_CODE_OAUTH_TOKEN', 'test-token')
  extraSweepSteps.length = 0
})

afterEach(() => {
  setAgentHostForTests(undefined)
  setSandboxEngineForTests(undefined)
  vi.unstubAllEnvs()
  restoreDataDir()
  extraSweepSteps.length = 0
  rmTemp(home)
  rmTemp(other)
  rmTemp(repo)
})

const leadSession = () => getSessionRow(ctx, lead)!
const containerOf = (id: string) => getWorker(ctx, id)!.container!

async function startWorker(label = 'Header'): Promise<string> {
  const { workerId } = await toolStartWorker(ctx, leadSession(), { label, purpose: label, kind: 'on-its-own', goal: `Build the ${label}` })
  return workerId
}

/** Give the worker a conversation file inside its sandbox, so keeping it shows in `engine.order` as `copyOut`. */
function withConversation(id: string): void {
  markSessionLive(ctx, id, { ccSessionId: `conv-${id}` })
  engine.conversationPaths.set(`conv-${id}`, `/c/${id}.jsonl`)
  engine.sandboxFiles.set(`/c/${id}.jsonl`, '{}\n')
}

async function handBack(id: string): Promise<void> {
  commitOn(repo, getWorker(ctx, id)!.branch!, `${id}.txt`, 'x\n', 'feat: x')
  engine.handbacks.set(id, { summary: 'Done', at: Date.now() })
  await workerTurnEnded(ctx, { id })
}

const sweptLines = () => listByProject(ctx, feature.projectId).filter((e) => e.type.startsWith('cleanup.'))

describe('the lifecycle', () => {
  it('land: keeps the conversation, then removes the container like a drop; the landed worker refuses messages', async () => {
    const id = await startWorker()
    await handBack(id)
    withConversation(id)
    engine.order.length = 0

    expect(await toolLandWorker(ctx, leadSession(), { workerId: id })).toMatchObject({ ok: true })

    expect(engine.order).toEqual(['copyOut', 'remove'])
    expect(engine.removed).toEqual([containerOf(id)])
    expect(existsSync(keptConversationPath(id))).toBe(true)
    expect(getWorker(ctx, id)!.status).toBe('landed')
    await expect(toolMessageWorker(ctx, leadSession(), { workerId: id, text: 'one more thing' })).rejects.toThrow(/already landed/)
    // A normal land adds no cleanup line of its own (decision 11).
    expect(sweptLines()).toEqual([])
  })

  it('drop: keeps the conversation, then removes the container', async () => {
    const id = await startWorker()
    withConversation(id)
    engine.order.length = 0
    await toolDropWorker(ctx, leadSession(), { workerId: id })
    expect(engine.order).toEqual(['copyOut', 'remove'])
    expect(engine.held.has(containerOf(id))).toBe(false)
  })

  it('records the container on the worker the moment it runs, before setup finishes', async () => {
    let release = (): void => {}
    engine.setupGate = new Promise((r) => (release = r))
    const starting = startWorker()
    await until(() => (ctx.db.select().from(workers).get()?.container ?? null) !== null)
    const row = ctx.db.select().from(workers).get()!
    expect(row.container).toMatch(/^runcastle-worker-/)
    expect(row.branch).toBeNull()
    release()
    await starting
    expect(getWorker(ctx, row.id)!.branch).toMatch(/^runcastle\/worker\//)
  })

  it('drop during setup: marked dropped at once, removed when setup finishes, with no kickoff', async () => {
    let release = (): void => {}
    engine.setupGate = new Promise((r) => (release = r))
    const starting = startWorker()
    await until(() => (ctx.db.select().from(workers).get()?.container ?? null) !== null)
    const id = ctx.db.select().from(workers).get()!.id

    await toolDropWorker(ctx, leadSession(), { workerId: id })
    expect(getWorker(ctx, id)!.status).toBe('dropped')
    // Setup is still under way: nothing is pulled out from under it.
    expect(engine.removed).toEqual([])

    release()
    await expect(starting).rejects.toThrow(/dropped while its sandbox was being set up/)
    expect(engine.removed).toEqual([containerOf(id)])
    expect(host.sent.filter((s) => s.threadId === id)).toEqual([])
    expect(getWorker(ctx, id)!.status).toBe('dropped')
  })

  it('setup failure: the container and bare copy go at once, and the worker is failed', async () => {
    engine.setupFailure = 'bun install exited 1'
    await expect(startWorker()).rejects.toThrow(/bun install exited 1/)
    const w = ctx.db.select().from(workers).get()!
    expect(w.status).toBe('failed')
    expect(w.container).toMatch(/^runcastle-worker-/)
    expect(engine.removed).toEqual([w.container])
    expect(engine.held.size).toBe(0)
    expect(existsSync(workerOrigin(w.id))).toBe(false)
  })

  it('fail: stops the container and keeps it', async () => {
    const id = await startWorker()
    await workerStopped(ctx, { id }, 'crashed')
    expect(getWorker(ctx, id)!.status).toBe('failed')
    expect(engine.stopped).toEqual([containerOf(id)])
    expect(engine.held.get(containerOf(id))).toBe(false)
    expect(engine.removed).toEqual([])
  })

  it('merge: every worker still holding a container has its conversation kept and is removed; a landed one is not removed twice', async () => {
    const landed = await startWorker('Header')
    await handBack(landed)
    await toolLandWorker(ctx, leadSession(), { workerId: landed })
    const open = await startWorker('Footer')
    withConversation(open)
    engine.order.length = 0
    engine.removed.length = 0

    await removeFeatureWorkers(ctx, feature.id, 'merged')

    expect(engine.removed).toEqual([containerOf(open)])
    expect(engine.order).toEqual(['copyOut', 'remove'])
    expect(getWorker(ctx, open)!.status).toBe('dropped')
  })

  it('shutdown: stops every running worker container of this install, never another install’s, within the shutdown', async () => {
    const id = await startWorker()
    engine.held.set('runcastle-worker-theirs', true)
    engine.labels.set('runcastle-worker-theirs', { [LABEL_DATA_DIR]: other })
    const codes: number[] = []
    createShutdown({
      killAllTrees: async () => {},
      stopWorkerContainers: async () => void (await stopOwnWorkerContainers(ctx)),
      stop: () => {},
      exit: (c) => codes.push(c),
    })()
    await until(() => codes.length > 0)
    expect(engine.stopped).toEqual([containerOf(id)])
    expect(engine.held.get('runcastle-worker-theirs')).toBe(true)
  })

  it('the copied-database hazard: a worker row naming another install’s container is refused, and the container left alone', async () => {
    const id = await startWorker()
    // As in a drive: this database's row names a container the real install (another live data folder) made.
    engine.labels.set(containerOf(id), workerLabels(id, feature.projectId))
    engine.labels.set(containerOf(id), { ...engine.labels.get(containerOf(id))!, [LABEL_DATA_DIR]: other })
    await expect(toolDropWorker(ctx, leadSession(), { workerId: id })).rejects.toThrow(/belongs to the runcastle install at/)
    expect(engine.removed).toEqual([])
    expect(engine.held.get(containerOf(id))).toBe(true)

    // Nor does the sweep touch it, though its row is now dropped.
    await sweepLeftovers(ctx)
    expect(engine.removed).toEqual([])
    expect(engine.stopped).toEqual([])
  })
})

describe('the sweep', () => {
  /** A container on the fake engine with these labels and mounts. */
  function hold(name: string, labels: Record<string, string>, opts: { running?: boolean; size?: number; mounts?: { type: string; source: string; destination: string }[] } = {}): void {
    engine.held.set(name, opts.running ?? true)
    engine.labels.set(name, labels)
    if (opts.mounts) engine.mounts.set(name, opts.mounts)
    if (opts.size !== undefined) engine.sizes.set(name, opts.size)
  }

  it('removes this install’s worker containers with no row, a landed row or a closed feature, and stops a live one it leaves', async () => {
    const live = await startWorker('Live')
    const landed = await startWorker('Landed')
    await handBack(landed)
    await toolLandWorker(ctx, leadSession(), { workerId: landed })
    // The land's removal did not get it (a failure), so the sweep must, keeping the conversation first.
    hold(containerOf(landed), workerLabels(landed, feature.projectId), { size: 2e9 })
    withConversation(landed)
    hold('runcastle-worker-norow', workerLabels('sess_gone', feature.projectId), { size: 1e9 })
    engine.removed.length = 0
    engine.order.length = 0

    const result = await sweepLeftovers(ctx)

    expect(engine.removed.sort()).toEqual([containerOf(landed), 'runcastle-worker-norow'].sort())
    expect(engine.order).toEqual(['copyOut', 'remove'])
    expect(engine.stopped).toEqual([containerOf(live)])
    expect(result).toMatchObject({ removed: 2, stopped: 1, failed: 0, freedBytes: 3e9 })
    expect(sweptLines().map((e) => [e.type, e.message])).toEqual([['cleanup.swept', 'Removed 2 leftover containers (3.0 GB)']])
  })

  it('removes a closed feature’s worker container', async () => {
    const id = await startWorker()
    ctx.db.update(workers).set({ status: 'handed-back' }).run()
    const { features } = await import('../src/db/schema')
    ctx.db.update(features).set({ status: 'archived' }).run()
    await sweepLeftovers(ctx)
    expect(engine.removed).toEqual([containerOf(id)])
  })

  it('fails and removes a worker whose setup a killed server cut off', async () => {
    const id = await startWorker()
    // As the last server left it: container recorded, setup never finished.
    ctx.db.update(workers).set({ branch: null }).run()
    await sweepLeftovers(ctx)
    expect(engine.held.has(containerOf(id))).toBe(false)
    expect(getWorker(ctx, id)).toMatchObject({ status: 'failed', failure: expect.stringMatching(/cut off/) })
  })

  it('never touches another live install’s containers or volumes', async () => {
    hold('runcastle-worker-x1', { [LABEL_DATA_DIR]: other, [LABEL_WORKER]: 'sess_x' })
    engine.volumes = [{ name: 'runcastle-proj_theirs', labels: { [LABEL_DATA_DIR]: other } }]
    const result = await sweepLeftovers(ctx)
    expect(engine.removed).toEqual([])
    expect(engine.stopped).toEqual([])
    expect(engine.removedVolumes).toEqual([])
    expect(result.removed).toBe(0)
    expect(sweptLines()).toEqual([])
  })

  it('removes what an install whose data folder is gone left behind', async () => {
    const gone = join(other, 'drive-data-dir-deleted')
    hold('runcastle-worker-d1', { [LABEL_DATA_DIR]: gone, [LABEL_PROJECT]: 'proj_drive' })
    engine.volumes = [{ name: 'runcastle-proj_drive', labels: { [LABEL_DATA_DIR]: gone } }]
    await sweepLeftovers(ctx)
    expect(engine.removed).toEqual(['runcastle-worker-d1'])
    expect(engine.removedVolumes).toEqual(['runcastle-proj_drive'])
  })

  it('knows an unlabelled worker container by its origin mount: this install’s goes, another’s stays', async () => {
    hold('runcastle-worker-old1', {}, { mounts: [{ type: 'bind', source: join(dataDir(), 'workers', 'origins', 'sess_old1.git'), destination: ORIGIN_MOUNT }] })
    hold('runcastle-worker-old2', {}, { mounts: [{ type: 'bind', source: join(other, 'workers', 'origins', 'sess_old2.git'), destination: ORIGIN_MOUNT }] })
    mkdirSync(join(other, 'workers', 'origins', 'sess_old2.git'), { recursive: true })
    await sweepLeftovers(ctx)
    expect(engine.removed).toEqual(['runcastle-worker-old1'])
    expect(engine.held.has('runcastle-worker-old2')).toBe(true)
  })

  it('removes the retired burn engine’s containers, and never a container runcastle did not make', async () => {
    hold('sandcastle-7d129771-f47b-4b48-866f-742626918af8', { [LABEL_DOCKERFILE_HASH]: 'abc' }, { running: true })
    hold('runcastle-run_hoK-NUHR8lJ1-t3', { [LABEL_DOCKERFILE_HASH]: 'abc' }, { running: false })
    // a short `--rm` helper runcastle runs from its own image right now (the cache chown, doctor's probe)
    hold('busy_turing', { [LABEL_DOCKERFILE_HASH]: 'abc' }, { running: true })
    hold('postgres', {})
    hold('my-app', { 'com.example': 'x' })
    await sweepLeftovers(ctx)
    expect(engine.removed.sort()).toEqual(['runcastle-run_hoK-NUHR8lJ1-t3', 'sandcastle-7d129771-f47b-4b48-866f-742626918af8'])
    expect([...engine.held.keys()].sort()).toEqual(['busy_turing', 'my-app', 'postgres'])
  })

  it('removes unmounted cache volumes of projects not in this install and the legacy shared one; keeps its own and mounted ones', async () => {
    engine.volumes = [
      { name: `runcastle-${feature.projectId}`, labels: {} },
      { name: 'runcastle-proj_removed', labels: {}, sizeBytes: 5e8 },
      { name: 'runcastle-proj_inuse', labels: {} },
      { name: 'runcastle-worker-cache', labels: {} },
      { name: 'someone-elses', labels: {} },
    ]
    hold('sandcastle-mounting', {}, { mounts: [{ type: 'volume', source: 'runcastle-proj_inuse', destination: '/home/agent/cache' }] })
    await sweepLeftovers(ctx)
    expect(engine.removedVolumes.sort()).toEqual(['runcastle-proj_removed', 'runcastle-worker-cache'])
  })

  it('removes orphan worker copies and branches, and runtime folders of older versions', async () => {
    const id = await startWorker()
    const origins = join(dataDir(), 'workers', 'origins')
    mkdirSync(join(origins, 'sess_unknown.git'), { recursive: true })
    mkdirSync(join(origins, `${id}.git`), { recursive: true })
    git(repo, 'branch', 'runcastle/worker/orphan1', 'main')
    const runtime = join(dataDir(), 'workers', 'runtime')
    mkdirSync(join(runtime, 'old-version'), { recursive: true })
    mkdirSync(join(runtime, runtimeDirName()), { recursive: true })

    await sweepLeftovers(ctx)

    expect(existsSync(join(origins, 'sess_unknown.git'))).toBe(false)
    expect(existsSync(join(origins, `${id}.git`))).toBe(true)
    const branches = git(repo, 'branch', '--list', 'runcastle/worker/*')
    expect(branches).not.toContain('orphan1')
    expect(branches).toContain(getWorker(ctx, id)!.branch!)
    expect(existsSync(join(runtime, 'old-version'))).toBe(false)
    expect(existsSync(join(runtime, runtimeDirName()))).toBe(true)
  })

  it('removes the burn engine’s clean worktrees and names the dirty ones once', async () => {
    const root = join(repo, '.sandcastle', 'worktrees')
    mkdirSync(root, { recursive: true })
    git(repo, 'worktree', 'add', '-q', join(root, 'clean'), '-b', 'sandcastle/clean', 'main')
    git(repo, 'worktree', 'add', '-q', join(root, 'dirty'), '-b', 'sandcastle/dirty', 'main')
    writeFileSync(join(root, 'dirty', 'wip.txt'), 'not committed\n')

    await sweepLeftovers(ctx)
    await sweepLeftovers(ctx)

    expect(existsSync(join(root, 'clean'))).toBe(false)
    expect(readFileSync(join(root, 'dirty', 'wip.txt'), 'utf8')).toBe('not committed\n')
    const kept = sweptLines().filter((e) => e.type === 'cleanup.kept')
    expect(kept).toHaveLength(1)
    expect(kept[0]!.message).toContain(join(root, 'dirty'))
  })

  it('runs extra steps, one sweep at a time, and turns any failure into a cleanup.failed line', async () => {
    let inside = 0
    let most = 0
    registerSweepStep({
      name: 'images',
      run: async (_ctx, report) => {
        inside++
        most = Math.max(most, inside)
        await new Promise((r) => setTimeout(r, 10))
        report.removed(feature.projectId, { one: 'old image', many: 'old images' }, undefined)
        inside--
      },
    })
    registerSweepStep({
      name: 'captures',
      run: async () => {
        throw new Error('disk on fire')
      },
    })
    await Promise.all([sweepLeftovers(ctx), sweepLeftovers(ctx)])
    expect(most).toBe(1)
    const lines = sweptLines().map((e) => [e.type, e.message])
    expect(lines).toContainEqual(['cleanup.swept', 'Removed 1 old image (space freed unknown)'])
    expect(lines).toContainEqual(['cleanup.failed', expect.stringContaining('captures: disk on fire')])
  })

  it('removes old sandbox images and stale review captures, on the project’s line', async () => {
    let asked: { dataDir: string; liveProjectIds: readonly string[] } | undefined
    engine.removeStaleImages = async (input) => {
      asked = input
      return {
        removed: [{ id: 'sha256:old', tags: [`sandcastle:runcastle-${feature.projectId}`], reason: 'dangling', bytes: 1e9 }],
        freedBytes: 1e9,
        failed: [],
      }
    }
    // A capture no row maps to, untouched for 40 days; a fresh one beside it stays.
    const stale = join(dataDir(), 'reviews', 'rev_stale')
    const fresh = join(dataDir(), 'reviews', 'rev_fresh')
    for (const dir of [stale, fresh]) {
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'shot.png'), 'x'.repeat(1000))
    }
    const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000)
    utimesSync(join(stale, 'shot.png'), old, old)
    utimesSync(stale, old, old)

    await sweepLeftovers(ctx)

    expect(asked?.liveProjectIds).toContain(feature.projectId)
    expect(existsSync(stale)).toBe(false)
    expect(existsSync(fresh)).toBe(true)
    expect(sweptLines().map((e) => e.message)).toContain('Removed 1 old image and 1 old review capture (1.0 GB)')
  })

  it('never throws when the engine fails', async () => {
    engine.listContainers = async () => {
      throw new Error('engine went away')
    }
    await expect(sweepLeftovers(ctx)).resolves.toMatchObject({ failed: 1 })
    expect(sweptLines().map((e) => e.type)).toEqual(['cleanup.failed'])
  })

  it('leaves a worker whose agent still runs', async () => {
    setAgentHostForTests({ ...host.host, isRunning: () => true } as AgentHost)
    const id = await startWorker()
    ctx.db.update(workers).set({ status: 'dropped' }).run()
    await sweepLeftovers(ctx)
    expect(engine.held.get(containerOf(id))).toBe(true)
  })

  it('says the space it freed', () => {
    const counts = new Map([
      [NOUNS.container, 3],
      [{ one: 'old image', many: 'old images' }, 1],
    ])
    expect(sweptMessage(counts, 11.2e9, 0)).toBe('Removed 3 leftover containers and 1 old image (11.2 GB)')
    expect(sweptMessage(counts, 11.2e9, 1)).toBe('Removed 3 leftover containers and 1 old image (at least 11.2 GB)')
    expect(sweptMessage(counts, 0, 2)).toBe('Removed 3 leftover containers and 1 old image (space freed unknown)')
  })
})

describe('a drive’s stop', () => {
  it('removes every container and volume labelled with the drive’s data folder, nothing else', async () => {
    const drive = join(other, 'drive')
    engine.held.set('runcastle-worker-d', true)
    engine.labels.set('runcastle-worker-d', { [LABEL_DATA_DIR]: drive })
    engine.held.set('runcastle-worker-mine', true)
    engine.labels.set('runcastle-worker-mine', { [LABEL_DATA_DIR]: dataDir() })
    engine.volumes = [
      { name: 'runcastle-proj_d', labels: { [LABEL_DATA_DIR]: drive } },
      { name: 'runcastle-proj_mine', labels: { [LABEL_DATA_DIR]: dataDir() } },
    ]
    expect(await removeInstallResources(engine, drive)).toEqual({ containers: ['runcastle-worker-d'], volumes: ['runcastle-proj_d'], failed: [] })
    expect(engine.held.has('runcastle-worker-mine')).toBe(true)
  })
})

describe('ownership', () => {
  const exists = (p: string) => p !== '/gone'
  it('sorts containers by their labels and, unlabelled, by what they are', () => {
    expect(ownershipOf({ name: 'runcastle-worker-a', labels: { [LABEL_DATA_DIR]: '/me' }, mounts: [] }, '/me', exists)).toBe('own')
    expect(ownershipOf({ name: 'runcastle-worker-a', labels: { [LABEL_DATA_DIR]: '/you' }, mounts: [] }, '/me', exists)).toBe('foreign')
    expect(ownershipOf({ name: 'runcastle-worker-a', labels: { [LABEL_DATA_DIR]: '/gone' }, mounts: [] }, '/me', exists)).toBe('orphan')
    const origin = (src: string) => [{ type: 'bind', source: src, destination: ORIGIN_MOUNT }]
    expect(ownershipOf({ name: 'runcastle-worker-a', labels: {}, mounts: origin('/me/workers/origins/s.git') }, '/me', exists)).toBe('own')
    expect(ownershipOf({ name: 'runcastle-worker-a', labels: {}, mounts: origin('/you/workers/origins/s.git') }, '/me', exists)).toBe('foreign')
    expect(ownershipOf({ name: 'runcastle-worker-a', labels: {}, mounts: origin('/gone/workers/origins/s.git') }, '/me', exists)).toBe('orphan')
    expect(ownershipOf({ name: 'runcastle-worker-a', labels: {}, mounts: [] }, '/me', exists)).toBe('foreign')
    expect(ownershipOf({ name: 'sandcastle-7d129771-f47b-4b48-866f-742626918af8', labels: { [LABEL_DOCKERFILE_HASH]: 'h' }, mounts: [] }, '/me', exists)).toBe('burn-engine')
    expect(ownershipOf({ name: 'busy_turing', labels: { [LABEL_DOCKERFILE_HASH]: 'h' }, mounts: [] }, '/me', exists)).toBe('foreign')
    expect(ownershipOf({ name: 'redis', labels: {}, mounts: [] }, '/me', exists)).toBe('foreign')
  })
})

async function until(done: () => boolean, ms = 3000): Promise<void> {
  const deadline = Date.now() + ms
  while (!done()) {
    if (Date.now() > deadline) throw new Error('never got there')
    await new Promise((r) => setTimeout(r, 5))
  }
}
