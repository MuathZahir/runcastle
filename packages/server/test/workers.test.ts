import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Feature } from '@runcastle/core'
import type { AppCtx } from '../src/db/types'
import { createSessionRow, getSessionRow, markSessionEnded, markSessionLive } from '../src/launcher/sessions'
import {
  featureContext,
  toolDropWorker,
  toolLandWorker,
  toolMessageWorker,
  toolSendBackWorker,
  toolStartWorker,
  toolsForAudience,
} from '../src/mcp/server'
import { listAfter } from '../src/services/events'
import { createCallerFactory } from '../src/trpc/context'
import { appRouter } from '../src/trpc/router'
import { setAgentHostForTests } from '../src/threads/host'
import { setSandboxEngineForTests } from '../src/workers/engine'
import { getWorker, workerPrompted, workerTurnEnded } from '../src/workers/service'
import { useDataDir } from './helpers/data-dir'
import { makeTestCtx } from './helpers/db'
import { rmTemp, seedFeature, seedProject, tmpRepo } from './helpers/fixtures'
import { commitOn, fakeEngine, fakeHost, git, initRepo } from './support/fake-workers'

/**
 * Interactive workers (docs/features/interactive-workers): the worker record
 * and its lifecycle, driven through the service and the lead's tools with a
 * fake sandbox engine (no container) and a fake agent host (no agent). The
 * git underneath is real: a handback's commits and a land are read from a
 * real repo.
 */

let ctx: AppCtx
let home: string
let restoreDataDir: () => void
let repo: string
let feature: Feature
let lead: string
let host: ReturnType<typeof fakeHost>
let engine: ReturnType<typeof fakeEngine>

beforeEach(async () => {
  home = tmpRepo()
  restoreDataDir = useDataDir(home)
  ctx = await makeTestCtx()
  repo = initRepo('work')
  feature = seedFeature(ctx, seedProject(ctx, repo).id, { slug: 'work' })
  // The lead: the feature's chat, its conversation on record.
  lead = createSessionRow(ctx, { featureId: feature.id, kind: 'chat', worktreePath: '/wt' }).id
  markSessionLive(ctx, lead, { ccSessionId: `cc-${lead}` })
  markSessionEnded(ctx, lead)
  host = fakeHost()
  setAgentHostForTests(host.host)
  engine = fakeEngine()
  setSandboxEngineForTests(engine)
})

afterEach(() => {
  setAgentHostForTests(undefined)
  setSandboxEngineForTests(undefined)
  restoreDataDir()
  rmTemp(home)
  rmTemp(repo)
})

const leadSession = () => getSessionRow(ctx, lead)!

function workerEvents(): { type: string; status: unknown }[] {
  return listAfter(ctx, feature.id, 0)
    .filter((e) => e.type.startsWith('worker.'))
    .map((e) => ({ type: e.type, status: (e.data as { status?: unknown }).status }))
}

const toLead = () => host.sent.filter((s) => s.threadId === lead)

async function startHeader(): Promise<string> {
  const { workerId } = await toolStartWorker(ctx, leadSession(), {
    label: 'Header',
    purpose: 'The page header',
    kind: 'with-you',
    goal: 'Build the header',
    doneWhen: 'The human likes it',
  })
  return workerId
}

/** The worker hands back with one commit on its branch. */
async function handBack(id: string, summary = 'Built the header; the human wants it blue.'): Promise<void> {
  const branch = getWorker(ctx, id)!.branch!
  commitOn(repo, branch, 'header.txt', 'header\n', 'feat: header')
  engine.handbacks.set(id, { summary, at: Date.now() })
  await workerTurnEnded(ctx, { id })
}

