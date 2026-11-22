import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type Feature, LABEL_DATA_DIR, LABEL_DOCKERFILE_HASH, LABEL_OWNER, LABEL_PROJECT, LABEL_WORKER, type WorkerRow } from '@runcastle/core'
import { dataDir } from '@runcastle/core/paths'
import type { AppCtx } from '../src/db/types'
import { workers } from '../src/db/schema'
import { createSessionRow, markSessionEnded, markSessionLive } from '../src/launcher/sessions'
import { listByProject } from '../src/services/events'
import { setAgentHostForTests } from '../src/threads/host'
import { startContainerLeftovers } from '../src/workers/container-leftovers'
import { getWorker, keptConversationPath } from '../src/workers/service'
import { useDataDir } from './helpers/data-dir'
import { makeTestCtx } from './helpers/db'
import { rmTemp, seedFeature, seedProject, tmpRepo } from './helpers/fixtures'
import { commitOn, fakeCli, fakeHost, type FakeCli, git, initRepo } from './support/fake-workers'

/**
 * The upgrade step (sandboxes-are-removed decisions 3 and 4) against a fake
 * container CLI: it closes every worker still in a container with its commits
 * on a branch, removes what this install made for workers that landed or were
 * dropped and nothing else, keeps and names whatever may hold unfinished work,
 * and runs once.
 */

let ctx: AppCtx
let home: string
let dir: string
let restoreDataDir: () => void
let repo: string
let feature: Feature
let host: ReturnType<typeof fakeHost>
let cli: FakeCli
let repos: string[]

beforeEach(async () => {
  home = tmpRepo()
  restoreDataDir = useDataDir(home)
  dir = dataDir()
  ctx = await makeTestCtx()
  repo = initRepo('work')
  feature = seedFeature(ctx, seedProject(ctx, repo).id, { slug: 'work' })
  const lead = createSessionRow(ctx, { featureId: feature.id, kind: 'chat', worktreePath: '/wt' }).id
  markSessionLive(ctx, lead, { ccSessionId: `cc-${lead}` })
  markSessionEnded(ctx, lead)
  host = fakeHost()
  setAgentHostForTests(host.host)
  cli = fakeCli()
  repos = []
})

afterEach(() => {
  setAgentHostForTests(undefined)
  restoreDataDir()
  rmTemp(home)
  rmTemp(repo)
  for (const r of repos) rmTemp(r)
})

const ours = (extra: Record<string, string> = {}) => ({ [LABEL_OWNER]: 'runcastle', [LABEL_DATA_DIR]: dir, ...extra })
const leftoverEvents = () => listByProject(ctx, feature.projectId).filter((e) => e.type.startsWith('workers.leftovers'))

/** A worker row from the container era: no folder, a branch named for it. */
function containerWorker(status: WorkerRow['status'], opts: { branch?: boolean; on?: Feature } = {}): string {
  const f = opts.on ?? feature
  const session = createSessionRow(ctx, { featureId: f.id, kind: 'worker', worktreePath: '/wt' })
  const now = Date.now()
  ctx.db
    .insert(workers)
    .values({
      id: session.id,
      featureId: f.id,
      projectId: f.projectId,
      label: `Worker ${status}`,
      purpose: 'p',
      kind: 'on-its-own',
      goal: 'g',
      model: 'm',
      runtime: 'claude-code',
      startedBy: 'lead',
      status,
      featureBranch: f.branch,
      branch: opts.branch === false ? null : `runcastle/worker/${session.id}`,
      createdAt: now,
      updatedAt: now,
    })
    .run()
  return session.id
}

/** The worker's copy of the project in the data folder, holding one commit the project repo lacks. */
function originWithCommit(id: string, subject: string): void {
  const origin = join(dir, 'workers', 'origins', `${id}.git`)
  mkdirSync(join(dir, 'workers', 'origins'), { recursive: true })
  execFileSync('git', ['clone', '-q', '--bare', repo, origin])
  git(repo, 'branch', 'scratch', feature.branch)
  commitOn(repo, 'scratch', `${id}.txt`, 'x\n', subject)
  git(repo, 'push', '-q', origin, `scratch:refs/heads/runcastle/worker/${id}`)
  git(repo, 'branch', '-D', 'scratch')
}

