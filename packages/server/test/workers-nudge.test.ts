import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type Feature, type WorkerKind, shownWorkerStatus } from '@runcastle/core'
import type { AppCtx } from '../src/db/types'
import { createSessionRow, getSessionRow, markSessionEnded, markSessionLive, setLimitHold } from '../src/launcher/sessions'
import { featureStatusView, toolMessageWorker, toolStartWorker } from '../src/mcp/server'
import { resetAgentSlotsForTests } from '../src/services/agent-slots'
import { listAfter } from '../src/services/events'
import { handbackStateLine } from '../src/services/lead-handback'
import { setAgentHostForTests } from '../src/threads/host'
import { appendThreadEvent } from '../src/threads/types'
import { setSandboxEngineForTests } from '../src/workers/engine'
import {
  RESUMED_DISPLAY,
  RESUMED_HUMAN_DISPLAY,
  getWorker,
  leadWorkers,
  resumeCaughtWorkers,
  updateWorker,
  workerNudgeText,
  workerPrompted,
  workerTurnEnded,
  workerTypedTo,
} from '../src/workers/service'
import { useDataDir } from './helpers/data-dir'
import { makeTestCtx } from './helpers/db'
import { rmTemp, seedFeature, seedProject, tmpRepo } from './helpers/fixtures'
import { fakeEngine, fakeHost, initRepo, type FakeEngine } from './support/fake-workers'

/**
 * A worker never shows working with nothing running
 * (docs/features/a-worker-never-shows-working-with-nothing-running): an
 * assigned worker whose turn ends with no handback is nudged once, then
 * stalls and its lead is told; a restart that caught a worker's message
 * before its turn began sends it again. The thread log is written by hand
 * here, as the agent host would have, so each case reads exactly the turn it
 * means.
 */

let ctx: AppCtx
let home: string
let restoreDataDir: () => void
let repo: string
let feature: Feature
let lead: string
let engine: FakeEngine
let host: ReturnType<typeof fakeHost>

beforeEach(async () => {
  home = tmpRepo()
  restoreDataDir = useDataDir(home)
  ctx = await makeTestCtx()
  repo = initRepo('work')
  feature = seedFeature(ctx, seedProject(ctx, repo).id, { slug: 'work' })
  lead = createSessionRow(ctx, { featureId: feature.id, kind: 'chat', worktreePath: '/wt' }).id
  markSessionLive(ctx, lead, { ccSessionId: `cc-${lead}` })
  markSessionEnded(ctx, lead)
  engine = fakeEngine()
  setSandboxEngineForTests(engine)
  resetAgentSlotsForTests()
  vi.stubEnv('CLAUDE_CODE_OAUTH_TOKEN', 'test-token')
  host = fakeHost()
  setAgentHostForTests(host.host)
})

afterEach(() => {
  setAgentHostForTests(undefined)
  setSandboxEngineForTests(undefined)
  vi.unstubAllEnvs()
  restoreDataDir()
  rmTemp(home)
  rmTemp(repo)
})

const leadSession = () => getSessionRow(ctx, lead)!
const status = (id: string) => getWorker(ctx, id)?.status
const eventsOf = (type: string) => listAfter(ctx, feature.id, 0).filter((e) => e.type === type)
const nudges = (id: string) => host.sent.filter((s) => s.threadId === id && s.text.startsWith('[runcastle] Your turn ended without a handback'))
const toLead = () => host.sent.filter((s) => s.threadId === lead)

async function start(kind: Exclude<WorkerKind, 'unassigned' | 'review' | 'fix-drive' | 'scenario'> = 'on-its-own'): Promise<string> {
  const { workerId } = await toolStartWorker(ctx, leadSession(), {
    label: 'Header',
    purpose: 'The header',
    kind,
    goal: 'Build the header',
    doneWhen: 'It renders',
  })
  return workerId
}

/** One whole turn in the worker's log: the prompt that opened it, then its start and end. */
function turn(id: string, text: string, source: 'human' | 'runcastle', reason: 'end_turn' | 'cancelled' = 'end_turn'): void {
  appendThreadEvent(id, { type: 'prompt', id: `p-${Math.random()}`, text, source })
  appendThreadEvent(id, { type: 'turn_started' })
  appendThreadEvent(id, { type: 'turn_ended', reason })
}

