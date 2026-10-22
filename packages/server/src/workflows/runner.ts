import type { Feature, Project, ReviewGateRun, RunStatus, Ticket, WorkflowCtx } from '@runcastle/core'
import { newId, resolvePreparedSettings } from '@runcastle/core'
import { and, eq } from 'drizzle-orm'
import type { AppCtx } from '../db/types'
import { events, runs } from '../db/schema'
import { NotFoundError } from '../errors'
import { parkTalkWorktreeForRun, releaseTalkWorktreeAfterRun } from '../services/chat-branch'
import { emit } from '../services/events'
import { headSha } from '../services/git'
import { composeRoundWake, deliverToLead } from '../services/lead-delivery'
import { setWaiting } from '../services/lead-status'
import { getFeatureRow, getRunRow, projectForFeature } from '../services/repo'
import { roundGatesOf } from '../services/runs'
import { listByFeature as listFindingsByFeature, markFixProgress } from '../services/review-findings'
import { listByFeature, storeTickets, sweepOrphanedBurning, updateTicket } from '../services/tickets'
import { addTicketTokens, refreshLeadTokens } from '../services/usage'
import type { KillOutcome } from './kill-registry'
import { killRegistry } from './kill-registry'
import { getWorkflow } from './registry'

/**
 * Workflow runner (SPEC §3, task item 6). `startRun` creates the run row, wires
 * a `WorkflowCtx` to live services (emitEvent→events, updateTicket→tickets,
 * signal from a per-run AbortController), invokes the registered `WorkflowDef`,
 * catches, and finalizes the run row + a `run.finished` event. A branch-claiming
 * run is a round: once finalized, its verify gates run against the branch tip
 * and the feature's lead is woken with what came back. Nothing auto-advances —
 * the lead declares the feature ready.
 *
 * The workflow itself runs in the background (AFK); `startRun` returns as soon
 * as the run row exists. `done` resolves when the run finalizes — the tRPC
 * `feature.burn` procedure ignores it (returns `{ runId }`); tests await it.
 */

const controllers = new Map<string, AbortController>()

/**
 * Workflows that CLAIM the feature branch for the run's whole duration: their
 * sandcastle branch strategy checks `feature/<slug>` out in its own worktree,
 * so the talk worktree must be detached first (git forbids one branch in two
 * worktrees) and HITL terminals are refused while such a run is live.
 *
 * This flag arguably belongs on `WorkflowDef` itself (core-owned `workflow.ts`);
 * kept as a server-side map until core can change.
 */
const BRANCH_CLAIMING = new Set(['ticket-burner'])

/** Whether a workflow's run holds the feature branch (see `BRANCH_CLAIMING`). */
export function workflowClaimsFeatureBranch(workflowId: string): boolean {
  return BRANCH_CLAIMING.has(workflowId)
}

/**
 * Whether a run is genuinely in flight IN THIS PROCESS (its AbortController is
 * registered). Boot reconciliation uses this to skip runs still being driven
 * across a `bun --hot` reload rather than falsely failing them.
 */
export function isRunActive(runId: string): boolean {
  return controllers.has(runId)
}

export interface StartRunResult {
  runId: string
  done: Promise<void>
}

export interface StartRunOptions {
  /** Per-run payload exposed to the workflow as `ctx.input`. */
  input?: unknown
  /**
   * Per-run model override (issue #48) exposed to the workflow as
   * `ctx.modelOverride`; wins the `resolveModel` chain for the run's AFK agent.
   */
  modelOverride?: string
  /**
   * Restrict this run to these tickets. Unset (the normal burn) means the
   * feature's whole ticket set, which is what "Burn" has always meant.
   *
   * Set by the agentic-review mint, which is a request for ONE review pass, not
   * for the pending fix queue sitting beside it: scoping only `tickets` would
   * not be enough, because the scheduler re-reads the store when it mints
   * (`admitNewTickets`) and would fold that queue in a moment later. So
   * the scope also narrows `listTickets`, by hiding exactly the rows that
   * existed at run start and were left out — tickets minted DURING the run (a
   * verification pass) are never hidden and still join it.
   */
  ticketIds?: string[]
  /**
   * The round-end gate run (decision 10). The sandbox is a system boundary, so
   * only seam-level tests override it; unset runs the project's verify commands
   * against the feature branch tip in a burn-style sandbox.
   */
  roundGates?: RoundGateRunner
}

