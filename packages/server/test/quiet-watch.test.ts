import type { ThreadEvent } from '@runcastle/core'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { features, readyDeclarations, workers } from '../src/db/schema'
import type { AppCtx } from '../src/db/types'
import { createSessionRow, setLimitHold } from '../src/launcher/sessions'
import { listByProject } from '../src/services/events'
import { startQuietWatch, type QuietWatch } from '../src/services/quiet-watch'
import { clearWait, SESSION_WAIT_CLEARED, SESSION_WAITING, setWait, waitOf } from '../src/services/waits'
import { setAgentHostForTests } from '../src/threads/host'
import { seedThreadLog } from '../src/threads/log'
import type { AgentHost } from '../src/threads/types'
import { withTempDataDir } from './helpers/data-dir'
import { makeTestCtx } from './helpers/db'
import { seedFeature, seedProject } from './helpers/fixtures'

/**
 * Runcastle says when nothing is running: one "needs you" from runcastle on the
 * project's orchestrator chat, after a quiet spell, once per stop.
 */

const QUIET = 1_000
const RESUME = 500

let ctx: AppCtx
let projectId: string
let restoreDataDir: () => void
let watch: QuietWatch | undefined
let clock: number
const running = new Set<string>()

beforeEach(async () => {
  restoreDataDir = withTempDataDir()
  ctx = await makeTestCtx()
  projectId = seedProject(ctx).id
  running.clear()
  setAgentHostForTests({ isRunning: (id: string) => running.has(id) } as unknown as AgentHost)
  clock = 1_000_000
})

afterEach(() => {
  watch?.stop()
  watch = undefined
  setAgentHostForTests(undefined)
  restoreDataDir()
})

const start = () => {
  watch = startQuietWatch(ctx, { now: () => clock, quietMs: QUIET, resumeMs: RESUME, tickMs: 3_600_000 })
  return watch
}
/** Move the clock and look at the project. */
const after = (ms: number) => {
  clock += ms
  watch!.check(projectId)
}
const raised = () => listByProject(ctx, projectId).filter((e) => e.type === SESSION_WAITING && (e.data as { by?: string }).by === 'runcastle')
const cleared = () => listByProject(ctx, projectId).filter((e) => e.type === SESSION_WAIT_CLEARED)

let n = 0
/** A conversation whose turns are `prompts`, each one finished. */
function log(id: string, prompts: ('human' | 'runcastle')[], opts: { midTurn?: boolean } = {}): void {
  const bodies: Record<string, unknown>[] = []
  for (const source of prompts) {
    bodies.push({ type: 'prompt', id: `p${n++}`, text: 'go', source }, { type: 'turn_started' }, { type: 'turn_ended', reason: 'end_turn' })
  }
  if (opts.midTurn) bodies.push({ type: 'prompt', id: `p${n++}`, text: 'go', source: 'runcastle' }, { type: 'turn_started' })
  seedThreadLog(id, bodies.map((b, i) => ({ ...b, i, at: Date.now() })) as ThreadEvent[])
}
const epicChat = () => createSessionRow(ctx, { projectId, kind: 'project', worktreePath: '/wt' }).id
/** A started feature held by `epic`, whose lead's last turn came from runcastle. */
function stoppedFeature(title: string, epic: string | null, slug = title.toLowerCase()) {
  const feature = seedFeature(ctx, projectId, { title, slug, chatId: epic })
  const lead = createSessionRow(ctx, { featureId: feature.id, kind: 'chat', worktreePath: '/wt' }).id
  log(lead, ['human', 'runcastle'])
  return { feature, lead }
}
/** Put a turn on `id`: its process is up and its log is mid-turn. */
function runTurn(id: string, prompts: ('human' | 'runcastle')[] = ['runcastle']) {
  running.add(id)
  log(id, prompts, { midTurn: true })
}
function endTurn(id: string, prompts: ('human' | 'runcastle')[] = ['runcastle']) {
  running.delete(id)
  log(id, prompts)
}