/** The turn the nudge just sent opens, as the host would log it. */
function nudgedTurn(id: string): void {
  turn(id, workerNudgeText(getWorker(ctx, id)!.kind), 'runcastle')
}

describe('a turn that ends with no handback', () => {
  it('nudges an "on its own" worker once, then stalls it and wakes its lead with a card', async () => {
    const a = await start()
    turn(a, 'Build the header', 'runcastle')
    await workerTurnEnded(ctx, { id: a }, { reason: 'end_turn' })
    expect(nudges(a)).toHaveLength(1)
    expect(nudges(a)[0]!.display).toEqual({ summary: expect.stringContaining('nudged') })
    expect(status(a)).toBe('working')
    expect(eventsOf('worker.nudged')).toHaveLength(1)
    expect(toLead()).toHaveLength(0)

    nudgedTurn(a)
    await workerTurnEnded(ctx, { id: a }, { reason: 'end_turn' })
    expect(nudges(a)).toHaveLength(1)
    expect(status(a)).toBe('stalled')
    expect(eventsOf('worker.stalled')).toHaveLength(1)
    expect(toLead()).toHaveLength(1)
    expect(toLead()[0]!.display).toEqual({ workerStalled: { workerId: a, label: 'Header' } })
    expect(toLead()[0]!.text).toContain(`message_worker({ workerId: "${a}"`)
    expect(toLead()[0]!.text).toContain('drop_worker')

    // A stalled worker's further quiet turns say nothing more.
    await workerTurnEnded(ctx, { id: a }, { reason: 'end_turn' })
    expect(nudges(a)).toHaveLength(1)
    expect(toLead()).toHaveLength(1)
  })

  it('nudges a Review worker with its own words, then stalls it', async () => {
    const a = await start()
    updateWorker(ctx, a, { kind: 'review' })
    turn(a, 'Review the feature', 'runcastle')
    await workerTurnEnded(ctx, { id: a }, { reason: 'end_turn' })
    expect(nudges(a)).toHaveLength(1)
    expect(nudges(a)[0]!.text).toContain('Review Package')
    nudgedTurn(a)
    await workerTurnEnded(ctx, { id: a }, { reason: 'end_turn' })
    expect(status(a)).toBe('stalled')
  })

  it.each(['with-you', 'unassigned', 'fix-drive', 'scenario'] as const)('never nudges a %s worker: it reads idle', async (kind) => {
    const a = await start()
    updateWorker(ctx, a, { kind })
    turn(a, 'Build the header', 'runcastle')
    await workerTurnEnded(ctx, { id: a }, { reason: 'end_turn' })
    expect(nudges(a)).toHaveLength(0)
    expect(status(a)).toBe('working')
    expect(shownWorkerStatus({ status: status(a)!, turnRunning: false })).toBe('idle')
  })

  it('does not nudge a worker whose turn the human started or joined', async () => {
    const a = await start()
    turn(a, 'Make it blue', 'human')
    await workerTurnEnded(ctx, { id: a }, { reason: 'end_turn' })
    expect(nudges(a)).toHaveLength(0)

    // A human message steered into a turn runcastle opened counts too.
    appendThreadEvent(a, { type: 'prompt', id: 'p-r', text: 'Carry on', source: 'runcastle' })
    appendThreadEvent(a, { type: 'turn_started' })
    appendThreadEvent(a, { type: 'prompt', id: 'p-h', text: 'and green', source: 'human', steered: true })
    appendThreadEvent(a, { type: 'turn_ended', reason: 'end_turn' })
    await workerTurnEnded(ctx, { id: a }, { reason: 'end_turn' })
    expect(nudges(a)).toHaveLength(0)
    expect(status(a)).toBe('working')
  })

  it('does not nudge a worker that answered the human on a runtime that cannot steer: their message was logged before the last turn ended', async () => {
    const a = await start()
    appendThreadEvent(a, { type: 'prompt', id: 'p-r', text: 'Build the header', source: 'runcastle' })
    appendThreadEvent(a, { type: 'turn_started' })
    appendThreadEvent(a, { type: 'prompt', id: 'p-h', text: 'Make it blue', source: 'human' })
    appendThreadEvent(a, { type: 'turn_ended', reason: 'end_turn' })
    await workerTurnEnded(ctx, { id: a }, { reason: 'end_turn', queued: true })
    appendThreadEvent(a, { type: 'turn_started' })
    appendThreadEvent(a, { type: 'turn_ended', reason: 'end_turn' })
    await workerTurnEnded(ctx, { id: a }, { reason: 'end_turn' })
    expect(nudges(a)).toHaveLength(0)
  })

  it('does not nudge a stopped turn, a failed one, one the usage limit holds, one with background work or a queued message', async () => {
    const a = await start()
    turn(a, 'Build the header', 'runcastle', 'cancelled')
    await workerTurnEnded(ctx, { id: a }, { reason: 'cancelled' })
    await workerTurnEnded(ctx, { id: a }, { reason: 'end_turn', usageLimit: true })
    await workerTurnEnded(ctx, { id: a }, { reason: 'end_turn', background: true })
    await workerTurnEnded(ctx, { id: a }, { reason: 'end_turn', queued: true })
    setLimitHold(ctx, a, Date.now() + 60_000, false)
    await workerTurnEnded(ctx, { id: a }, { reason: 'end_turn' })
    expect(nudges(a)).toHaveLength(0)
    expect(status(a)).toBe('working')
  })

  it('does not nudge a worker waiting on the human', async () => {
    const a = await start()
    updateWorker(ctx, a, { status: 'needs-you' })
    turn(a, 'Build the header', 'runcastle')
    await workerTurnEnded(ctx, { id: a }, { reason: 'end_turn' })
    expect(nudges(a)).toHaveLength(0)
  })

  it('does not nudge after a compaction turn', async () => {
    const a = await start()
    appendThreadEvent(a, { type: 'prompt', id: 'p-c', text: '/compact', source: 'runcastle', hidden: true, compaction: 'idle' })
    appendThreadEvent(a, { type: 'turn_started' })
    appendThreadEvent(a, { type: 'turn_ended', reason: 'end_turn' })
    await workerTurnEnded(ctx, { id: a }, { reason: 'end_turn' })
    expect(nudges(a)).toHaveLength(0)
  })

  it('stalls even when a restart came between the nudge and its turn’s end: the log, not memory, knows the nudge', async () => {
    const a = await start()
    // Nothing in memory saw a nudge: only the log says the turn was the nudge's.
    nudgedTurn(a)
    await workerTurnEnded(ctx, { id: a }, { reason: 'end_turn' })
    expect(status(a)).toBe('stalled')
    expect(nudges(a)).toHaveLength(0)
  })
})