const builder = (suffix: string) => `runcastle-build-${createHash('sha256').update(dir).digest('hex').slice(0, 8)}-${suffix}`

/**
 * A machine the container era left: in this project a working worker, a
 * landed one and a failed one; in a second project only a dropped one; and
 * things of this install, another install and the user.
 */
function seedMachine(): { unfinished: string; finished: string; failed: string; dropped: string; other: string } {
  const unfinished = containerWorker('working')
  originWithCommit(unfinished, 'feat: half a header')
  const finished = containerWorker('landed')
  markSessionLive(ctx, finished, { ccSessionId: `conv-${finished}` })
  markSessionEnded(ctx, finished)
  const failed = containerWorker('failed')
  const otherRepo = initRepo('other')
  repos.push(otherRepo)
  const otherFeature = seedFeature(ctx, seedProject(ctx, otherRepo).id, { slug: 'other' })
  const other = otherFeature.projectId
  const dropped = containerWorker('dropped', { on: otherFeature })
  const p = feature.projectId
  cli.containers = [
    { id: 'c1', name: `runcastle-worker-${unfinished}`, labels: ours({ [LABEL_WORKER]: unfinished, [LABEL_PROJECT]: p }), image: 'sha256:projimg', size: 5e6 },
    {
      id: 'c2',
      name: `runcastle-worker-${finished}`,
      labels: ours({ [LABEL_WORKER]: finished, [LABEL_PROJECT]: p }),
      size: 7e6,
      files: { [`/home/agent/.claude/projects/-home-agent-repo/conv-${finished}.jsonl`]: '{"type":"user"}\n' },
    },
    { id: 'c5', name: `runcastle-worker-${failed}`, labels: ours({ [LABEL_WORKER]: failed, [LABEL_PROJECT]: p }), size: 1e6 },
    { id: 'c6', name: `runcastle-worker-${dropped}`, labels: ours({ [LABEL_WORKER]: dropped, [LABEL_PROJECT]: other }), size: 2e6 },
    { id: 'c3', name: 'runcastle-worker-elsewhere', labels: { [LABEL_OWNER]: 'runcastle', [LABEL_DATA_DIR]: '/other/install', [LABEL_WORKER]: 'sess_x' } },
    { id: 'c4', name: 'my-postgres', labels: {} },
  ]
  cli.images = [
    { id: 'sha256:stock', size: 2e9, tags: ['sandcastle:runcastle'], labels: { [LABEL_DOCKERFILE_HASH]: 'h', ...ours() } },
    { id: 'sha256:projimg', size: 3e9, tags: [`sandcastle:runcastle-${p}`], labels: { [LABEL_DOCKERFILE_HASH]: 'h', ...ours({ [LABEL_PROJECT]: p }) } },
    { id: 'sha256:theirs', size: 1e9, tags: ['sandcastle:runcastle-proj_other'], labels: { [LABEL_DOCKERFILE_HASH]: 'h', [LABEL_DATA_DIR]: '/other/install' } },
    { id: 'sha256:mixed', size: 1e9, tags: [`sandcastle:runcastle-${p}-old`, 'myapp:latest'], labels: { [LABEL_DOCKERFILE_HASH]: 'h', ...ours() } },
  ]
  cli.volumes = [
    { name: `runcastle-${p}`, size: 4e8 },
    { name: `runcastle-${other}`, size: 3e8 },
    { name: 'runcastle-worker-cache', size: 1e8 },
    { name: 'runcastle-proj_gone', size: 1e8, labels: { [LABEL_DATA_DIR]: '/other/install' } },
    { name: 'pgdata', size: 1e9 },
  ]
  cli.builders = [builder('stock'), 'runcastle-build-00000000-stock', 'default']
  cli.buildCache = '2.5GB'
  for (const id of [finished, dropped, 'sess_unknown']) mkdirSync(join(dir, 'workers', 'origins', `${id}.git`), { recursive: true })
  mkdirSync(join(dir, 'workers', 'runtime', 'v1'), { recursive: true })
  writeFileSync(join(dir, 'workers', 'runtime', 'v1', 'worker-mcp.cjs'), 'x'.repeat(1000))
  return { unfinished, finished, failed, dropped, other }
}

