import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { EventRow, Feature, Project } from '@runcastle/core'
import { simpleGit } from 'simple-git'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sessions } from '../src/db/schema'
import type { AppCtx } from '../src/db/types'
import { createSessionRow, markSessionEnded, markSessionLive } from '../src/launcher/sessions'
import { emit, emitProject, runAsActor } from '../src/services/events'
import {
  announceMerge,
  type MergeNews,
  ORCHESTRATOR_GATHER_MS,
  orchestratorLineFor,
  orchestratorNewsFor,
  orchestratorTargetFor,
  startOrchestratorNotifier,
  type NotifyState,
} from '../src/services/orchestrator-notify'
import { openProject } from '../src/services/projects'
import { createAgentHost, setAgentHostForTests } from '../src/threads/host'
import type { AgentHost } from '../src/threads/types'
import { createFakeAcp, FAKE_LAUNCH, type FakeAcp } from './support/fake-acp-agent'
import { promptsOf } from './support/thread-launch'
import { withTempDataDir } from './helpers/data-dir'
import { makeTestCtx } from './helpers/db'
import { rmTemp, seedFeature, tmpRepo } from './helpers/fixtures'

/**
 * What an epic hears from runcastle (`autopilot-retires` decisions 2, 9): every
 * merge of its features, and a dependent that could not start or whose lead
 * could not launch, each waking it. The lead's own trouble comes by
 * `hand_back`; nothing else reaches it.
 */

function event(type: string, data?: Record<string, unknown>, extra: Partial<EventRow> = {}): EventRow {
  return {
    id: 1,
    projectId: 'proj',
    featureId: 'feat',
    ts: 0,
    type,
    message: extra.message ?? type,
    ...(data ? { data } : {}),
    ...extra,
  }
}

const held: NotifyState = { feature: { slug: 'export-csv', title: 'Export CSV', holderId: 'thread' } }
const unheld: NotifyState = { feature: { slug: 'export-csv', title: 'Export CSV', holderId: null } }
const byOrchestrator = { actor: 'orchestrator' }

describe('orchestratorLineFor — trouble that crosses features', () => {
  const cases: [string, EventRow, string][] = [
    [
      'a dependent not starting',
      event('feature.autostart.failed', undefined, { message: "couldn't start by itself: boom" }),
      `[runcastle] export-csv couldn't start by itself: boom. Read it with get_feature_context({ slug: "export-csv" }).`,
    ],
    [
      'a dependent skipped for its bases',
      event('feature.autostart.skipped', undefined, { message: "didn't start by itself: its dependencies merged into different branches" }),
      `[runcastle] export-csv didn't start by itself: its dependencies merged into different branches. Read it with get_feature_context({ slug: "export-csv" }).`,
    ],
    [
      'a dependent whose lead could not launch',
      event('feature.autostart.failed', { launch: true }, { message: 'started by itself, but its lead could not launch: no runtime' }),
      '[runcastle] export-csv started by itself, but its lead could not launch: no runtime. Read it with get_feature_context({ slug: "export-csv" }).',
    ],
  ]

  it.each(cases)('%s', (_name, e, line) => {
    expect(orchestratorLineFor(e, held)).toBe(line)
  })

  it.each(cases)('%s says nothing for a feature with no epic', (_name, e) => {
    expect(orchestratorLineFor(e, unheld)).toBeNull()
  })
})