describe('a stalled worker', () => {
  async function stalled(): Promise<string> {
    const a = await start()
    nudgedTurn(a)
    await workerTurnEnded(ctx, { id: a }, { reason: 'end_turn' })
    expect(status(a)).toBe('stalled')
    return a
  }

  it('works again on the lead’s message, and its next quiet turn is nudged afresh', async () => {
    const a = await stalled()
    await toolMessageWorker(ctx, leadSession(), { workerId: a, text: 'Finish the header, then hand back' })
    expect(status(a)).toBe('working')
    turn(a, 'Finish the header, then hand back', 'runcastle')
    await workerTurnEnded(ctx, { id: a }, { reason: 'end_turn' })
    expect(nudges(a)).toHaveLength(1)
  })

  it('works again when the human writes to it, but not when they press Stop', async () => {
    const a = await stalled()
    workerPrompted(ctx, a)
    expect(status(a)).toBe('stalled')
    workerTypedTo(ctx, a)
    expect(status(a)).toBe('working')
  })

  it('reads Stalled to its lead, not working, and counts as held work', async () => {
    const a = await stalled()
    expect(leadWorkers(ctx, feature.id).find((w) => w.id === a)?.status).toBe('stalled')
    expect(featureStatusView(ctx, { featureId: feature.id }).workerCounts).toEqual({ stalled: 1 })
    expect(handbackStateLine(null, ['stalled'])).toBe('Not declared ready · no workers at work · 1 stalled')
  })
})

describe('what the lead reads', () => {
  it('a worker stored as working with no turn running reads idle, never working', async () => {
    const a = await start()
    expect(status(a)).toBe('working')
    expect(leadWorkers(ctx, feature.id).find((w) => w.id === a)?.status).toBe('idle')
    expect(featureStatusView(ctx, { featureId: feature.id }).workerCounts).toEqual({ idle: 1 })
  })
})