/** Run the project's verify commands for one finished round. Never throws for a broken environment. */
export type RoundGateRunner = (input: {
  ctx: AppCtx
  project: Project
  feature: Feature
  runId: string
}) => Promise<ReviewGateRun>

export async function startRun(
  ctx: AppCtx,
  featureId: string,
  workflowId: string,
  opts: StartRunOptions = {},
): Promise<StartRunResult> {
  const feature = getFeatureRow(ctx, featureId)
  const project = projectForFeature(ctx, feature)
  const def = getWorkflow(workflowId)
  if (!def) throw new NotFoundError(`workflow ${workflowId} not registered`)

  const opened = listByFeature(ctx, featureId)
  const scope = opts.ticketIds ? new Set(opts.ticketIds) : undefined
  const tickets = scope ? opened.filter((t) => scope.has(t.id)) : opened
  /** Rows the scope left behind — hidden from the run's re-reads, forever. */
  const excluded = new Set(scope ? opened.filter((t) => !scope.has(t.id)).map((t) => t.id) : [])
  const listRunTickets = (): Ticket[] => {
    const rows = listByFeature(ctx, featureId)
    return excluded.size === 0 ? rows : rows.filter((t) => !excluded.has(t.id))
  }

  const runId = newId('run')
  ctx.db
    .insert(runs)
    .values({
      id: runId,
      featureId,
      workflow: workflowId,
      status: 'running',
      startedAt: Date.now(),
      endedAt: null,
      summary: null,
    })
    .run()


  emit(ctx, featureId, {
    type: 'run.started',
    message: `run started (${workflowId})`,
    runId,
    // The lanes this run opens with, stated before any of them starts: they are
    // CLAIMED from here on (`runClaimedTicketIds`), and until this snapshot
    // existed nothing outside the scheduler's own memory could name a ticket the
    // run had not yet reached. On the event rather than on a column for the
    // reason the run/ticket join already is: a ticket outlives the run.
    data: {
      workflow: workflowId,
      ...(workflowClaimsFeatureBranch(workflowId)
        ? { ticketIds: tickets.filter((t) => t.status === 'pending').map((t) => t.id) }
        : {}),
    },
  })

  const controller = new AbortController()
  controllers.set(runId, controller)

  // Free the feature branch for the workflow's own worktree (SPEC §8) — ONLY
  // for branch-claiming workflows: a live talk worktree holds `feature/<slug>`
  // checked out, which git refuses to let the sandcastle burner check out again
  // ('already used by worktree'). It is parked on a chat temp branch for the
  // duration of the run — not detached, so the chat can keep committing docs
  // and landing them beside the burn (`one-chat-per-feature` decision 9) — and
  // handed back at finalize. A non-claiming workflow skips the dance entirely,
  // so the talk worktree — and any live HITL session inside it — is never
  // touched by its run.
  const claimsBranch = workflowClaimsFeatureBranch(workflowId)
  if (claimsBranch) await parkTalkWorktreeForRun(ctx, project, feature)

  const wctx: WorkflowCtx = {
    runId,
    project,
    feature,
    tickets,
    emitEvent: (e) => {
      emit(ctx, featureId, {
        type: e.type,
        message: e.message,
        ticketId: e.ticketId,
        data: e.data,
        runId,
      })
    },
    updateTicket: (id, patch) => {
      updateTicket(ctx, id, patch)
    },
    listTickets: listRunTickets,
    ...(scope
      ? {
          satisfiedOutside: opened
            .filter((t) => !scope.has(t.id) && (t.status === 'done' || t.status === 'cancelled'))
            .map((t) => t.seq),
        }
      : {}),
    addTicketTokens: (id, usage, sessionIds) => addTicketTokens(ctx, id, usage, sessionIds),
    storeTickets: (inputs) => storeTickets(ctx, featureId, inputs),
    listFindings: () => listFindingsByFeature(ctx, featureId),
    updateFinding: (findingId, progress, reason) => {
      markFixProgress(ctx, findingId, progress, reason)
    },
    input: opts.input,
    modelOverride: opts.modelOverride,
    signal: controller.signal,
  }

  const done = executeRun(
    ctx,
    runId,
    featureId,
    workflowId,
    def.run(wctx),
    controller,
    async () => {
      // The chat's last landing, then the feature branch back where it expects it.
      if (claimsBranch) await releaseTalkWorktreeAfterRun(ctx, project, feature)
    },
    // A branch-claiming run is a round: its end runs the gates and wakes the lead.
    claimsBranch ? () => endRound(ctx, runId, featureId, opts.roundGates ?? branchRoundGates) : undefined,
  )
  return { runId, done }
}