describe('orchestratorLineFor — what never reaches it (decision 9)', () => {
  const gone: [string, EventRow][] = [
    ['a lead waiting for the human', event('feature.waiting', { why: 'start round 1?' })],
    ['a lead declaring ready', event('feature.ready_declared', { scenario: 'x' })],
    ['a planning run ending', event('session.self_plan_ended', { complete: true })],
    ['a round finishing', event('run.finished', { status: 'succeeded' })],
    ['a round failing', event('run.finished', { status: 'failed' })],
    ['a round cut off by a restart', event('run.reconciled', { workflow: 'ticket-burner' })],
    ['a review pass finishing', event('ticket.done')],
    ['the human merging', event('feature.shipped')],
    ['a merge conflicting', event('merge.conflict', { files: [] })],
    ['a conflict resolved', event('merge.resolved', { mergeFrom: 'main', mergeInto: 'feature/x' })],
    ['a drive the human started failing', event('testdrive.dev_failed')],
    ['another chat taking the feature', event('feature.taken', { from: 'thread', name: 'Phone cut' })],
    ['the human talking to a chat', event('session.process_started', { sessionId: 's', source: 'human' })],
    ['the human’s chat going quiet', event('session.process_stopped', { sessionId: 's', startedBy: 'human' })],
    ['the human starting a drive', event('testdrive.started')],
    ['the human having it plan itself', event('session.launching', { sessionId: 's', purpose: 'self-plan' })],
    ['a dependent starting by itself', event('feature.started', { autoStartedBy: 'core' })],
    ['a drive the orchestrator started failing', event('testdrive.dev_failed', byOrchestrator)],
    ['its message not reaching a lead', event('lead.wake_failed', byOrchestrator)],
  ]

  it.each(gone)('%s says nothing', (_name, e) => {
    expect(orchestratorLineFor(e, held)).toBeNull()
  })

  it('says nothing for any project event', () => {
    expect(orchestratorLineFor(event('project.renamed', undefined, { featureId: undefined }), {})).toBeNull()
  })
})

describe('a merge, said to the feature’s epic (decision 2)', () => {
  const merge = (overrides: Partial<MergeNews> = {}): NotifyState => ({
    feature: {
      slug: 'export-csv',
      title: 'Export CSV',
      holderId: null,
      merge: {
        epicId: 'epic',
        by: 'the human',
        byName: 'you',
        base: 'main',
        sha: '0123456789abcdef0123456789abcdef01234567',
        outcome: 'docs/features/export-csv/outcome.md',
        siblings: [
          { slug: 'import-csv', title: 'Import CSV' },
          { slug: 'phone-cut', title: 'Phone cut' },
        ],
        reviewSummary: null,
        decided: [],
        dismissed: [],
        ...overrides,
      },
    },
  })
  const shipped = event('feature.shipped', { base: 'main' })

  it('lists the siblings in progress and where to read the change', () => {
    expect(orchestratorLineFor(shipped, merge())).toBe(
      [
        '[runcastle] export-csv merged into main by the human.',
        'In progress in this epic:',
        '- import-csv: Import CSV',
        '- phone-cut: Phone cut',
        'Read the change: the merge commit 0123456789ab and docs/features/export-csv/outcome.md.',
      ].join('\n'),
    )
  })

  it('carries the review summary, the decisions made without the human and the defects dismissed', () => {
    const line = orchestratorLineFor(
      shipped,
      merge({
        siblings: [],
        outcome: 'docs/features/export-csv/brief.md',
        reviewSummary: '## Review summary\n\n- Shipped: 2026-11-22\n- No review ran\n',
        decided: [{ n: 4, title: 'Dates in ISO' }],
        dismissed: [{ title: 'Header repeats', severity: 'low', location: 'export.ts:12', resolutionNote: 'out of scope' }],
      }),
    )
    expect(line).toBe(
      [
        '[runcastle] export-csv merged into main by the human.',
        'Review summary:',
        '- Shipped: 2026-11-22',
        '- No review ran',
        'Decided without the human:',
        '- 4. Dates in ISO',
        'Defects dismissed, not fixed:',
        '- Header repeats (low, export.ts:12): out of scope',
        'Nothing of this epic is in progress, so there is nothing to check.',
      ].join('\n'),
    )
  })

  it('says who merged it: the human, this chat, another chat, or runcastle', () => {
    expect(orchestratorLineFor(shipped, merge({ by: 'this chat' }))).toMatch(/^\[runcastle\] export-csv merged into main by this chat\.\n/)
    expect(orchestratorLineFor(shipped, merge({ by: 'the chat "Phone cut"' }))).toMatch(/ by the chat "Phone cut"\.\n/)
  })

  it('says there is nothing to check when nothing of the epic is in progress', () => {
    expect(orchestratorLineFor(shipped, merge({ siblings: [] }))).toBe(
      '[runcastle] export-csv merged into main by the human.\nNothing of this epic is in progress, so there is nothing to check.',
    )
  })

  it('points at the feature’s context when neither the merge commit nor an outcome doc is known', () => {
    expect(orchestratorLineFor(shipped, merge({ sha: null, outcome: null }))).toMatch(
      /\nRead the change with get_feature_context\(\{ slug: "export-csv" \}\)\.$/,
    )
  })

  it('shows the human a done row saying who merged it', () => {
    expect(orchestratorNewsFor(shipped, merge())).toEqual({ featureId: 'feat', title: 'Export CSV', tone: 'done', words: 'Merged by you' })
    expect(orchestratorNewsFor(shipped, merge({ by: 'this chat', byName: 'Phone cut' }))).toMatchObject({ words: 'Merged by Phone cut' })
  })

  it('goes to the epic', () => {
    expect(orchestratorTargetFor(shipped, merge())).toBe('epic')
    expect(orchestratorTargetFor(event('feature.autostart.failed'), held)).toBe('thread')
  })

  it('says nothing of a merge with no epic to tell', () => {
    expect(orchestratorLineFor(shipped, held)).toBeNull()
    expect(orchestratorNewsFor(shipped, held)).toBeNull()
    expect(orchestratorTargetFor(shipped, held)).toBeNull()
  })
})

