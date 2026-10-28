import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { EventRow, RuncastleConfig, WorkflowCtx, WorkflowDef } from '@runcastle/core'
import { simpleGit } from 'simple-git'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runs } from '../src/db/schema'
import { GateError } from '../src/errors'
import { createSessionRow, markSessionLive } from '../src/launcher/sessions'
import type { AppCtx } from '../src/db/types'
import { listAfter } from '../src/services/events'
import { getSettings } from '../src/services/settings'
import { addNote, attachScreenshot } from '../src/services/test-notes'
import { createCallerFactory } from '../src/trpc/context'
import { appRouter } from '../src/trpc/router'
import { annotationPath } from '@runcastle/core/paths'
import {
  declareReady,
  dispatchRound,
  listReadyDeclarations,
  markHumanMessage,
  setWaiting,
  stopFeature,
  stopRound,
} from '../src/services/features'
import { __resetTestDriveState, createFeatureBranch, testDrive } from '../src/services/git'
import { getFeatureRow, getRunRow } from '../src/services/repo'
import { listRounds } from '../src/services/runs'
import { listByFeature, storeTickets, updateTicket } from '../src/services/tickets'
import { workflowRegistry } from '../src/workflows/registry'
import { startRun } from '../src/workflows/runner'
import { burnRun } from '../src/workflows/ticket-burner'
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

/**
 * Messages the lead was sent. These features have no checkout to open a chat
 * in, so each is recorded as kept for the agent (`lead.wake_failed`), text and all.
 */
