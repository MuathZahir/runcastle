import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { EventRow, WorkflowCtx, WorkflowDef } from '@runcastle/core'
import { simpleGit } from 'simple-git'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runs } from '../src/db/schema'
import type { AppCtx } from '../src/db/types'
import { resolveAutonomy } from '@runcastle/core'
import { listAfter, listByProject } from '../src/services/events'
import { getSettings, updateSettings } from '../src/services/settings'
import { addNote, attachScreenshot } from '../src/services/test-notes'
import { createCallerFactory } from '../src/trpc/context'
import { appRouter } from '../src/trpc/router'
import { annotationPath } from '@runcastle/core/paths'
import {
  declareReady,
  dispatchRound,
  go,
  listReadyDeclarations,
  markHumanMessage,
  setAutonomy,
  setWaiting,
  stopFeature,
  stopRound,
} from '../src/services/features'
import { __resetTestDriveState, createFeatureBranch, testDrive } from '../src/services/git'
import { getFeatureRow, getRunRow, requireProjectById } from '../src/services/repo'
import { listRounds } from '../src/services/runs'
import { listByFeature, storeTickets, updateTicket } from '../src/services/tickets'
import { workflowRegistry } from '../src/workflows/registry'
import { startRun } from '../src/workflows/runner'
import { useDataDir } from './helpers/data-dir'
import { makeTestCtx } from './helpers/db'
import { rmTemp, seedFeature, seedProject } from './helpers/fixtures'

/**
 * The feature lead's rounds at the features-service and run-finalization
 * seams (`the-feature-lead-runs-rounds`): Go, dispatch and its refusals, the
 * round's end (no auto-advance, gates recorded, one wake), ready declarations,
 * Stop and the waiting reason. A stubbed ticket-burner keeps sandcastle out.
 */

/** Marks every ticket it holds done — a round where everything landed. */
const landingBurner: WorkflowDef = {
  id: 'ticket-burner',
  async run(wctx: WorkflowCtx) {
    for (const t of wctx.tickets) {
      if (t.status === 'pending') wctx.updateTicket(t.id, { status: 'done', commits: ['abc'] })
    }
    return { status: 'succeeded', summary: 'all landed' }
  },
}

/** Runs until it is cancelled. */
const hangingBurner: WorkflowDef = {
  id: 'ticket-burner',
  run: (wctx: WorkflowCtx) =>
    new Promise((_, reject) => {
      wctx.signal.addEventListener('abort', () => reject(new Error('aborted')))
    }),
}

/** Halts on the account's usage limit, as the burner's run-fatal path does. */
const haltingBurner: WorkflowDef = {
  id: 'ticket-burner',
  async run(wctx: WorkflowCtx) {
    const [t] = wctx.tickets
    wctx.emitEvent({
      type: 'run.halted',
      message: 'run halted: 5-hour usage limit reached',
      ticketId: t?.id,
    })
    return { status: 'failed', summary: 'run halted at ticket 1: 5-hour usage limit reached' }
  },
}

function ticketInput(title: string, kind: 'implementation' | 'review' = 'implementation') {
  return { title, goal: 'g', context: 'c', acceptanceCriteria: ['a'], seams: ['s'], blockedBy: [], kind }
}

async function waitFor(fn: () => boolean, tries = 200): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (fn()) return
    await new Promise((r) => setTimeout(r, 5))
  }
  throw new Error('waitFor timed out')
}

function eventsOf(ctx: AppCtx, featureId: string, type: string): EventRow[] {
  return listAfter(ctx, featureId, 0).filter((e) => e.type === type)
}

/** Messages the lead was sent (no live terminal in tests, so each is recorded pending). */
function leadMessages(ctx: AppCtx, featureId: string): string[] {
  return eventsOf(ctx, featureId, 'lead.message_pending').map((e) => (e.data as { text: string }).text)
}