async function gitRepo(): Promise<string> {
  const dir = tmpRepo()
  const g = simpleGit(dir)
  await g.init(['-b', 'main'])
  await g.addConfig('user.email', 'test@runcastle.dev')
  await g.addConfig('user.name', 'Runcastle Test')
  writeFileSync(join(dir, 'README.md'), 'base\n')
  await g.add(['README.md'])
  await g.commit('initial commit')
  return dir
}

describe('the notifier', () => {
  let ctx: AppCtx
  let repoPath: string
  let projectId: string
  let opened: Project
  let restoreDataDir: () => void
  let stopNotifier: () => void
  let fake: FakeAcp
  let host: AgentHost

  beforeEach(async () => {
    restoreDataDir = withTempDataDir()
    ctx = await makeTestCtx()
    repoPath = await gitRepo()
    opened = await openProject(ctx, repoPath)
    projectId = opened.id
    stopNotifier = startOrchestratorNotifier(ctx)
    fake = createFakeAcp()
    host = createAgentHost({ ctx, transport: fake.transport, launch: FAKE_LAUNCH })
    setAgentHostForTests(host)
  })

  afterEach(async () => {
    await host.stopAll('shutdown')
    setAgentHostForTests(undefined)
    stopNotifier()
    vi.restoreAllMocks()
    restoreDataDir()
    rmTemp(repoPath)
  })

  /** A live orchestrator — the orchestrator. */
  function projectSession(): string {
    const row = createSessionRow(ctx, { projectId, kind: 'project', worktreePath: repoPath })
    markSessionLive(ctx, row.id, { ccSessionId: `cc-${row.id}` })
    return row.id
  }

  /** A feature of the epic `epic`. */
  function epicFeature(epic: string, slug = 'demo', overrides: Partial<Feature> = {}): Feature {
    return seedFeature(ctx, projectId, { slug, chatId: epic, ...overrides })
  }

  /** The lines each runcastle prompt said into the thread, one prompt per entry. */
  async function promptLines(id: string, prompts: number): Promise<string[][]> {
    await vi.waitFor(() => expect(promptsOf(id)).toHaveLength(prompts))
    return promptsOf(id).map((p) => {
      expect(p.source).toBe('runcastle')
      return p.text.split('\n')
    })
  }

  const settle = () => new Promise((r) => setTimeout(r, ORCHESTRATOR_GATHER_MS + 50))

  it('says a dependent that could not start into its epic, starting it', async () => {
    const id = projectSession()
    markSessionEnded(ctx, id)
    const feature = epicFeature(id, 'export-csv')

    emit(ctx, feature.id, { type: 'feature.autostart.failed', message: 'started by itself, but its lead could not launch: no runtime' })

    const [lines] = await promptLines(id, 1)
    expect(lines[0]).toMatch(/^\[runcastle\] export-csv started by itself, but its lead could not launch: no runtime/)
    expect(promptsOf(id)[0]).toMatchObject({ display: { news: [{ featureId: feature.id, events: [{ tone: 'failed' }] }] } })
    await vi.waitFor(() => expect(host.isRunning(id)).toBe(true))
  })

  it('says two events ending together as one prompt with two lines', async () => {
    const id = projectSession()
    const a = epicFeature(id, 'snake-core')
    const b = epicFeature(id, 'snake-ui')

    emit(ctx, a.id, { type: 'feature.autostart.failed', message: 'no runtime' })
    emit(ctx, b.id, { type: 'feature.autostart.skipped', message: 'different bases' })

    expect((await promptLines(id, 1))[0]).toHaveLength(2)
  })

  it('stays quiet about everything else, and about a feature with no epic', async () => {
    const id = projectSession()
    const mine = epicFeature(id, 'mine')
    const nobodys = seedFeature(ctx, projectId, { slug: 'nobodys' })

    emit(ctx, mine.id, { type: 'feature.ready_declared', message: 'ready' })
    emit(ctx, mine.id, { type: 'feature.started', message: 'x', data: { autoStartedBy: 'core' } })
    emit(ctx, mine.id, { type: 'feature.waiting', message: 'x', data: { why: 'start round 1?' } })
    runAsActor('orchestrator', () => emit(ctx, mine.id, { type: 'testdrive.dev_failed', message: 'boom' }))
    emit(ctx, nobodys.id, { type: 'feature.autostart.failed', message: 'boom' })
    emitProject(ctx, projectId, { type: 'project.renamed', message: 'x' })

    await settle()
    expect(promptsOf(id)).toEqual([])
  })

  it('says that a shipped feature’s drafts could not start', async () => {
    const id = projectSession()
    const done = epicFeature(id, 'done', { status: 'shipped' })

    emit(ctx, done.id, { type: 'feature.autostart.failed', message: "couldn't start up-next dependents: boom" })
    expect(await promptLines(id, 1)).toEqual([
      [`[runcastle] done couldn't start up-next dependents: boom. Read it with get_feature_context({ slug: "done" }).`],
    ])
  })

  it('wakes the epic for a merge even when nothing of it is in progress', async () => {
    const epic = projectSession()
    markSessionEnded(ctx, epic)
    const merged = epicFeature(epic, 'merged', { status: 'shipped' })
    const shipped = emit(ctx, merged.id, { type: 'feature.shipped', message: 'merged to main', data: { base: 'main' } })

    announceMerge(ctx, shipped.id)
    const [lines] = await promptLines(epic, 1)
    expect(lines?.at(-1)).toMatch(/nothing to check\.$/)
    expect(promptsOf(epic)[0]).toMatchObject({
      display: { news: [{ featureId: merged.id, events: [{ tone: 'done', words: 'Merged by you' }] }] },
    })
    expect(promptsOf(epic)[0]?.held).toBeUndefined()
    await vi.waitFor(() => expect(host.isRunning(epic)).toBe(true))
  })

  it('says nothing of a merge as its live event arrives: only the merge flow announces it', async () => {
    const epic = projectSession()
    const merged = epicFeature(epic, 'merged', { status: 'shipped' })
    emit(ctx, merged.id, { type: 'feature.shipped', message: 'merged to main', data: { base: 'main' } })
    await settle()
    expect(promptsOf(epic)).toEqual([])
  })

  it('never lets a failure reach the service that emitted', () => {
    const id = projectSession()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const feature = epicFeature(id)
    ctx.db.delete(sessions).run()

    expect(() => emit(ctx, feature.id, { type: 'feature.autostart.failed', message: 'x' })).not.toThrow()
  })
})