describe('a restart that caught a worker before its turn began', () => {
  it('sends its waiting message again, once, shown as a short note', async () => {
    const a = await start()
    updateWorker(ctx, a, { status: 'queued' })
    appendThreadEvent(a, { type: 'prompt', id: 'p-k', text: 'Build the header', source: 'runcastle' })
    expect(await resumeCaughtWorkers(ctx)).toBe(1)
    const resent = host.sent.filter((s) => s.threadId === a && s.display && 'summary' in s.display && s.display.summary === RESUMED_DISPLAY)
    expect(resent).toHaveLength(1)
    expect(resent[0]!.text).toBe('Build the header')
    expect(eventsOf('worker.resumed')).toHaveLength(1)
  })

  it('joins every message since its last turn, and leaves out held, steered and hidden ones', async () => {
    const a = await start()
    turn(a, 'Build the header', 'runcastle')
    appendThreadEvent(a, { type: 'prompt', id: 'p-1', text: 'Make it blue', source: 'human' })
    appendThreadEvent(a, { type: 'prompt', id: 'p-2', text: 'a note', source: 'runcastle', held: true })
    appendThreadEvent(a, { type: 'prompt', id: 'p-3', text: '/compact', source: 'runcastle', hidden: true })
    appendThreadEvent(a, { type: 'prompt', id: 'p-4', text: 'and wide', source: 'human' })
    await resumeCaughtWorkers(ctx)
    expect(host.sent.at(-1)).toMatchObject({ threadId: a, text: 'Make it blue\n\nand wide', display: { summary: RESUMED_HUMAN_DISPLAY } })
  })

  it('after a second restart, sends the earlier resend and what came after it, not its messages twice', async () => {
    const a = await start()
    turn(a, 'Build the header', 'runcastle')
    appendThreadEvent(a, { type: 'prompt', id: 'p-1', text: 'Make it blue', source: 'human' })
    appendThreadEvent(a, { type: 'prompt', id: 'p-r', text: 'Make it blue', source: 'runcastle', display: { summary: RESUMED_HUMAN_DISPLAY } })
    appendThreadEvent(a, { type: 'prompt', id: 'p-2', text: 'a note', source: 'runcastle' })
    await resumeCaughtWorkers(ctx)
    expect(host.sent.at(-1)).toMatchObject({ threadId: a, text: 'Make it blue\n\na note', display: { summary: RESUMED_HUMAN_DISPLAY } })
  })

  it('does not nudge a worker whose resent turn carried the human’s message', async () => {
    const a = await start()
    turn(a, 'Build the header', 'runcastle')
    appendThreadEvent(a, { type: 'prompt', id: 'p-r', text: 'Make it blue', source: 'runcastle', display: { summary: RESUMED_HUMAN_DISPLAY } })
    appendThreadEvent(a, { type: 'turn_started' })
    appendThreadEvent(a, { type: 'turn_ended', reason: 'end_turn' })
    await workerTurnEnded(ctx, { id: a }, { reason: 'end_turn' })
    expect(nudges(a)).toHaveLength(0)
  })

  it('leaves alone a worker the carry-on wake told, one whose last turn began, a stalled, a drive and a limit-held one', async () => {
    const told = await start()
    appendThreadEvent(told, { type: 'prompt', id: 'p-t', text: 'Build it', source: 'runcastle' })
    const ran = await start()
    turn(ran, 'Build it', 'runcastle')
    const stalledOne = await start()
    updateWorker(ctx, stalledOne, { status: 'stalled' })
    appendThreadEvent(stalledOne, { type: 'prompt', id: 'p-s', text: 'Build it', source: 'runcastle' })
    const drive = await start()
    updateWorker(ctx, drive, { kind: 'fix-drive' })
    appendThreadEvent(drive, { type: 'prompt', id: 'p-d', text: 'Fix it', source: 'runcastle' })
    const held = await start()
    setLimitHold(ctx, held, Date.now() + 60_000, false)
    appendThreadEvent(held, { type: 'prompt', id: 'p-l', text: 'Build it', source: 'runcastle' })
    const before = host.sent.length
    expect(await resumeCaughtWorkers(ctx, new Set([told]))).toBe(0)
    expect(host.sent.length).toBe(before)
  })
})