/**
 * The default {@link RoundGateRunner}: the project's verify commands against
 * the feature branch's tip, through the review pass's own gate runner.
 */
const branchRoundGates: RoundGateRunner = async ({ ctx, project, feature, runId }) => {
  // Loaded lazily for the reason review-ticket.ts gives: review-gates imports
  // ticket-burner, whose module graph reaches back here.
  const { parseVerifyCommands, runReviewGates } = await import('./review-gates')
  if (parseVerifyCommands(resolvePreparedSettings(ctx.config, project).verifyCommands).length === 0) {
    return { status: 'none_configured' }
  }
  const sha = await headSha(project.repoPath, feature.branch)
  if (!sha) {
    return { status: 'couldnt_run', commit: '', reason: `\`${feature.branch}\` did not resolve to a commit`, log: null }
  }
  // The gate logs and throwaway branch are keyed by the run, as a review's are by its ticket.
  return runReviewGates({ config: ctx.config, project, ticketId: runId, sha })
}

/** A run halt (`run.halted`) the burner recorded for this run, if any — the account said no. */
function runHaltHeadline(ctx: AppCtx, featureId: string, runId: string): string | undefined {
  const halt = ctx.db
    .select({ message: events.message })
    .from(events)
    .where(and(eq(events.featureId, featureId), eq(events.runId, runId), eq(events.type, 'run.halted')))
    .get()
  return halt?.message
}

/**
 * A round has returned (decisions 9, 10, 12, 15): run the verify gates against
 * the branch tip and record them on the run, then wake the lead with the one
 * composed message — unless Stop cancelled the round (Stop tells the lead
 * itself), or the provider halted it, which would only halt the lead too: the
 * feature waits for the human instead.
 */
async function endRound(
  ctx: AppCtx,
  runId: string,
  featureId: string,
  runGates: RoundGateRunner,
): Promise<void> {
  const feature = getFeatureRow(ctx, featureId)
  const project = projectForFeature(ctx, feature)
  let gates: ReviewGateRun
  try {
    gates = await runGates({ ctx, project, feature, runId })
  } catch (err) {
    gates = {
      status: 'couldnt_run',
      commit: '',
      reason: `the gate run failed: ${err instanceof Error ? err.message : String(err)}`,
      log: null,
    }
  }
  ctx.db.update(runs).set({ gates }).where(eq(runs.id, runId)).run()
  const result = roundGatesOf(gates)
  emit(ctx, featureId, {
    type: 'round.gates',
    message: !result
      ? 'round gates: no verify commands configured'
      : result.ok
        ? 'round gates passed'
        : `round gates failed: ${result.failed.join(', ')}`,
    runId,
    data: result ?? { ok: null, failed: [] },
  })
  refreshLeadTokens(ctx, featureId)

  const run = getRunRow(ctx, runId)
  if (run.status === 'cancelled') return
  const halt = runHaltHeadline(ctx, featureId, runId)
  if (halt) {
    setWaiting(ctx, featureId, PROVIDER_LIMIT.test(halt) ? 'provider limit' : halt)
    return
  }
  await deliverToLead(ctx, feature, { text: composeRoundWake(ctx, featureId, runId), source: 'runcastle' })
}