describe('a worker, start to land', () => {
  it('starts working, needs the human after a turn, works again on a message, hands back once and lands', async () => {
    const id = await startHeader()
    const started = getWorker(ctx, id)!
    expect(started).toMatchObject({ status: 'working', kind: 'with-you', startedBy: 'lead', label: 'Header', container: expect.any(String) })
    expect(getSessionRow(ctx, id)?.kind).toBe('worker')
    expect(host.sent.filter((s) => s.threadId === id).map((s) => s.text)).toEqual(['Start your assignment: Build the header\n\nDone when: The human likes it'])
    expect(workerEvents()).toEqual([{ type: 'worker.started', status: 'working' }])

    await workerTurnEnded(ctx, { id })
    expect(getWorker(ctx, id)?.status).toBe('needs-you')
    expect(workerEvents().at(-1)).toEqual({ type: 'worker.status', status: 'needs-you' })

    await toolMessageWorker(ctx, leadSession(), { workerId: id, text: 'Make it taller' })
    expect(getWorker(ctx, id)?.status).toBe('working')
    expect(host.sent.at(-1)).toEqual({ threadId: id, text: 'Make it taller' })
    expect(workerEvents().slice(-2)).toEqual([
      { type: 'worker.status', status: 'working' },
      { type: 'worker.messaged', status: 'working' },
    ])

    await handBack(id)
    const handed = getWorker(ctx, id)!
    expect(handed.status).toBe('handed-back')
    expect(handed.handbackSummary).toBe('Built the header; the human wants it blue.')
    expect(handed.handbackCommits).toEqual([expect.stringMatching(/^[0-9a-f]{7} feat: header$/)])
    expect(handed.handbackFiles).toEqual(['header.txt'])
    expect(workerEvents().at(-1)).toEqual({ type: 'worker.handed_back', status: 'handed-back' })
    expect(toLead()).toHaveLength(1)
    expect(toLead()[0]?.display).toEqual({
      handback: {
        workerId: id,
        label: 'Header',
        kind: 'with-you',
        summary: 'Built the header; the human wants it blue.',
        commits: handed.handbackCommits,
        files: ['header.txt'],
        threadId: id,
      },
    })
    expect(toLead()[0]?.text).toContain('land_worker')

    // A later turn with no new handback does not wake the lead again.
    await workerTurnEnded(ctx, { id })
    expect(toLead()).toHaveLength(1)
    expect(getWorker(ctx, id)?.status).toBe('handed-back')

    expect(await toolLandWorker(ctx, leadSession(), { workerId: id })).toEqual({ ok: true, commits: 1, files: 1 })
    expect(getWorker(ctx, id)).toMatchObject({ status: 'landed', outcome: 'landed' })
    expect(git(repo, 'log', '--format=%s', 'feature/work')).toContain('feat: header')
    expect(workerEvents().at(-1)).toEqual({ type: 'worker.landed', status: 'landed' })
  })

  it('leaves a worker that conflicts with the feature branch handed back, with the conflict for the lead', async () => {
    const id = await startHeader()
    commitOn(repo, 'feature/work', 'header.txt', 'the lead wrote this\n', 'feat: lead header')
    await handBack(id)
    const result = await toolLandWorker(ctx, leadSession(), { workerId: id })
    expect(result).toMatchObject({ ok: false, conflict: true, files: ['header.txt'] })
    expect(getWorker(ctx, id)?.status).toBe('handed-back')
    expect(workerEvents().at(-1)?.type).toBe('worker.land_failed')
  })

  it('works again when the human types to a worker that needs them', async () => {
    const id = await startHeader()
    await workerTurnEnded(ctx, { id })
    workerPrompted(ctx, id)
    expect(getWorker(ctx, id)?.status).toBe('working')
  })
})

describe('sending back and dropping', () => {
  it('sends the work back with the note, and the worker works again', async () => {
    const id = await startHeader()
    await handBack(id)
    await toolSendBackWorker(ctx, leadSession(), { workerId: id, note: 'Use the theme colour, not raw blue' })
    expect(getWorker(ctx, id)).toMatchObject({ status: 'working', outcome: 'sent-back', outcomeNote: 'Use the theme colour, not raw blue' })
    expect(host.sent.at(-1)?.threadId).toBe(id)
    expect(host.sent.at(-1)?.text).toContain('Use the theme colour, not raw blue')
    expect(workerEvents().at(-1)).toEqual({ type: 'worker.sent_back', status: 'working' })
  })

  it('drops a worker: its process stops, its container and branch go', async () => {
    const id = await startHeader()
    await handBack(id)
    const { container, branch } = getWorker(ctx, id)!
    await toolDropWorker(ctx, leadSession(), { workerId: id })
    expect(getWorker(ctx, id)).toMatchObject({ status: 'dropped', outcome: 'dropped' })
    expect(host.stopped).toEqual([id])
    expect(engine.removed).toEqual([container])
    expect(git(repo, 'branch', '--list', branch!)).toBe('')
    expect(workerEvents().at(-1)).toEqual({ type: 'worker.dropped', status: 'dropped' })
  })
})