function leadMessages(ctx: AppCtx, featureId: string): string[] {
  return listAfter(ctx, featureId, 0)
    .filter((e) => e.type === 'lead.message_queued' || e.type === 'lead.wake_failed')
    .map((e) => (e.data as { text: string }).text)
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


  describe('dispatching a round', () => {
    it('starts a run over exactly the named pending tickets, leaving the rest for later', async () => {
      const featureId = seedFeature(ctx, projectId, {}).id
      const [a, b, c] = storeTickets(ctx, featureId, [ticketInput('a'), ticketInput('b'), ticketInput('c')])
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

    it('starts a round on a fresh feature, with nothing to approve first', async () => {
      const featureId = seedFeature(ctx, projectId).id
      const [t] = storeTickets(ctx, featureId, [ticketInput('a')])

      const { runId } = await dispatchRound(ctx, featureId, [t.seq])

      expect(eventsOf(ctx, featureId, 'round.dispatched').map((e) => e.runId)).toEqual([runId])
      await waitFor(() => getRunRow(ctx, runId).status !== 'running')
    })

    it('refuses a shipped feature and a draft', async () => {
      const shipped = seedFeature(ctx, projectId, { slug: 'shipped', status: 'shipped' }).id
      const [s] = storeTickets(ctx, shipped, [ticketInput('a')])
      await expect(dispatchRound(ctx, shipped, [s.seq])).rejects.toThrow(/has shipped/)

      const draft = seedFeature(ctx, projectId, { slug: 'parked', status: 'draft', baseBranch: null }).id
      const [d] = storeTickets(ctx, draft, [ticketInput('a')])
      await expect(dispatchRound(ctx, draft, [d.seq])).rejects.toThrow(/backlog/)
      expect(ctx.db.select().from(runs).all()).toHaveLength(0)
    })

    it('refuses while a round is already running', async () => {
      const featureId = seedFeature(ctx, projectId, {}).id
      const [t] = storeTickets(ctx, featureId, [ticketInput('a')])
      ctx.db
        .insert(runs)
        .values({ id: 'run_live', featureId, workflow: 'ticket-burner', status: 'running', startedAt: Date.now() })
        .run()
      await expect(dispatchRound(ctx, featureId, [t.seq])).rejects.toThrow(/already running/)
    })

    it('refuses an unknown seq and one with nothing left to burn', async () => {
      const featureId = seedFeature(ctx, projectId, {}).id
      const [done] = storeTickets(ctx, featureId, [ticketInput('a')])
      updateTicket(ctx, done.id, { status: 'done', commits: ['abc'] })

      await expect(dispatchRound(ctx, featureId, [99])).rejects.toThrow(/ticket 99 does not exist/)
      await expect(dispatchRound(ctx, featureId, [done.seq])).rejects.toThrow(/is done/)
    })

    describe('blockers outside the round', () => {
      /** Stores `count` tickets, then rewrites edges as global seqs. */
      function seedGraph(featureId: string, edges: Record<number, number[]>, count: number) {
        const rows = storeTickets(
          ctx,
          featureId,
          Array.from({ length: count }, (_, i) => ({
            ...ticketInput(`t${i + 1}`),
            blockedBy: edges[i + 1] ?? [],
          })),
          { blockedByAreGlobal: true },
        )
        return rows
      }
      const runCount = () => ctx.db.select().from(runs).all().length

      it('refuses a pending outside blocker, naming both seqs and the fix, and changes nothing', async () => {
        const featureId = seedFeature(ctx, projectId, {}).id
        const [a, b, c] = seedGraph(featureId, { 2: [1] }, 3)
        updateTicket(ctx, c.id, { status: 'failed', error: 'earlier' })

        const err = await dispatchRound(ctx, featureId, [b.seq, c.seq]).catch((e: unknown) => e)

        expect(err).toBeInstanceOf(GateError)
        const message = (err as GateError).message
        expect(message).toContain(`ticket ${b.seq} is blocked by ticket ${a.seq}, which is not in this round and is pending`)
        expect(message).toContain(`name ${a.seq} in this round as well`)
        expect(message).not.toMatch(/missing|cancel/)
        expect(runCount()).toBe(0)
        expect(listByFeature(ctx, featureId).find((t) => t.id === c.id)?.status).toBe('failed')
        expect(eventsOf(ctx, featureId, 'round.dispatched')).toHaveLength(0)
        expect(getFeatureRow(ctx, featureId).lastDispatchAt).toBeNull()
      })

      it('refuses a failed outside blocker and lists every offending edge in one message', async () => {
        const featureId = seedFeature(ctx, projectId, {}).id
        const [a, b, , d, e] = seedGraph(featureId, { 4: [1, 2], 5: [9] }, 5)
        updateTicket(ctx, b.id, { status: 'failed', error: 'x' })

        const err = (await dispatchRound(ctx, featureId, [e.seq, d.seq]).catch((x: unknown) => x)) as GateError

        expect(err).toBeInstanceOf(GateError)
        expect(err.message).toBe(
          'this round cannot start: ' +
            `ticket 4 is blocked by ticket ${a.seq}, which is not in this round and is pending — name 1 in this round as well; ` +
            'ticket 4 is blocked by ticket 2, which is not in this round and is failed — name 2 in this round as well; ' +
            'ticket 5 is blocked by ticket 9, which does not exist on this feature',
        )
      })

      it('reports an orphaned burning blocker outside the round as failed, after the sweep', async () => {
        const featureId = seedFeature(ctx, projectId, {}).id
        const [a, b] = seedGraph(featureId, { 2: [1] }, 2)
        updateTicket(ctx, a.id, { status: 'burning' })

        const err = (await dispatchRound(ctx, featureId, [b.seq]).catch((x: unknown) => x)) as GateError

        expect(err).toBeInstanceOf(GateError)
        expect(err.message).toContain(`ticket ${b.seq} is blocked by ticket ${a.seq}, which is not in this round and is failed`)
        expect(listByFeature(ctx, featureId).find((t) => t.id === a.id)?.status).toBe('failed')
        expect(runCount()).toBe(0)
      })

      it('accepts blockers outside the round that are done or cancelled', async () => {
        const featureId = seedFeature(ctx, projectId, {}).id
        const [a, b, c] = seedGraph(featureId, { 3: [1, 2] }, 3)
        updateTicket(ctx, a.id, { status: 'done', commits: ['abc'] })
        updateTicket(ctx, b.id, { status: 'cancelled' })

        const { runId } = await dispatchRound(ctx, featureId, [c.seq])

        await waitFor(() => getRunRow(ctx, runId).status !== 'running')
        expect(listByFeature(ctx, featureId).find((t) => t.id === c.id)?.status).toBe('done')
      })

      describe('with the real scheduler', () => {
        const realBurner: WorkflowDef = {
          id: 'ticket-burner',
          run: async (wctx) => {
            const result = await burnRun(wctx, {
              config: { sandbox: 'docker' } as RuncastleConfig,
              hasAuthToken: true,
              concurrency: 4,
              executeTicketRun: async () => ({ status: 'done', commits: ['sha'] }),
            })
            return result
          },
        }
        beforeEach(() => workflowRegistry.set('ticket-burner', realBurner))

        it('lands #4 in a round that names only it, its blocker #3 having landed earlier', async () => {
          const featureId = seedFeature(ctx, projectId, {}).id
          const [, , three, four] = seedGraph(featureId, { 4: [3] }, 4)
          updateTicket(ctx, three.id, { status: 'done', commits: ['abc'] })

          const { runId } = await dispatchRound(ctx, featureId, [four.seq])
          await waitFor(() => getRunRow(ctx, runId).status !== 'running')

          expect(listByFeature(ctx, featureId).find((t) => t.id === four.id)).toMatchObject({ status: 'done' })
        })

        it('does not fail a review as missing when a blocker outside the round was cancelled', async () => {
          const featureId = seedFeature(ctx, projectId, {}).id
          const rows = storeTickets(
            ctx,
            featureId,
            [
              ticketInput('one'),
              ticketInput('two'),
              ticketInput('three'),
              ticketInput('four'),
              { ...ticketInput('review'), kind: 'review', blockedBy: [1, 2, 3, 4] },
            ],
            { blockedByAreGlobal: true },
          )
          updateTicket(ctx, rows[3].id, { status: 'cancelled' })

          const { runId } = await dispatchRound(ctx, featureId, [1, 2, 3, 5])
          await waitFor(() => getRunRow(ctx, runId).status !== 'running')

          const review = listByFeature(ctx, featureId).find((t) => t.seq === 5)
          expect(review?.status).toBe('done')
          expect(review?.error ?? '').not.toMatch(/missing/)
        })
      })
    })

    it('dispatches round after round with no human message in between', async () => {
      const featureId = seedFeature(ctx, projectId, {}).id
      const [a, b] = storeTickets(ctx, featureId, [ticketInput('a'), ticketInput('b')])

      const { runId } = await dispatchRound(ctx, featureId, [a.seq])
      await waitFor(() => getRunRow(ctx, runId).status !== 'running')
      await expect(dispatchRound(ctx, featureId, [b.seq])).resolves.toMatchObject({ runId: expect.any(String) })
    })

    it('after Stop refuses until a human message arrives, which clears the stopped mark', async () => {
      const featureId = seedFeature(ctx, projectId, {}).id
      const [a, b] = storeTickets(ctx, featureId, [ticketInput('a'), ticketInput('b')])
      await stopFeature(ctx, featureId)

      await expect(dispatchRound(ctx, featureId, [a.seq])).rejects.toThrow(
        'Stopped by the human — wait for their reply',
      )
      // runcastle's own wakes are not the human's reply.
      setWaiting(ctx, featureId, 'stopped')
      await expect(dispatchRound(ctx, featureId, [a.seq])).rejects.toThrow(/Stopped by the human/)

      await new Promise((r) => setTimeout(r, 2))
      markHumanMessage(ctx, featureId)
      expect(getFeatureRow(ctx, featureId).stoppedAt).toBeNull()
      const { runId } = await dispatchRound(ctx, featureId, [a.seq])
      await waitFor(() => getRunRow(ctx, runId).status !== 'running')
      await expect(dispatchRound(ctx, featureId, [b.seq])).resolves.toMatchObject({ runId: expect.any(String) })
    })
  })

  describe('a round returning', () => {
    it('stays in building, records the gates on the round and wakes the lead once', async () => {
      const featureId = seedFeature(ctx, projectId, {}).id
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
      const featureId = seedFeature(ctx, projectId, {}).id
      storeTickets(ctx, featureId, [ticketInput('a')])
      const { done } = await startRun(ctx, featureId, 'ticket-burner')
      await done

      expect(listRounds(ctx, featureId)[0]?.gates).toBeNull()
      expect(leadMessages(ctx, featureId)[0]).toMatch(/no verify commands are configured/)
    })

    it('sends nothing on a provider-limit halt and waits for the human instead', async () => {
      workflowRegistry.set('ticket-burner', haltingBurner)
      const featureId = seedFeature(ctx, projectId, {}).id
      storeTickets(ctx, featureId, [ticketInput('a')])
      const { done } = await startRun(ctx, featureId, 'ticket-burner')
      await done

      expect(leadMessages(ctx, featureId)).toEqual([])
      expect(getFeatureRow(ctx, featureId).waitingReason).toBe('provider limit')
    })
  })

  describe('declaring ready', () => {
    it('records each declaration and waits on the human, which their next message clears', async () => {
      const featureId = seedFeature(ctx, projectId).id

      declareReady(ctx, featureId, { scenario: 'Checkout' })
      expect(getFeatureRow(ctx, featureId)).toMatchObject({ status: 'active', waitingReason: 'ready to test' })
      markHumanMessage(ctx, featureId)
      expect(getFeatureRow(ctx, featureId).waitingReason).toBeNull()
      declareReady(ctx, featureId, { scenario: 'Refund' })

      expect(getFeatureRow(ctx, featureId)).toMatchObject({ waitingReason: 'ready to test' })
      expect(listReadyDeclarations(ctx, featureId)[0]).not.toHaveProperty('whatToTest')
      expect(listReadyDeclarations(ctx, featureId).map((d) => d.scenario)).toEqual(['Checkout', 'Refund'])
    })

    it('refuses a shipped feature and a draft', () => {
      const shipped = seedFeature(ctx, projectId, { slug: 'shipped', status: 'shipped' }).id
      expect(() => declareReady(ctx, shipped, { scenario: 'S' })).toThrow(/already shipped/)
      const draft = seedFeature(ctx, projectId, { slug: 'parked', status: 'draft', baseBranch: null }).id
      expect(() => declareReady(ctx, draft, { scenario: 'S' })).toThrow(/backlog/)
    })

    it('warns about a failing last round, and not about work no review has seen', async () => {
      const featureId = seedFeature(ctx, projectId, {}).id
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

      const { declaration, warnings } = declareReady(ctx, featureId, { scenario: 'S' })

      expect(declaration.runId).toBe(runId)
      expect(warnings).toEqual([expect.stringMatching(/the last round had failures/)])
    })

    it('does not warn when changed work was never reviewed — review is the agent’s call', () => {
      const featureId = seedFeature(ctx, projectId, {}).id
      const [impl] = storeTickets(ctx, featureId, [ticketInput('a')])
      updateTicket(ctx, impl.id, { status: 'done', commits: ['abc'] })

      expect(declareReady(ctx, featureId, { scenario: 'S' }).warnings).toEqual([])
    })
  })

  describe('stopping and waiting', () => {
    it('stop_round cancels the running round', async () => {
      workflowRegistry.set('ticket-burner', hangingBurner)
      const featureId = seedFeature(ctx, projectId, {}).id
      const [t] = storeTickets(ctx, featureId, [ticketInput('a')])
      const { runId } = await dispatchRound(ctx, featureId, [t.seq])

      await stopRound(ctx, featureId)

      await waitFor(() => getRunRow(ctx, runId).status === 'cancelled')
      await expect(stopRound(ctx, featureId)).rejects.toThrow(/no round is running/)
    })

    it('Stop cancels the round, marks the feature stopped and waiting, and tells the lead', async () => {
      workflowRegistry.set('ticket-burner', hangingBurner)
      const featureId = seedFeature(ctx, projectId, {}).id
      const [t] = storeTickets(ctx, featureId, [ticketInput('a')])
      const { runId } = await dispatchRound(ctx, featureId, [t.seq])

      const stopped = await stopFeature(ctx, featureId)

      expect(stopped.stoppedAt).toBeGreaterThan(0)
      expect(stopped.waitingReason).toBe('stopped')
      await waitFor(() => getRunRow(ctx, runId).status === 'cancelled')
      expect(eventsOf(ctx, featureId, 'feature.stopped')).toHaveLength(1)
      // Only Stop's own message: a cancelled round does not wake the lead again.
      await new Promise((r) => setTimeout(r, 20))
      expect(leadMessages(ctx, featureId)).toEqual([expect.stringMatching(/pressed Stop/)])
    })

    // Killing a round's sandboxes can take seconds; the status line must read
    // stopped (and push) the moment Stop lands, not after the kill.
    it('Stop marks the feature stopped before it waits on the round to die', async () => {
      workflowRegistry.set('ticket-burner', hangingBurner)
      const featureId = seedFeature(ctx, projectId, {}).id
      const [t] = storeTickets(ctx, featureId, [ticketInput('a')])
      await dispatchRound(ctx, featureId, [t.seq])

      await stopFeature(ctx, featureId)

      const [stopped] = eventsOf(ctx, featureId, 'feature.stopped')
      const [roundStopped] = eventsOf(ctx, featureId, 'round.stopped')
      expect(stopped?.id).toBeLessThan(roundStopped?.id ?? 0)
    })

    it('a waiting reason is cleared by a human message and by a dispatch', async () => {
      const featureId = seedFeature(ctx, projectId, {}).id
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
  })

  describe('settings', () => {
    const io = { env: {}, configFile: join(tmpdir(), 'rc-no-config', 'config.json') }

    it('have no autonomy setting — the lead judges when to ask (decision 23)', () => {
      expect(getSettings(ctx, projectId, io).fields.map((f) => f.key)).not.toContain('autonomy')
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
    featureId = seedFeature(ctx, seedProject(ctx).id, {}).id
    original = workflowRegistry.get('ticket-burner')
    workflowRegistry.set('ticket-burner', landingBurner)
  })

  afterEach(() => {
    if (original) workflowRegistry.set('ticket-burner', original)
    else workflowRegistry.delete('ticket-burner')
    restoreEnv?.()
    rmTemp(home)
  })

  it('rounds, readyDeclarations and stop — and no go', async () => {
    const [t] = storeTickets(ctx, featureId, [ticketInput('a')])
    expect(caller.feature).not.toHaveProperty('go')
    expect(caller.feature).not.toHaveProperty('goWarnings')
    expect(caller.feature).not.toHaveProperty('burn')
    expect(caller.feature).not.toHaveProperty('agenticReview')
    const { runId, done } = await startRun(ctx, featureId, 'ticket-burner', { ticketIds: [t.id] })
    await done

    await expect(caller.feature.rounds({ featureId })).resolves.toEqual([
      expect.objectContaining({ round: 1, runId, landed: [t.seq] }),
    ])
    declareReady(ctx, featureId, { scenario: 'S' })
    await expect(caller.feature.readyDeclarations({ featureId })).resolves.toEqual([
      expect.objectContaining({ scenario: 'S', runId }),
    ])
    await expect(caller.feature.stop({ featureId })).resolves.toMatchObject({
      stoppedAt: expect.any(Number),
      waitingReason: 'stopped',
    })
  })

  it('notes.send delivers every unsent note, screenshot paths included, as one human message', async () => {
    const shot = addNote(ctx, featureId, 'The coupon field is cut off')
    attachScreenshot(ctx, shot.id, new Uint8Array([137, 80, 78, 71]))
    addNote(ctx, featureId, 'Totals look right')

    await expect(caller.notes.send({ featureId })).resolves.toEqual({ sent: 2, waiting: true })

    const [message] = leadMessages(ctx, featureId)
    expect(message).toMatch(/1\. The coupon field is cut off \(screenshot: .*\.png\)/)
    expect(message).toContain(annotationPath(shot.id))
    expect(message).toMatch(/2\. Totals look right/)
    expect(getFeatureRow(ctx, featureId).lastHumanMessageAt).toBeGreaterThan(0)
    expect((await caller.notes.list({ featureId })).every((n) => n.sentAt !== undefined)).toBe(true)
    // No agent is open, so nothing has reached one yet: the panel must not say "Sent".
    await expect(caller.notes.delivery({ featureId })).resolves.toMatchObject({ waitingSince: expect.any(Number) })

    // Sent notes do not travel again; an empty send says the drive went fine.
    await expect(caller.notes.send({ featureId })).resolves.toEqual({ sent: 0, waiting: true })
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
    const feature = seedFeature(ctx, project.id, { slug: 'driven' })
    const [t] = storeTickets(ctx, feature.id, [ticketInput('a')])
    expect((await testDrive(ctx, project, feature, 'start')).ok).toBe(true)

    await expect(dispatchRound(ctx, feature.id, [t.seq])).rejects.toThrow(/test-driving this feature/)

    await testDrive(ctx, project, feature, 'stop')
  }, 15_000)
})