/** A run halt that is the provider's limit or balance rather than lapsed credentials. */
const PROVIDER_LIMIT = /usage limit|rate limit|quota|credit balance|billing/i

/**
 * Cancel an in-flight run: abort its signal, then kill every agent it has
 * running and wait, bounded, for them to be gone. No-op if unknown/finished.
 *
 * The abort alone only interrupts sandcastle's fiber — the containers keep
 * burning and keep streaming events — so the kill is what actually ends the
 * run, and what makes each lane's `run()` reject into the failure path that
 * writes its terminal state. That path waits on the same kill before it writes
 * anything (see `executeRun`), so the run row cannot read cancelled ahead of
 * the agents dying. `confirmed: false` means at least one agent outlived the
 * kill's deadline and may still be running.
 */
export async function cancelRun(runId: string): Promise<KillOutcome> {
  controllers.get(runId)?.abort()
  return await killRegistry().killAllForRun(runId)
}

async function executeRun(
  ctx: AppCtx,
  runId: string,
  featureId: string,
  workflow: string,
  runPromise: Promise<{ status: 'succeeded' | 'failed'; summary: string; digest?: string }>,
  controller: AbortController,
  cleanup?: () => Promise<void>,
  endOfRound?: () => Promise<void>,
): Promise<void> {
  let status: RunStatus = 'failed'
  let summary = 'run failed'
  // The workflow's long-form account of what this run produced, if it kept one.
  let digest: string | undefined
  // Whether the workflow threw: its `run.error` breadcrumb waits behind the kill
  // gate with the row it describes, rather than announcing a cancel that has not
  // happened yet.
  let threw = false
  try {
    const result = await runPromise
    status = result.status
    summary = result.summary
    digest = result.digest
  } catch (e) {
    if (controller.signal.aborted) {
      status = 'cancelled'
      summary = 'run cancelled'
    } else {
      status = 'failed'
      summary = e instanceof Error ? e.message : 'run failed'
    }
    threw = true
  } finally {
    controllers.delete(runId)
  }

  // `cancelRun` aborts the signal and waits for the kill second, and the abort
  // alone is enough to reject the workflow — so this continuation is already
  // running while the run's containers are still being removed. Nothing about
  // the run reads finished until every kill it ordered has settled, confirmed
  // or timed out. A run nobody cancelled has none in flight and passes straight
  // through.
  await killRegistry().whenRunKillsSettled(runId)
  if (threw) emit(ctx, featureId, { type: 'run.error', message: summary, runId })

  ctx.db
    .update(runs)
    .set({ status, endedAt: Date.now(), summary, ...(digest ? { digest } : {}) })
    .where(eq(runs.id, runId))
    .run()
  // The burner normally lands every lane itself, but a
  // workflow that threw between "mark burning" and the outcome write (or an
  // abort that raced the ticket's own handler) leaves a `burning` row with no
  // agent behind it — a state nothing else can move (see `sweepOrphanedBurning`).
  // Only branch-claiming workflows own tickets, so only they sweep; a no-op when
  // the run ended cleanly.
  if (workflowClaimsFeatureBranch(workflow)) {
    sweepOrphanedBurning(ctx, featureId, `orphaned — the run ended (${status}) while it was burning`)
  }
  emit(ctx, featureId, {
    type: 'run.finished',
    message: `run ${status}: ${summary}`,
    runId,
    data: { status, summary },
  })

  // No building → review advance here (decision 9): the lead declares the
  // feature ready, because a round succeeding is not the same as worth driving.

  if (cleanup) {
    try {
      await cleanup()
    } catch {
      // best-effort talk-worktree reattach — never fail a finalized run on it
    }
  }
  if (endOfRound) {
    try {
      await endOfRound()
    } catch (err) {
      emit(ctx, featureId, {
        type: 'round.end_failed',
        message: `round end failed: ${err instanceof Error ? err.message : String(err)}`,
        runId,
      })
    }
  }
}