describe('the feature lead runs rounds', () => {
  let ctx: AppCtx
  let projectId: string
  let original: WorkflowDef | undefined

  beforeEach(async () => {
    ctx = await makeTestCtx()
    projectId = seedProject(ctx).id
    original = workflowRegistry.get('ticket-burner')
    workflowRegistry.set('ticket-burner', landingBurner)
  })

  afterEach(() => {
    if (original) workflowRegistry.set('ticket-burner', original)
    else workflowRegistry.delete('ticket-burner')
  })

  describe('Go', () => {
    it('moves a planning feature with no tickets to building, starts no run, warns and tells the lead', async () => {
      const featureId = seedFeature(ctx, projectId).id

      const { warnings } = await go(ctx, featureId)

      expect(getFeatureRow(ctx, featureId).phase).toBe('building')
      expect(ctx.db.select().from(runs).all()).toHaveLength(0)
      expect(warnings).toEqual([expect.stringMatching(/no spec\.md/)])
      expect(eventsOf(ctx, featureId, 'feature.go')).toHaveLength(1)
      expect(leadMessages(ctx, featureId)).toEqual([expect.stringMatching(/Go given/)])
    })

    it('refuses a draft and a feature already past planning', async () => {
      const draft = seedFeature(ctx, projectId, { slug: 'parked', status: 'draft', baseBranch: null })
      const building = seedFeature(ctx, projectId, { slug: 'built', phase: 'building' })

      await expect(go(ctx, draft.id)).rejects.toThrow(/draft/)
      await expect(go(ctx, building.id)).rejects.toThrow(/past planning/)
    })
  })

  describe('dispatching a round', () => {
    it('starts a run over exactly the named pending tickets, leaving the rest for later', async () => {
      const featureId = seedFeature(ctx, projectId).id
      const [a, b, c] = storeTickets(ctx, featureId, [ticketInput('a'), ticketInput('b'), ticketInput('c')])
      await go(ctx, featureId)
      setWaiting(ctx, featureId, 'round proposed')

      const { runId } = await dispatchRound(ctx, featureId, [a.seq, c.seq])

      const started = eventsOf(ctx, featureId, 'run.started').find((e) => e.runId === runId)
      expect((started?.data as { ticketIds: string[] }).ticketIds.sort()).toEqual([a.id, c.id].sort())
      const feature = getFeatureRow(ctx, featureId)
      expect(feature.lastDispatchAt).toBeGreaterThan(0)
      expect(feature.waitingReason).toBeNull()
      await waitFor(() => getRunRow(ctx, runId).status !== 'running')
      expect(listByFeature(ctx, featureId).find((t) => t.id === b.id)?.status).toBe('pending')
    })

    it('refuses while the feature is still in planning', async () => {
      const featureId = seedFeature(ctx, projectId).id
      const [t] = storeTickets(ctx, featureId, [ticketInput('a')])
      await expect(dispatchRound(ctx, featureId, [t.seq])).rejects.toThrow(/no Go yet/)
    })

    it('refuses while a round is already running', async () => {
      const featureId = seedFeature(ctx, projectId, { phase: 'building' }).id
      const [t] = storeTickets(ctx, featureId, [ticketInput('a')])
      ctx.db
        .insert(runs)
        .values({ id: 'run_live', featureId, workflow: 'ticket-burner', status: 'running', startedAt: Date.now() })
        .run()
      await expect(dispatchRound(ctx, featureId, [t.seq])).rejects.toThrow(/already running/)
    })

    it('refuses an unknown seq and one with nothing left to burn', async () => {
      const featureId = seedFeature(ctx, projectId, { phase: 'building' }).id
      const [done] = storeTickets(ctx, featureId, [ticketInput('a')])
      updateTicket(ctx, done.id, { status: 'done', commits: ['abc'] })

      await expect(dispatchRound(ctx, featureId, [99])).rejects.toThrow(/ticket 99 does not exist/)
      await expect(dispatchRound(ctx, featureId, [done.seq])).rejects.toThrow(/is done/)
    })

    it('in Ask mode refuses until a human message has arrived since the last dispatch', async () => {
      const featureId = seedFeature(ctx, projectId).id
      const [a, b] = storeTickets(ctx, featureId, [ticketInput('a'), ticketInput('b')])
      setAutonomy(ctx, featureId, 'ask')
      await go(ctx, featureId)

      // Go is the human's approval of round 1.
      const { runId } = await dispatchRound(ctx, featureId, [a.seq])
      await waitFor(() => getRunRow(ctx, runId).status !== 'running')
      await expect(dispatchRound(ctx, featureId, [b.seq])).rejects.toThrow(/Ask before each round/)

      await new Promise((r) => setTimeout(r, 2))
      markHumanMessage(ctx, featureId)
      await expect(dispatchRound(ctx, featureId, [b.seq])).resolves.toMatchObject({ runId: expect.any(String) })
    })
  })

  describe('a round returning', () => {
    it('stays in building, records the gates on the round and wakes the lead once', async () => {
      const featureId = seedFeature(ctx, projectId, { phase: 'building' }).id
      const [t] = storeTickets(ctx, featureId, [ticketInput('Add the form')])

      const { runId, done } = await startRun(ctx, featureId, 'ticket-burner', {
        ticketIds: [t.id],
        roundGates: async () => ({
          status: 'ran',
          commit: 'abc',
          commands: [
            { command: 'bun run typecheck', outcome: 'passed', exitCode: 0, log: '0.log' },
            { command: 'bun run test', outcome: 'failed', exitCode: 1, log: '1.log' },
          ],
        }),
      })
      await done

      expect(getFeatureRow(ctx, featureId).phase).toBe('building')
      const [round] = listRounds(ctx, featureId)
      expect(round).toMatchObject({
        round: 1,
        runId,
        status: 'succeeded',
        ticketSeqs: [t.seq],
        landed: [t.seq],
        failed: [],
        gates: { ok: false, failed: ['bun run test'] },
      })
      const wakes = leadMessages(ctx, featureId)
      expect(wakes).toHaveLength(1)
      expect(wakes[0]).toMatch(/Round 1 returned: succeeded/)
      expect(wakes[0]).toMatch(/#1 Add the form: done/)
      expect(wakes[0]).toMatch(/Gates: FAILED — `bun run test`/)
      expect(wakes[0]).toMatch(/get_ticket\(\{ seq \}\)/)
    })

    it('records no gate result when no verify command is configured', async () => {
      const featureId = seedFeature(ctx, projectId, { phase: 'building' }).id
      storeTickets(ctx, featureId, [ticketInput('a')])
      const { done } = await startRun(ctx, featureId, 'ticket-burner')
      await done

      expect(listRounds(ctx, featureId)[0]?.gates).toBeNull()
      expect(leadMessages(ctx, featureId)[0]).toMatch(/no verify commands are configured/)
    })

    it('sends nothing on a provider-limit halt and waits for the human instead', async () => {
      workflowRegistry.set('ticket-burner', haltingBurner)
      const featureId = seedFeature(ctx, projectId, { phase: 'building' }).id
      storeTickets(ctx, featureId, [ticketInput('a')])
      const { done } = await startRun(ctx, featureId, 'ticket-burner')
      await done

      expect(leadMessages(ctx, featureId)).toEqual([])
      expect(getFeatureRow(ctx, featureId).waitingReason).toBe('provider limit')
    })
  })

  describe('declaring ready', () => {
    it('moves building → review the first time only, and records each declaration', async () => {
      const featureId = seedFeature(ctx, projectId, { phase: 'building' }).id

      declareReady(ctx, featureId, { scenario: 'Checkout', whatToTest: 'Pay with a coupon.' })
      expect(getFeatureRow(ctx, featureId).phase).toBe('review')
      declareReady(ctx, featureId, { scenario: 'Refund', whatToTest: 'Refund the order.' })

      expect(getFeatureRow(ctx, featureId).phase).toBe('review')
      expect(eventsOf(ctx, featureId, 'phase.advanced')).toHaveLength(1)
      expect(listReadyDeclarations(ctx, featureId).map((d) => d.scenario)).toEqual(['Checkout', 'Refund'])
    })

    it('warns about a failing last round and about work no review has seen', async () => {
      const featureId = seedFeature(ctx, projectId, { phase: 'building' }).id
      const [impl] = storeTickets(ctx, featureId, [ticketInput('a')])
      workflowRegistry.set('ticket-burner', {
        id: 'ticket-burner',
        async run(wctx: WorkflowCtx) {
          wctx.updateTicket(impl.id, { status: 'done', commits: ['abc'] })
          return { status: 'failed', summary: '1 failed' }
        },
      })
      const { runId, done } = await startRun(ctx, featureId, 'ticket-burner')
      await done

      const { declaration, warnings } = declareReady(ctx, featureId, { scenario: 'S', whatToTest: 'W' })

      expect(declaration.runId).toBe(runId)
      expect(warnings).toEqual([
        expect.stringMatching(/the last round had failures/),
        expect.stringMatching(/nothing has reviewed the work since the last change/),
      ])
    })

    it('does not warn about review when a review landed after the last change', async () => {
      const featureId = seedFeature(ctx, projectId, { phase: 'building' }).id
      const [impl, review] = storeTickets(ctx, featureId, [ticketInput('a'), ticketInput('Review', 'review')])
      updateTicket(ctx, impl.id, { status: 'done', commits: ['abc'] })
      await new Promise((r) => setTimeout(r, 2))
      updateTicket(ctx, review.id, { status: 'done', commits: [] })

      expect(declareReady(ctx, featureId, { scenario: 'S', whatToTest: 'W' }).warnings).toEqual([])
    })
  })

  describe('stopping and waiting', () => {
    it('stop_round cancels the running round', async () => {
      workflowRegistry.set('ticket-burner', hangingBurner)
      const featureId = seedFeature(ctx, projectId, { phase: 'building' }).id
      const [t] = storeTickets(ctx, featureId, [ticketInput('a')])
      const { runId } = await dispatchRound(ctx, featureId, [t.seq])

      await stopRound(ctx, featureId)

      await waitFor(() => getRunRow(ctx, runId).status === 'cancelled')
      await expect(stopRound(ctx, featureId)).rejects.toThrow(/no round is running/)
    })

    it('Stop cancels the round, flips the feature to Ask and tells the lead', async () => {
      workflowRegistry.set('ticket-burner', hangingBurner)
      const featureId = seedFeature(ctx, projectId, { phase: 'building' }).id
      const [t] = storeTickets(ctx, featureId, [ticketInput('a')])
      const { runId } = await dispatchRound(ctx, featureId, [t.seq])

      const stopped = await stopFeature(ctx, featureId)

      expect(stopped.autonomy).toBe('ask')
      await waitFor(() => getRunRow(ctx, runId).status === 'cancelled')
      expect(eventsOf(ctx, featureId, 'feature.stopped')).toHaveLength(1)
      // Only Stop's own message: a cancelled round does not wake the lead again.
      await new Promise((r) => setTimeout(r, 20))
      expect(leadMessages(ctx, featureId)).toEqual([expect.stringMatching(/pressed Stop/)])
    })

    // Killing a round's sandboxes can take seconds; the switch beside the status
    // line must read Ask (and push) the moment Stop lands, not after the kill.
    it('Stop flips the feature to Ask before it waits on the round to die', async () => {
      workflowRegistry.set('ticket-burner', hangingBurner)
      const featureId = seedFeature(ctx, projectId, { phase: 'building' }).id
      const [t] = storeTickets(ctx, featureId, [ticketInput('a')])
      await dispatchRound(ctx, featureId, [t.seq])

      await stopFeature(ctx, featureId)

      const [stopped] = eventsOf(ctx, featureId, 'feature.stopped')
      const [roundStopped] = eventsOf(ctx, featureId, 'round.stopped')
      expect(stopped?.id).toBeLessThan(roundStopped?.id ?? 0)
    })

    it('a waiting reason is cleared by a human message and by a dispatch', async () => {
      const featureId = seedFeature(ctx, projectId, { phase: 'building' }).id
      const [t] = storeTickets(ctx, featureId, [ticketInput('a')])

      setWaiting(ctx, featureId, 'stuck on the same failure')
      expect(getFeatureRow(ctx, featureId).waitingReason).toBe('stuck on the same failure')
      markHumanMessage(ctx, featureId)
      expect(getFeatureRow(ctx, featureId).waitingReason).toBeNull()

      setWaiting(ctx, featureId, 'round proposed')
      await dispatchRound(ctx, featureId, [t.seq])
      expect(getFeatureRow(ctx, featureId).waitingReason).toBeNull()
      expect(eventsOf(ctx, featureId, 'feature.waiting')).toHaveLength(2)
    })

    it('setAutonomy sets and clears the override', () => {
      const featureId = seedFeature(ctx, projectId).id
      expect(setAutonomy(ctx, featureId, 'ask').autonomy).toBe('ask')
      expect(setAutonomy(ctx, featureId, null).autonomy).toBeNull()
      expect(eventsOf(ctx, featureId, 'feature.autonomy_set')).toHaveLength(2)
    })
  })

  describe('autonomy resolution', () => {
    const io = { env: {}, configFile: join(tmpdir(), 'rc-no-config', 'config.json') }

    it('resolves feature ?? project ?? run-until-ready, the project default being a setting', () => {
      const featureId = seedFeature(ctx, projectId).id
      const resolved = () => resolveAutonomy(requireProjectById(ctx, projectId), getFeatureRow(ctx, featureId))

      expect(getSettings(ctx, projectId, io).fields.find((f) => f.key === 'autonomy')).toMatchObject({
        value: 'run-until-ready',
        source: 'default',
      })
      expect(resolved()).toBe('run-until-ready')

      expect(updateSettings(ctx, { projectId, key: 'autonomy', value: 'ask' }, io)).toMatchObject({
        value: 'ask',
        source: 'project',
      })
      expect(resolved()).toBe('ask')
      setAutonomy(ctx, featureId, 'run-until-ready')
      expect(resolved()).toBe('run-until-ready')

      const updates = listByProject(ctx, projectId).filter((e) => e.type === 'settings.updated')
      expect(updates.map((e) => (e.data as { key: string }).key)).toEqual(['autonomy'])
    })

    it('refuses a value that is not an autonomy', () => {
      expect(() => updateSettings(ctx, { projectId, key: 'autonomy', value: 'yolo' }, io)).toThrow(/invalid value/)
    })
  })
})

describe('the rounds over tRPC', () => {
  let ctx: AppCtx
  let caller: ReturnType<ReturnType<typeof createCallerFactory<typeof appRouter>>>
  let featureId: string
  let restoreEnv: (() => void) | undefined
  let home: string
  let original: WorkflowDef | undefined

  beforeEach(async () => {
    home = mkdtempSync(join(tmpdir(), 'rc-home-'))
    restoreEnv = useDataDir(home)
    ctx = await makeTestCtx()
    caller = createCallerFactory(appRouter)(ctx)
    featureId = seedFeature(ctx, seedProject(ctx).id).id
    original = workflowRegistry.get('ticket-burner')
    workflowRegistry.set('ticket-burner', landingBurner)
  })

  afterEach(() => {
    if (original) workflowRegistry.set('ticket-burner', original)
    else workflowRegistry.delete('ticket-burner')
    restoreEnv?.()
    rmTemp(home)
  })

  it('go, setAutonomy, rounds, readyDeclarations and stop', async () => {
    const [t] = storeTickets(ctx, featureId, [ticketInput('a')])
    await expect(caller.feature.go({ featureId })).resolves.toEqual({ warnings: [expect.stringMatching(/no spec/)] })
    const { runId, done } = await startRun(ctx, featureId, 'ticket-burner', { ticketIds: [t.id] })
    await done

    await expect(caller.feature.rounds({ featureId })).resolves.toEqual([
      expect.objectContaining({ round: 1, runId, landed: [t.seq] }),
    ])
    declareReady(ctx, featureId, { scenario: 'S', whatToTest: 'W' })
    await expect(caller.feature.readyDeclarations({ featureId })).resolves.toEqual([
      expect.objectContaining({ scenario: 'S', whatToTest: 'W', runId }),
    ])
    await expect(caller.feature.setAutonomy({ featureId, autonomy: 'ask' })).resolves.toMatchObject({ autonomy: 'ask' })
    await expect(caller.feature.setAutonomy({ featureId, autonomy: null })).resolves.toMatchObject({ autonomy: null })
    await expect(caller.feature.stop({ featureId })).resolves.toMatchObject({ autonomy: 'ask' })
  })

  it('notes.send delivers every unsent note, screenshot paths included, as one human message', async () => {
    const shot = addNote(ctx, featureId, 'The coupon field is cut off')
    attachScreenshot(ctx, shot.id, new Uint8Array([137, 80, 78, 71]))
    addNote(ctx, featureId, 'Totals look right')

    await expect(caller.notes.send({ featureId })).resolves.toEqual({ sent: 2 })

    const [message] = leadMessages(ctx, featureId)
    expect(message).toMatch(/1\. The coupon field is cut off \(screenshot: .*\.png\)/)
    expect(message).toContain(annotationPath(shot.id))
    expect(message).toMatch(/2\. Totals look right/)
    expect(getFeatureRow(ctx, featureId).lastHumanMessageAt).toBeGreaterThan(0)
    expect((await caller.notes.list({ featureId })).every((n) => n.sentAt !== undefined)).toBe(true)

    // Sent notes do not travel again; an empty send says the drive went fine.
    await expect(caller.notes.send({ featureId })).resolves.toEqual({ sent: 0 })
    expect(leadMessages(ctx, featureId)[1]).toMatch(/Drive done, all good/)
  })
})

describe('no round starts while the feature is being driven', () => {
  const tmpDirs: string[] = []
  let restoreEnv: (() => void) | undefined
  const mkTmp = (prefix: string): string => {
    const dir = mkdtempSync(join(tmpdir(), prefix))
    tmpDirs.push(dir)
    return dir
  }

  beforeEach(() => {
    restoreEnv = useDataDir(mkTmp('rc-home-'))
  })
  afterEach(() => {
    __resetTestDriveState()
    restoreEnv?.()
    for (const dir of tmpDirs.splice(0)) {
      try {
        rmTemp(dir)
      } catch {
        // best-effort on Windows
      }
    }
  })

  it('refuses a dispatch while a drive of this feature holds the slot', async () => {
    const ctx = await makeTestCtx()
    const repo = mkTmp('rc-repo-')
    const g = simpleGit(repo)
    await g.init(['-b', 'main'])
    await g.addConfig('user.email', 'test@runcastle.dev')
    await g.addConfig('user.name', 'Runcastle Test')
    writeFileSync(join(repo, 'README.md'), 'base\n')
    await g.add(['README.md'])
    await g.commit('initial commit')
    const project = seedProject(ctx, repo)
    await createFeatureBranch(project, 'driven', 'main')
    const feature = seedFeature(ctx, project.id, { slug: 'driven', phase: 'building' })
    const [t] = storeTickets(ctx, feature.id, [ticketInput('a')])
    expect((await testDrive(ctx, project, feature, 'start')).ok).toBe(true)

    await expect(dispatchRound(ctx, feature.id, [t.seq])).rejects.toThrow(/test-driving this feature/)

    await testDrive(ctx, project, feature, 'stop')
  }, 15_000)
})