const origin = (id: string) => join(dir, 'workers', 'origins', `${id}.git`)
const start = (run = cli.run) => startContainerLeftovers(ctx, { dataDir: dir, run, platform: 'linux' })

describe('a worker still in a container', () => {
  it('is failed with the plain reason, its commits kept on its branch, its lead told and its container named', async () => {
    const { unfinished } = seedMachine()
    const { closed, done } = start()
    await closed
    const w = getWorker(ctx, unfinished)!
    expect(w.status).toBe('failed')
    expect(w.failure).toContain('it ran in a container, which runcastle no longer has')
    expect(w.failure).toContain(`its commits are on branch runcastle/worker/${unfinished}`)
    expect(w.failure).toContain(`\`docker rm -f runcastle-worker-${unfinished}\` removes it`)
    expect(git(repo, 'log', '--format=%s', '-1', `runcastle/worker/${unfinished}`).trim()).toBe('feat: half a header')
    expect(host.sent.some((s) => s.text.includes(`Worker "Worker working" failed (worker ${unfinished})`))).toBe(true)
    const out = await done
    expect(out.closed).toEqual([unfinished])
    expect(out.kept).toContain(`container runcastle-worker-${unfinished}`)
  })

  it('says it made no commits when it never started building, and leaves host workers alone', async () => {
    const early = containerWorker('queued', { branch: false })
    const hostWorker = containerWorker('working')
    ctx.db.update(workers).set({ folder: '/feature' }).where(eq(workers.id, hostWorker)).run()
    cli.bin = null
    const out = await start().done
    expect(out.closed).toEqual([early])
    expect(getWorker(ctx, early)!.failure).toContain('it had not started building, so it made no commits')
    expect(getWorker(ctx, hostWorker)!.status).toBe('working')
  })
})

