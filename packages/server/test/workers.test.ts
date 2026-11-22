import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
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
import { readThreadEvents } from '../src/threads/log'
import { writeHostHandback } from '../src/workers/review'
import { forgetDriveTurnBasesForTests } from '../src/workers/drive'
import { getWorker, messageWorker, startWorker, workerFolder, workerPrompted, workerTurnEnded } from '../src/workers/service'
import { useDataDir } from './helpers/data-dir'
import { makeTestCtx } from './helpers/db'
import { rmTemp, seedFeature, seedProject, tmpRepo } from './helpers/fixtures'
import { fakeHost, git, initRepo } from './support/fake-workers'

/**
 * Interactive workers (docs/features/interactive-workers): the worker record
 * and its lifecycle, driven through the service and the lead's tools with a
 * fake agent host (no agent). Workers build on the host
 * (docs/features/workers-build-in-the-feature-s-folder): the first in the
 * feature's own folder, one started beside it in its own folder and branch.
 * The git underneath is real: a handback's commits and a land are read from a
 * real repo.
 */

let ctx: AppCtx
let home: string
let restoreDataDir: () => void
let repo: string
let feature: Feature
let lead: string
let host: ReturnType<typeof fakeHost>

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
})

afterEach(() => {
  setAgentHostForTests(undefined)
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

async function startHeader(kind: 'with-you' | 'on-its-own' = 'with-you', label = 'Header'): Promise<string> {
  const { workerId } = await toolStartWorker(ctx, leadSession(), {
    label,
    purpose: 'The page header',
    kind,
    goal: 'Build the header',
    doneWhen: 'The human likes it',
  })
  return workerId
}

/** Commit `file` in a checkout, as an agent working there would. */
function commitIn(folder: string, file: string, body: string, subject: string): void {
  writeFileSync(join(folder, file), body)
  git(folder, 'add', file)
  git(folder, 'commit', '-q', '-m', subject)
}

/** The worker commits `header.txt` in its folder, hands back (its `hand_back` tool), and its turn ends. */
async function handBack(id: string, summary = 'Built the header; the human wants it blue.', body = 'header\n'): Promise<void> {
  commitIn(getWorker(ctx, id)!.folder!, 'header.txt', body, 'feat: header')
  writeHostHandback(id, summary)
  await workerTurnEnded(ctx, { id })
}

const featureTip = () => git(repo, 'rev-parse', 'feature/work').trim()
const branchExists = (branch: string) => git(repo, 'branch', '--list', branch) !== ''

describe('a worker, start to land', () => {
  it('starts working, stays working after a turn and a message, hands back once and lands', async () => {
    const id = await startHeader()
    const started = getWorker(ctx, id)!
    expect(started).toMatchObject({ status: 'working', kind: 'with-you', startedBy: 'lead', label: 'Header', folder: expect.any(String), branch: null })
    expect(getSessionRow(ctx, id)?.kind).toBe('worker')
    expect(host.sent.filter((s) => s.threadId === id).map((s) => s.text)).toEqual(['Start your assignment: Build the header\n\nDone when: The human likes it'])
    expect(workerEvents()).toEqual([{ type: 'worker.started', status: 'working' }])

    // A turn that ends without a handback needs nobody (needs-you decision 6).
    await workerTurnEnded(ctx, { id })
    expect(getWorker(ctx, id)?.status).toBe('working')
    expect(workerEvents()).toEqual([{ type: 'worker.started', status: 'working' }])

    await toolMessageWorker(ctx, leadSession(), { workerId: id, text: 'Make it taller' })
    expect(getWorker(ctx, id)?.status).toBe('working')
    expect(host.sent.at(-1)).toEqual({ threadId: id, text: 'Make it taller' })
    expect(workerEvents().at(-1)).toEqual({ type: 'worker.messaged', status: 'working' })

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
    expect(toLead()[0]?.text).toContain('nothing waits to land')

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
    const first = await startHeader('with-you', 'First')
    // Started while the first holds the feature's folder: its own folder and branch.
    const id = await startHeader()
    commitIn(getWorker(ctx, first)!.folder!, 'header.txt', 'the lead wrote this\n', 'feat: lead header')
    await handBack(id)
    const result = await toolLandWorker(ctx, leadSession(), { workerId: id })
    expect(result).toMatchObject({ ok: false, conflict: true, files: ['header.txt'] })
    expect(getWorker(ctx, id)?.status).toBe('handed-back')
    expect(workerEvents().at(-1)?.type).toBe('worker.land_failed')
    expect(branchExists(getWorker(ctx, id)!.branch!)).toBe(true)
  })

  it('sends an on-its-own worker back to merge the feature branch into its own when it conflicts', async () => {
    const first = await startHeader('with-you', 'First')
    const id = await startHeader('on-its-own')
    commitIn(getWorker(ctx, first)!.folder!, 'header.txt', 'the lead wrote this\n', 'feat: lead header')
    await handBack(id)
    expect(await toolLandWorker(ctx, leadSession(), { workerId: id })).toMatchObject({ ok: false, conflict: true, files: ['header.txt'] })
    expect(getWorker(ctx, id)).toMatchObject({ status: 'working', outcome: 'sent-back' })
    expect(host.sent.at(-1)?.threadId).toBe(id)
    expect(host.sent.at(-1)?.text).toContain('git merge feature/work')
    expect(host.sent.at(-1)?.text).not.toContain('git fetch origin')
  })

  it('works again when the human types to a worker that needs them', async () => {
    const id = await startHeader()
    await workerTurnEnded(ctx, { id })
    workerPrompted(ctx, id)
    expect(getWorker(ctx, id)?.status).toBe('working')
  })
})

describe("where a worker builds (workers-build-in-the-feature-s-folder)", () => {
  it("gives the first worker the feature's folder and one started while it works its own folder and branch", async () => {
    const first = await startHeader('with-you', 'First')
    const w1 = getWorker(ctx, first)!
    expect(w1.branch).toBeNull()
    expect(git(w1.folder!, 'rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe('feature/work')
    expect(getSessionRow(ctx, first)?.worktreePath).toBe(w1.folder)

    const second = await startHeader('on-its-own', 'Second')
    const w2 = getWorker(ctx, second)!
    expect(w2.folder).toBe(workerFolder(second))
    expect(w2.branch).toMatch(/^runcastle\/worker\//)
    expect(git(w2.folder!, 'rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe(w2.branch)
    expect(git(repo, 'rev-parse', w2.branch!).trim()).toBe(featureTip())
    expect(getSessionRow(ctx, second)?.worktreePath).toBe(w2.folder)
  })

  it("gives the feature's folder to a new worker once the one holding it has landed", async () => {
    const first = await startHeader('with-you', 'First')
    await handBack(first)
    await toolLandWorker(ctx, leadSession(), { workerId: first })
    const next = await startHeader('with-you', 'Next')
    expect(getWorker(ctx, next)).toMatchObject({ folder: getWorker(ctx, first)!.folder, branch: null })
  })

  it("lists in a feature-folder worker's handback the commits it made on the feature branch during its turn", async () => {
    const id = await startHeader()
    const folder = getWorker(ctx, id)!.folder!
    commitIn(folder, 'a.txt', 'a\n', 'feat: a')
    await workerTurnEnded(ctx, { id })
    commitIn(folder, 'b.txt', 'b\n', 'feat: b')
    writeHostHandback(id, 'Built a and b.')
    await workerTurnEnded(ctx, { id })
    const handed = getWorker(ctx, id)!
    expect(handed.status).toBe('handed-back')
    expect(handed.handbackCommits).toEqual([expect.stringMatching(/^[0-9a-f]{7} feat: a$/), expect.stringMatching(/^[0-9a-f]{7} feat: b$/)])
    expect(handed.handbackFiles).toEqual(['a.txt', 'b.txt'])
  })

  it("never counts the lead's commits between a feature-folder worker's turns as the worker's, even after a restart", async () => {
    const id = await startHeader()
    const folder = getWorker(ctx, id)!.folder!
    commitIn(folder, 'a.txt', 'a\n', 'feat: a')
    await workerTurnEnded(ctx, { id })
    // The lead commits in the folder between the worker's turns, then the server restarts.
    commitIn(folder, 'plan.md', 'plan\n', 'docs: the plan')
    forgetDriveTurnBasesForTests()
    await messageWorker(ctx, id, 'Now b.')
    commitIn(folder, 'b.txt', 'b\n', 'feat: b')
    writeHostHandback(id, 'Built a and b.')
    await workerTurnEnded(ctx, { id })
    expect(getWorker(ctx, id)!.handbackCommits).toEqual([
      expect.stringMatching(/^[0-9a-f]{7} feat: a$/),
      expect.stringMatching(/^[0-9a-f]{7} feat: b$/),
    ])
  })

  it('lands an own-folder worker: its commit is merged into the feature branch, its folder and branch go', async () => {
    await startHeader('with-you', 'First')
    const id = await startHeader('on-its-own')
    await handBack(id)
    const { folder, branch } = getWorker(ctx, id)!
    expect(getWorker(ctx, id)!.handbackCommits).toEqual([expect.stringMatching(/^[0-9a-f]{7} feat: header$/)])
    expect(toLead().at(-1)?.text).toContain(folder!)
    expect(await toolLandWorker(ctx, leadSession(), { workerId: id })).toEqual({ ok: true, commits: 1, files: 1 })
    expect(getWorker(ctx, id)).toMatchObject({ status: 'landed', outcome: 'landed' })
    expect(git(repo, 'log', '--format=%s', 'feature/work')).toContain('feat: header')
    expect(git(repo, 'show', 'feature/work:header.txt')).toBe('header\n')
    expect(existsSync(folder!)).toBe(false)
    expect(branchExists(branch!)).toBe(false)
  })

  it("places two workers started at once one at a time: one in the feature's folder, one in its own, on different ports", async () => {
    const [a, b] = await Promise.all([startHeader('with-you', 'A'), startHeader('on-its-own', 'B')])
    const rows = [getWorker(ctx, a)!, getWorker(ctx, b)!]
    expect(rows.filter((w) => w.branch === null)).toHaveLength(1)
    expect(rows.filter((w) => w.branch?.startsWith('runcastle/worker/'))).toHaveLength(1)
    expect(rows[0]!.previewPort).not.toBe(rows[1]!.previewPort)
  })

  it("never lets a review hold the feature's folder, so a worker started after one hands back gets it", async () => {
    const review = await startWorker(ctx, feature, {
      label: 'Review',
      purpose: 'Reads the feature for review',
      kind: 'review',
      startedBy: 'lead',
      review: { verify: null, assignment: 'Review the feature.' },
    })
    writeHostHandback(review.workerId, 'No findings.')
    await workerTurnEnded(ctx, { id: review.workerId })
    const next = await startHeader('with-you', 'Next')
    expect(getWorker(ctx, next)).toMatchObject({ branch: null, folder: getWorker(ctx, review.workerId)!.folder })
  })

  it("refuses to land an own-folder worker while the one in the feature's folder is mid-turn there", async () => {
    const holder = await startHeader('with-you', 'Holder')
    const id = await startHeader('on-its-own')
    await handBack(id)
    setAgentHostForTests({ ...host.host, isRunning: (threadId: string) => threadId === holder })
    await expect(toolLandWorker(ctx, leadSession(), { workerId: id })).rejects.toThrow(/mid-turn/)
    expect(getWorker(ctx, id)!.status).toBe('handed-back')
    setAgentHostForTests(host.host)
    expect(await toolLandWorker(ctx, leadSession(), { workerId: id })).toEqual({ ok: true, commits: 1, files: 1 })
  })

  it('lands a feature-folder worker by settling it: nothing merges, it is marked landed', async () => {
    const id = await startHeader()
    await handBack(id)
    const tip = featureTip()
    const folder = getWorker(ctx, id)!.folder!
    expect(await toolLandWorker(ctx, leadSession(), { workerId: id })).toEqual({ ok: true, commits: 1, files: 1 })
    expect(getWorker(ctx, id)).toMatchObject({ status: 'landed', outcome: 'landed' })
    expect(featureTip()).toBe(tip)
    expect(existsSync(folder)).toBe(true)
    expect(host.stopped).toEqual([id])
    expect(workerEvents().at(-1)).toEqual({ type: 'worker.landed', status: 'landed' })
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

  it("drops a worker in the feature's folder: its process stops, its commits stay on the branch", async () => {
    const id = await startHeader()
    await handBack(id)
    const tip = featureTip()
    await toolDropWorker(ctx, leadSession(), { workerId: id })
    expect(getWorker(ctx, id)).toMatchObject({ status: 'dropped', outcome: 'dropped' })
    expect(host.stopped).toEqual([id])
    expect(featureTip()).toBe(tip)
    expect(git(repo, 'log', '--format=%s', 'feature/work')).toContain('feat: header')
    expect(existsSync(getWorker(ctx, id)!.folder!)).toBe(true)
    expect(workerEvents().at(-1)).toEqual({ type: 'worker.dropped', status: 'dropped' })
  })

  it('drops a worker in its own folder: its process stops, its folder and branch go, nothing lands', async () => {
    await startHeader('with-you', 'First')
    const id = await startHeader()
    await handBack(id)
    const { folder, branch } = getWorker(ctx, id)!
    const tip = featureTip()
    await toolDropWorker(ctx, leadSession(), { workerId: id })
    expect(getWorker(ctx, id)).toMatchObject({ status: 'dropped', outcome: 'dropped' })
    expect(host.stopped).toEqual([id])
    expect(existsSync(folder!)).toBe(false)
    expect(branchExists(branch!)).toBe(false)
    expect(featureTip()).toBe(tip)
    expect(workerEvents().at(-1)).toEqual({ type: 'worker.dropped', status: 'dropped' })
  })
})

describe("the lead's workers card", () => {
  const startedIn = (threadId: string) => readThreadEvents(threadId).filter((e) => e.type === 'worker_started')

  it("appends a worker_started event to the lead's chat when the lead starts a worker, and announces the start", async () => {
    const id = await startHeader()
    expect(startedIn(lead)).toEqual([
      expect.objectContaining({ type: 'worker_started', workerId: id, label: 'Header', purpose: 'The page header', kind: 'with-you' }),
    ])
    expect(workerEvents()).toContainEqual({ type: 'worker.started', status: 'working' })
  })

  it('falls back to the first line of the goal when the purpose is empty', async () => {
    await toolStartWorker(ctx, leadSession(), { label: 'Tab', purpose: '  ', kind: 'on-its-own', goal: 'Show the tweaks\n\nRead first: x', doneWhen: 'd' })
    expect(startedIn(lead)[0]).toMatchObject({ purpose: 'Show the tweaks' })
  })

  it('adds no row when a worker is sent back, nor for a worker the human starts', async () => {
    const id = await startHeader()
    await handBack(id)
    await toolSendBackWorker(ctx, leadSession(), { workerId: id, note: 'again' })
    await createCallerFactory(appRouter)(ctx).worker.startUnassigned({ featureId: feature.id })
    expect(startedIn(lead).map((e) => e.type === 'worker_started' && e.workerId)).toEqual([id])
  })
})

describe('starting a worker', () => {
  it('runs an ordinary worker with no model on the chat step, never the review step', async () => {
    ctx.config.stepModels = { ...ctx.config.stepModels, chat: 'claude-sonnet-5', review: 'claude-haiku-4-5' }
    const id = await startHeader()
    expect(getWorker(ctx, id)?.model).toBe('claude-sonnet-5')
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
    for (const kind of ['side', 'fix-drive-worker', 'scenario-worker', 'project', 'review', 'worker'] as const) {
      expect(toolsForAudience(kind).filter((t) => LEAD_WORKER_TOOLS.includes(t))).toEqual([])
    }
    // A build worker on the host asks its own few tools here, none of the lead's.
    expect(toolsForAudience('worker')).toEqual(['create_feature', 'get_feature_context', 'hand_back', 'read_feature_doc', 'show_file', 'wait_for_you'])
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
        folder: getWorker(ctx, id)!.folder,
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