describe('the quiet watcher', () => {
  it('raises one needs you on the epic holding the stopped feature, after the quiet spell', () => {
    const epic = epicChat()
    stoppedFeature('Search', epic)
    start()
    after(QUIET - 1)
    expect(waitOf(ctx, epic)).toBeNull()
    after(1)
    expect(waitOf(ctx, epic)).toMatchObject({
      by: 'runcastle',
      why: 'Nothing is running: 1 feature stopped. Search: stopped after its last turn.',
    })
    after(QUIET * 5)
    expect(raised()).toHaveLength(1)
  })

  it('names every stopped feature and why', () => {
    const epic = epicChat()
    const search = stoppedFeature('Search', epic)
    const header = stoppedFeature('Header', epic)
    const merge = stoppedFeature('Merge me', epic)
    setLimitHold(ctx, search.lead, new Date(2026, 10, 21, 14, 5).getTime(), true)
    const now = Date.now()
    ctx.db
      .insert(workers)
      .values({ id: 'w1', featureId: header.feature.id, projectId, label: 'W', purpose: 'p', kind: 'on-its-own', model: 'm', runtime: 'claude-code', startedBy: 'lead', status: 'working', engine: 'docker', featureBranch: 'b', createdAt: now, updatedAt: now })
      .run()
    ctx.db.insert(readyDeclarations).values({ id: 'r1', featureId: merge.feature.id, runId: null, scenario: 's', createdAt: now }).run()
    start()
    after(QUIET)
    expect(waitOf(ctx, epic)?.why).toBe(
      'Nothing is running: 3 features stopped. Search: held for the usage limit until 14:05. Header: a worker stopped mid-assignment. Merge me: ready and waiting on a merge.',
    )
  })

  it('counts the server start as the start of quiet', () => {
    const epic = epicChat()
    stoppedFeature('Search', epic)
    start()
    after(QUIET / 2)
    expect(waitOf(ctx, epic)).toBeNull()
  })

  it('raises nothing while anything is running, and counts quiet from when it stopped', () => {
    const epic = epicChat()
    const { lead } = stoppedFeature('Search', epic)
    runTurn(lead)
    start()
    after(QUIET * 3)
    expect(waitOf(ctx, epic)).toBeNull()
    endTurn(lead)
    after(0)
    after(QUIET - 1)
    expect(waitOf(ctx, epic)).toBeNull()
    after(1)
    expect(waitOf(ctx, epic)?.by).toBe('runcastle')
  })

  it('reads the epic’s own turn as running', () => {
    const epic = epicChat()
    stoppedFeature('Search', epic)
    runTurn(epic)
    start()
    after(QUIET * 2)
    expect(raised()).toHaveLength(0)
  })

  it('clears its alert when work runs again, then raises a new one for the next stop', () => {
    const epic = epicChat()
    const { lead } = stoppedFeature('Search', epic)
    start()
    after(QUIET)
    expect(raised()).toHaveLength(1)
    runTurn(lead)
    after(RESUME)
    after(RESUME)
    expect(waitOf(ctx, epic)).toBeNull()
    expect(cleared().map((e) => (e.data as { cause: string }).cause)).toEqual(['resumed'])
    endTurn(lead, ['human', 'runcastle'])
    after(0)
    after(QUIET)
    expect(raised()).toHaveLength(2)
  })

  it('keeps one alert through a usage-limit retry that is held again', () => {
    const epic = epicChat()
    const { lead } = stoppedFeature('Search', epic)
    setLimitHold(ctx, lead, Date.now() + 3_600_000, true)
    start()
    after(QUIET)
    expect(raised()).toHaveLength(1)
    runTurn(lead)
    after(RESUME / 5)
    endTurn(lead)
    after(RESUME / 5)
    after(QUIET * 2)
    expect(raised()).toHaveLength(1)
    expect(cleared()).toHaveLength(0)
    expect(waitOf(ctx, epic)?.by).toBe('runcastle')
  })

  it('raises nothing while anything is in Needs you', () => {
    const epic = epicChat()
    const { lead } = stoppedFeature('Search', epic)
    setWait(ctx, lead, 'Which model?')
    start()
    after(QUIET * 2)
    expect(raised()).toHaveLength(0)
  })

  it('raises nothing for a feature that is the human’s move', () => {
    const epic = epicChat()
    const answered = seedFeature(ctx, projectId, { title: 'Answered', slug: 'answered', chatId: epic })
    log(createSessionRow(ctx, { featureId: answered.id, kind: 'chat', worktreePath: '/wt' }).id, ['runcastle', 'human'])
    const { feature: stopped } = stoppedFeature('Stopped', epic)
    ctx.db.update(features).set({ stoppedAt: Date.now() }).where(eq(features.id, stopped.id)).run()
    start()
    after(QUIET * 2)
    expect(raised()).toHaveLength(0)
  })

  it('ignores drafts', () => {
    const epic = epicChat()
    seedFeature(ctx, projectId, { title: 'Draft', slug: 'draft', status: 'draft', chatId: epic })
    start()
    after(QUIET * 2)
    expect(raised()).toHaveLength(0)
  })

  it('goes on the newest orchestrator chat when no epic holds the features, else the lead’s chat', () => {
    const { lead } = stoppedFeature('Search', null)
    start()
    after(QUIET)
    expect(waitOf(ctx, lead)?.by).toBe('runcastle')

    watch!.stop()
    clearWait(ctx, lead, 'human')
    epicChat()
    const newest = epicChat()
    start()
    after(QUIET)
    expect(waitOf(ctx, newest)?.by).toBe('runcastle')
  })

  it('raises no second alert in the same stop once the human cleared it', () => {
    const epic = epicChat()
    stoppedFeature('Search', epic)
    start()
    after(QUIET)
    clearWait(ctx, epic, 'human')
    after(QUIET * 3)
    expect(raised()).toHaveLength(1)
  })

  it('leaves a wait it did not set alone', () => {
    const epic = epicChat()
    const { lead } = stoppedFeature('Search', epic)
    start()
    after(QUIET)
    setWait(ctx, epic, 'Start the batch?')
    runTurn(lead)
    after(RESUME)
    after(RESUME)
    expect(waitOf(ctx, epic)?.why).toBe('Start the batch?')
  })
})