describe('starting a worker', () => {
  it('says in plain words to start a container engine and run the doctor, and makes no worker', async () => {
    engine.up = false
    await expect(startHeader()).rejects.toThrow(/Docker or Podman.*runcastle doctor/)
    expect(featureContext(ctx, { featureId: feature.id }).workers).toEqual([])
  })

  it('refuses a model the human did not annotate', async () => {
    await expect(
      toolStartWorker(ctx, leadSession(), { label: 'X', purpose: 'x', kind: 'on-its-own', goal: 'g', doneWhen: 'd', model: 'not-a-model' }),
    ).rejects.toThrow(/not annotated/)
  })
})

describe("the lead's tools", () => {
  const LEAD_WORKER_TOOLS = ['start_worker', 'message_worker', 'land_worker', 'send_back_worker', 'drop_worker']

  it('are offered to the feature chat alone, and a worker is offered none of the chat’s tools', () => {
    for (const tool of LEAD_WORKER_TOOLS) expect(toolsForAudience('chat')).toContain(tool)
    for (const kind of ['side', 'drive-fix', 'scenario', 'project', 'run', 'worker'] as const) {
      expect(toolsForAudience(kind).filter((t) => LEAD_WORKER_TOOLS.includes(t))).toEqual([])
    }
    const chat = new Set(toolsForAudience('chat'))
    expect(toolsForAudience('worker').filter((t) => chat.has(t))).toEqual([])
  })

  it('are refused to any session but the lead', async () => {
    const id = await startHeader()
    const side = createSessionRow(ctx, { featureId: feature.id, kind: 'side', worktreePath: '/wt' })
    await expect(toolLandWorker(ctx, side, { workerId: id })).rejects.toThrow(/main chat/)
    await expect(toolDropWorker(ctx, getSessionRow(ctx, id)!, { workerId: id })).rejects.toThrow(/handback/)
    expect(getWorker(ctx, id)?.status).toBe('working')
  })

  it("refuse another feature's worker", async () => {
    const id = await startHeader()
    const other = seedFeature(ctx, feature.projectId, { slug: 'other' })
    const otherLead = createSessionRow(ctx, { featureId: other.id, kind: 'chat', worktreePath: '/wt' })
    await expect(toolMessageWorker(ctx, otherLead, { workerId: id, text: 'hi' })).rejects.toThrow(/no worker/)
  })
})

describe('get_feature_context', () => {
  it("lists the feature's workers with their status and latest handback", async () => {
    const id = await startHeader()
    await handBack(id)
    expect(featureContext(ctx, { featureId: feature.id }).workers).toEqual([
      {
        id,
        label: 'Header',
        purpose: 'The page header',
        kind: 'with-you',
        status: 'handed-back',
        startedBy: 'lead',
        model: expect.any(String),
        branch: getWorker(ctx, id)!.branch,
        updatedAt: expect.any(Number),
        handback: { summary: 'Built the header; the human wants it blue.', commits: [expect.stringContaining('feat: header')], files: ['header.txt'] },
      },
    ])
  })
})

describe('the worker router', () => {
  const caller = () => createCallerFactory(appRouter)(ctx)

  it('starts an unassigned worker that waits for the human, lists it, and asks it to hand back', async () => {
    const { workerId } = await caller().worker.startUnassigned({ featureId: feature.id })
    expect(getWorker(ctx, workerId)).toMatchObject({ kind: 'unassigned', startedBy: 'human', goal: null, status: 'working' })
    const kickoff = host.sent.find((s) => s.threadId === workerId)?.text ?? ''
    expect(kickoff).toMatch(/wait for the human/)

    expect((await caller().worker.list({ featureId: feature.id })).map((w) => w.id)).toEqual([workerId])

    await caller().worker.handBack({ workerId })
    expect(host.sent.at(-1)?.threadId).toBe(workerId)
    expect(host.sent.at(-1)?.text).toMatch(/hand_back/)
  })
})