describe('what it removes and what it keeps', () => {
  it("removes a finished worker's container and keeps an unfinished worker's", async () => {
    const { unfinished, finished, failed, dropped } = seedMachine()
    await start().done
    const left = cli.containers.map((c) => c.name)
    expect(left).not.toContain(`runcastle-worker-${finished}`)
    expect(left).not.toContain(`runcastle-worker-${dropped}`)
    // Working when the upgrade came, failed before it: either may hold work that never landed.
    expect(left).toContain(`runcastle-worker-${unfinished}`)
    expect(left).toContain(`runcastle-worker-${failed}`)
  })

  it('removes only what this install made for landed or dropped workers, in every project, keeping their conversation first', async () => {
    const { unfinished, finished, failed, dropped, other } = seedMachine()
    const p = feature.projectId
    const out = await start().done

    expect(cli.removed.sort()).toEqual(
      [
        `container runcastle-worker-${finished}`,
        `container runcastle-worker-${dropped}`,
        'image sandcastle:runcastle',
        `volume runcastle-${other}`,
        `builder ${builder('stock')}`,
      ].sort(),
    )
    // What may hold unfinished work stays: its containers, the image one was made from,
    // its project's cache and the shared one, the copies of workers not landed or dropped.
    expect(cli.containers.map((c) => c.name)).toEqual([`runcastle-worker-${unfinished}`, `runcastle-worker-${failed}`, 'runcastle-worker-elsewhere', 'my-postgres'])
    expect(cli.images.map((i) => i.id)).toEqual(['sha256:projimg', 'sha256:theirs', 'sha256:mixed'])
    expect(cli.volumes.map((v) => v.name)).toEqual([`runcastle-${p}`, 'runcastle-worker-cache', 'runcastle-proj_gone', 'pgdata'])
    expect(readFileSync(keptConversationPath(finished), 'utf8')).toBe('{"type":"user"}\n')
    expect(existsSync(join(dir, 'workers', 'runtime'))).toBe(false)
    expect(existsSync(origin(finished))).toBe(false)
    expect(existsSync(origin(dropped))).toBe(false)
    expect(existsSync(origin(unfinished))).toBe(true)
    expect(existsSync(origin('sess_unknown'))).toBe(true)
    // Docker's shared build cache is only named, never pruned.
    expect(cli.calls.some((c) => c.startsWith('builder prune'))).toBe(false)

    // Everything kept is named with the exact command that removes it.
    expect(out.kept).toEqual(
      expect.arrayContaining([
        `container runcastle-worker-${unfinished}`,
        `container runcastle-worker-${failed}`,
        `image sandcastle:runcastle-${p}`,
        `volume runcastle-${p}`,
        'volume runcastle-worker-cache',
        `folder ${origin(unfinished)}`,
        `folder ${origin('sess_unknown')}`,
      ]),
    )
    expect(out.kept).toHaveLength(7)
    expect(out.commands.slice(0, 3)).toEqual([
      `docker rm -f runcastle-worker-${unfinished} runcastle-worker-${failed}`,
      `docker rmi sandcastle:runcastle-${p}`,
      `docker volume rm runcastle-${p} runcastle-worker-cache`,
    ])
    expect(out.commands.slice(3, 5).sort()).toEqual([`rm -rf "${origin(unfinished)}"`, `rm -rf "${origin('sess_unknown')}"`].sort())
    expect(out.commands[5]).toBe('docker builder prune')

    const [event] = leftoverEvents()
    expect(event).toMatchObject({ type: 'workers.leftovers_removed' })
    expect(event!.message).toContain('removed what it made for them for workers that landed or were dropped: 2 containers, 1 image, 1 cache volume, 1 image builder and 3 folders')
    expect(event!.message).toContain('It kept what may still hold unfinished work: 2 containers, 1 image, 2 cache volumes and 2 folders.')
    expect(event!.message).toContain(`\`docker rm -f runcastle-worker-${unfinished} runcastle-worker-${failed}\``)
    expect(event!.message).toContain("Docker's shared build cache holds 2.5 GB")
  })

  it("keeps a container whose worker it cannot find, and the burn engine's", async () => {
    const p = feature.projectId
    cli.containers = [
      { id: 'c1', name: 'runcastle-worker-sess_gone', labels: ours({ [LABEL_WORKER]: 'sess_gone', [LABEL_PROJECT]: p }) },
      { id: 'c2', name: 'sandcastle-12345678-1234-1234-1234-123456789abc', labels: { [LABEL_DOCKERFILE_HASH]: 'h' } },
    ]
    const out = await start().done
    expect(cli.removed).toEqual([])
    expect(out.kept).toEqual(['container runcastle-worker-sess_gone', 'container sandcastle-12345678-1234-1234-1234-123456789abc'])
  })
})

describe('once per install', () => {
  it('runs only once', async () => {
    seedMachine()
    expect((await start().done).ran).toBe(true)
    const calls = cli.calls.length
    const again = await start().done
    expect(again.ran).toBe(false)
    expect(cli.calls).toHaveLength(calls)
    expect(leftoverEvents()).toHaveLength(1)
  })

  it('with no docker or podman, only closes the unfinished workers, then is done', async () => {
    const { unfinished } = seedMachine()
    cli.bin = null
    const out = await start().done
    expect(out).toMatchObject({ ran: true, bin: null, closed: [unfinished], things: [], kept: [], commands: [] })
    expect(cli.calls).toEqual([])
    expect(existsSync(join(dir, 'workers', 'runtime'))).toBe(true)
    expect(getWorker(ctx, unfinished)!.failure).not.toContain('rm -f')
    cli.bin = 'docker'
    expect((await start().done).ran).toBe(false)
  })

  it('uses podman when it is the one that answers', async () => {
    const { unfinished } = seedMachine()
    cli.bin = 'podman'
    const out = await start().done
    expect(out.bin).toBe('podman')
    expect(out.commands[0]).toBe(`podman rm -f runcastle-worker-${unfinished} runcastle-worker-${getWorkerIdByStatus('failed')}`)
    // Builders and the shared build cache are Docker's own.
    expect(cli.calls.some((c) => c.startsWith('buildx'))).toBe(false)
    expect(out.commands.some((c) => c.includes('buildx') || c.includes('builder prune'))).toBe(false)
  })
})

function getWorkerIdByStatus(status: WorkerRow['status']): string {
  return ctx.db.select().from(workers).all().find((w) => w.status === status && w.label === `Worker ${status}`)!.id
}
