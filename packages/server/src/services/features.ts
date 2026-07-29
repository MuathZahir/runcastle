import type {
  Feature,
  FeatureStatus,
  GateDef,
  Project,
  Run,
  SessionRow,
  Ticket,
  Waypoint,
} from '@runcastle/core'
import { RETHINK_LOOP_BACK, REVIEW_LOOP_BACK, newId, nextGate, nextPhase } from '@runcastle/core'
import { sessionDir, worktreeDir } from '@runcastle/core/paths'
import { desc, eq } from 'drizzle-orm'
import { rmSync } from 'node:fs'
import type { AppCtx } from '../db/types'
import { events, features, gateOverrides, runs, sessions, tickets, waypoints } from '../db/schema'
import { GateError, InvalidInputError, isNotImplemented } from '../errors'
import { emit, emitProject } from './events'
import { checkGate } from './gates'
import * as git from './git'
import { listDocs, scaffoldDocs, scaffoldMapDoc } from './knowledge'
import type { DocSummary } from './knowledge'
import {
  getFeatureRow,
  hasActiveRun,
  listRunsByFeature,
  listSessionsByFeature,
  projectForFeature,
  requireProjectById,
  rowToFeature,
  setPhase,
} from './repo'
import { activeSessionsForFeature } from '../launcher/sessions'
import { endSession } from '../pty/end-session'
import { getTicket, listByFeature, storeTickets, sweepOrphanedBurning, updateTicket } from './tickets'
import { frontier, listByFeature as listWaypoints } from './waypoints'
import { cancelRun, startRun } from '../workflows/runner'

/**
 * Feature service (SPEC §3/§4): create, aggregate read, phase transitions,
 * burn. Git branch creation is B2's; `createFeature` tolerates the B2 stub via
 * `ensureFeatureBranch` so the feature row is created and the UI is usable
 * before wave B lands (task item 5).
 */

export interface TicketCounts {
  total: number
  pending: number
  burning: number
  done: number
  failed: number
  cancelled: number
}

export interface FeatureListItem extends Feature {
  ticketCounts: TicketCounts
  activeRun: boolean
}

export interface FeatureGateState {
  next: GateDef | null
  satisfied: boolean
  reason?: string
}

export interface FeatureFull {
  feature: Feature
  tickets: Ticket[]
  sessions: SessionRow[]
  runs: Run[]
  docs: DocSummary[]
  gate: FeatureGateState
  /** Mapped features only (empty otherwise): the map's waypoints (ADR-0001). */
  waypoints: Waypoint[]
  /** Ids of the waypoints currently on the frontier (derived; empty otherwise). */
  frontierIds: string[]
}

export interface CreateFeatureInput {
  /** The project the feature belongs to (multi-project, issue #43). */
  projectId: string
  title: string
  oneLiner: string
  /**
   * Branch to fork `feature/<slug>` off. Defaults to the project's `mainBranch`.
   * Any existing local branch is valid (the current branch, a release line,
   * another feature) — the merge target stays `mainBranch` regardless.
   */
  baseBranch?: string
}

export async function createFeature(
  ctx: AppCtx,
  input: CreateFeatureInput,
): Promise<Feature> {
  const project = requireProjectById(ctx, input.projectId)
  const slug = uniqueSlug(ctx, project.id, input.title)
  const branch = `feature/${slug}`
  const requestedBase = input.baseBranch?.trim() || project.mainBranch

  // The stored base is the RESOLVED local branch (a remote pick materialized a
  // local tracking branch), so it's always a real merge target at ship time.
  const { branchReady, baseBranch } = await ensureFeatureBranch(project, slug, requestedBase)

  const row = {
    id: newId('feat'),
    projectId: project.id,
    slug,
    title: input.title,
    oneLiner: input.oneLiner,
    // Every feature is created unmapped; mapping is escalation-only, reached
    // mid-grill via the MCP escalate_to_map tool (no "start mapped" at creation).
    mapped: false,
    // Every feature starts on lap 1; only Rethink moves it (ADR-0010 §7).
    lap: 1,
    phase: 'ideation' as const,
    branch,
    baseBranch,
    status: 'active' as const,
    createdAt: Date.now(),
  }
  const inserted = ctx.db.insert(features).values(row).returning().get()
  const feature = rowToFeature(inserted)

  emit(ctx, feature.id, {
    type: 'feature.created',
    message: branchReady
      ? `feature.created (${branch} ← ${baseBranch})`
      : 'feature.created (branch pending)',
    data: { slug, branch, baseBranch, branchReady },
  })

  scaffoldDocs(ctx, feature)

  // Commit the scaffolded brief so it does not linger as an untracked file in the
  // target repo's working tree. An untracked doc dirties the checkout and blocks
  // the ship gates (test-drive and merge both require `git status` to be clean).
  // Best-effort: a git stub (pre-B2) or a commit hiccup must never fail creation.
  if (branchReady) {
    try {
      await git.commitDocs(project.repoPath, `runcastle: scaffold ${slug} docs`)
    } catch {
      // best-effort — the brief stays on disk; only the auto-commit is skipped
    }
  }

  return feature
}

export interface QuickChangeInput {
  projectId: string
  /** Card title — the rail entry, the docs dir's slug, the ticket's title. */
  title: string
  /** The human's sentence. Becomes the ticket's goal AND its one criterion. */
  prose: string
  /** Same semantics as `CreateFeatureInput.baseBranch`. */
  baseBranch?: string
}

/**
 * The quick-change door (decision 21) — work too small to deserve a grill.
 *
 * An ORDINARY feature, born directly at `implementation` on lap 1, carrying
 * exactly one ticket whose goal is the human's prose and whose sole acceptance
 * criterion is that same sentence. From here it is the pipeline's far side:
 * review the one card, click Burn, test-drive, click Merge — zero terminals.
 *
 * Nothing on the row marks it (ADR-0010 §7 forbids pipeline-shape settings), so
 * a quick change is indistinguishable from a feature whose G1/G2 were
 * overridden — a state the machine can already reach. G1/G2 are never evaluated
 * because gates guard forward transitions only and this feature starts past
 * both; G3 sees the one pending lap-1 ticket and the Burn click crosses it.
 *
 * No `spec.md` and no `decisions.md` are written — there was no conversation to
 * record. `brief.md` carries the prose verbatim, which is what the burner reads
 * as `{{FEATURE_BRIEF}}`.
 */
export async function quickChange(ctx: AppCtx, input: QuickChangeInput): Promise<Feature> {
  const project = requireProjectById(ctx, input.projectId)
  const title = input.title.trim()
  const prose = input.prose.trim()
  if (!title) throw new InvalidInputError('a quick change needs a title')
  if (!prose) throw new InvalidInputError('a quick change needs a sentence describing the change')

  const slug = uniqueSlug(ctx, project.id, title)
  const branch = `feature/${slug}`
  const requestedBase = input.baseBranch?.trim() || project.mainBranch
  const { branchReady, baseBranch } = await ensureFeatureBranch(project, slug, requestedBase)

  const inserted = ctx.db
    .insert(features)
    .values({
      id: newId('feat'),
      projectId: project.id,
      slug,
      title,
      // The prose IS the one-liner — a quick change never had a separate summary
      // to give, and inventing one would be a second source of truth for it.
      oneLiner: prose,
      mapped: false,
      lap: 1,
      phase: 'implementation' as const,
      branch,
      baseBranch,
      status: 'active' as const,
      createdAt: Date.now(),
    })
    .returning()
    .get()
  const feature = rowToFeature(inserted)

  emit(ctx, feature.id, {
    type: 'feature.created',
    message: branchReady
      ? `feature.created (${branch} ← ${baseBranch})`
      : 'feature.created (branch pending)',
    data: { slug, branch, baseBranch, branchReady },
  })

  scaffoldDocs(ctx, feature, { brief: `# ${title}\n\n${prose}\n` })

  const [ticket] = storeTickets(ctx, feature.id, [
    {
      title,
      goal: prose,
      context: prose,
      acceptanceCriteria: [prose],
      // No invented seams: nobody read the codebase to name them.
      seams: [],
      blockedBy: [],
    },
  ])

  // The one event that makes the fast path legible in the timeline — the row
  // itself carries no marker, so without this the feature simply appears at
  // `implementation` with no account of how it got past G1 and G2.
  emit(ctx, feature.id, {
    type: 'feature.quick_change',
    message: `quick change — born at implementation on lap 1 with one ticket (#${ticket.seq}); no grill session, no spec.md`,
    ticketId: ticket.id,
    data: { slug, ticketSeq: ticket.seq, phase: 'implementation' },
  })

  // Same best-effort auto-commit as `createFeature` — an untracked brief dirties
  // the checkout, and a dirty tree is what test-drive and merge both refuse on.
  if (branchReady) {
    try {
      await git.commitDocs(project.repoPath, `runcastle: scaffold ${slug} docs`)
    } catch {
      // best-effort — the brief stays on disk; only the auto-commit is skipped
    }
  }

  return feature
}

/**
 * Create the feature's git branch if B2's git service is available, tolerating
 * its typed stub so the feature is created without a branch pre-B2. When B2
 * lands this transparently starts creating real branches — no caller change.
 */
async function ensureFeatureBranch(
  project: Project,
  slug: string,
  requestedBase: string,
): Promise<{ branchReady: boolean; baseBranch: string }> {
  try {
    const baseBranch = await git.resolveBaseBranch(project, requestedBase)
    await git.createFeatureBranch(project, slug, baseBranch)
    return { branchReady: true, baseBranch }
  } catch (e) {
    // Pre-B2 the git service is a stub — the feature is created branchless and
    // the requested base is recorded as-is (resolution happens when B2 lands).
    if (isNotImplemented(e)) return { branchReady: false, baseBranch: requestedBase }
    throw e
  }
}

export function getFeatureFull(ctx: AppCtx, id: string): FeatureFull {
  const feature = getFeatureRow(ctx, id)
  // Waypoints are a mapped-feature concept; unmapped features carry none, so we
  // skip the query entirely and return empty collections.
  const waypoints = feature.mapped ? listWaypoints(ctx, id) : []
  const frontierIds = feature.mapped ? frontier(ctx, id).map((w) => w.id) : []
  return {
    feature,
    tickets: listByFeature(ctx, id),
    sessions: listSessionsByFeature(ctx, id),
    runs: listRunsByFeature(ctx, id),
    docs: listDocs(ctx, feature),
    gate: gateState(ctx, feature),
    waypoints,
    frontierIds,
  }
}

export function list(ctx: AppCtx, projectId: string): FeatureListItem[] {
  const rows = ctx.db
    .select()
    .from(features)
    .where(eq(features.projectId, projectId))
    .orderBy(desc(features.createdAt))
    .all()

  return rows.map((row) => {
    const feature = rowToFeature(row)
    const tickets = listByFeature(ctx, feature.id)
    const counts: TicketCounts = {
      total: tickets.length,
      pending: tickets.filter((t) => t.status === 'pending').length,
      burning: tickets.filter((t) => t.status === 'burning').length,
      done: tickets.filter((t) => t.status === 'done').length,
      failed: tickets.filter((t) => t.status === 'failed').length,
      cancelled: tickets.filter((t) => t.status === 'cancelled').length,
    }
    return { ...feature, ticketCounts: counts, activeRun: hasActiveRun(ctx, feature.id) }
  })
}

/** Attempt the gate guarding the next phase; advance or throw with the reason. */
export function advance(ctx: AppCtx, featureId: string): Feature {
  const feature = getFeatureRow(ctx, featureId)
  const gate = nextGate(feature)
  if (!gate) throw new GateError('feature is already at the final phase')

  // G3 (tickets → implementation) is the human "Burn" gate — the first click of
  // CONTEXT.md's two-click covenant (#9). Even when its precondition
  // (`tickets-approved`: ≥1 ticket) is met, a plain `advance` must NOT cross it;
  // only `burn` (the human Burn click) or an explicit `overrideGate` may. This
  // keeps `feature.burn` the single legitimate G3 crossing.
  if (gate.id === 'G3') {
    throw new GateError('G3 is the human Burn gate — click Burn to approve and burn the tickets')
  }

  const result = checkGate(ctx, gate.check, feature)
  if (!result.satisfied) {
    throw new GateError(result.reason ?? `gate ${gate.id} not satisfied`)
  }

  const next = nextPhase(feature)
  if (!next) throw new GateError('feature is already at the final phase')
  return setPhase(ctx, featureId, next, 'phase.advanced')
}

/**
 * G3 burn — the human "Burn" click, the ONLY legitimate G3 crossing.
 *
 * From phase `tickets` (the normal case) this crosses G3: sets phase
 * `implementation` and starts the ticket-burner run. It also accepts a feature
 * already at `implementation` with NO active run — a run that was cancelled,
 * crashed, or finished with failures left the feature parked there — and
 * (re)starts the burn without re-crossing any gate, so that state never
 * dead-ends. On restart every ticket a dead run left `burning` is failed first
 * (no run is live, so nothing is behind it), then every `failed` ticket is
 * reset to `pending` (error cleared) so the re-burn actually retries it — this
 * is the retry path the burner's "resolve manually, then re-burn" messages
 * promise. Requires ≥1 non-cancelled ticket.
 *
 * It also accepts a feature at `review` with ≥1 pending (non-terminal) ticket
 * and no active run — the Iterate loop (CONTEXT.md decision #7): fresh fix
 * tickets emitted during review loop the phase back to `implementation` so the
 * run executes them, and the G4 auto-advance returns the feature to `review`
 * when they finish. Repeatable until the human clicks Merge & ship.
 */
export async function burn(
  ctx: AppCtx,
  featureId: string,
  opts: { modelOverride?: string; resetFailed?: boolean } = {},
): Promise<{ runId: string }> {
  const feature = getFeatureRow(ctx, featureId)
  const running = hasActiveRun(ctx, featureId)
  let tickets = listByFeature(ctx, featureId)
  // G3 scopes to the CURRENT lap (SPEC §15.1) — an earlier lap's tickets are
  // terminal by construction, so counting them would let a fresh lap burn
  // nothing. `lapTickets` is that scope; the restarting path below deliberately
  // ignores it.
  const lapTickets = tickets.filter((t) => t.lap === feature.lap)
  // A ticket the burner still has to run: not done/failed/cancelled (the
  // terminal states). Fresh fix tickets from an Iterate session land as `pending`.
  const pending = lapTickets.filter(
    (t) => t.status !== 'done' && t.status !== 'failed' && t.status !== 'cancelled',
  )
  const restarting = feature.phase === 'implementation' && !running
  const iterating = feature.phase === 'review' && !running && pending.length >= 1

  if (feature.phase !== 'tickets' && !restarting && !iterating) {
    let why: string
    if (running) why = 'a run is already burning this feature'
    else if (feature.phase === 'review')
      why = 'no pending tickets to burn — emit fix tickets before burning from review'
    else why = `feature must be in the tickets phase to burn (currently ${feature.phase})`
    throw new GateError(why)
  }
  if (lapTickets.filter((t) => t.status !== 'cancelled').length < 1) {
    throw new GateError(
      lapTickets.length > 0
        ? 'no burnable tickets — every ticket is cancelled'
        : 'no tickets to burn',
    )
  }

  if (restarting) {
    // No run is live (that is what `restarting` means), so a ticket still
    // marked `burning` is an orphan from a run that died without finalizing —
    // fail it first so the reset below can pick it up. Without this the
    // scheduler (which only queues `pending`) skips it and the re-burn returns
    // instantly with "N-1/N tickets done", leaving the ticket stuck forever.
    sweepOrphanedBurning(ctx, featureId, 'orphaned — the previous run died while it was burning')
    tickets = listByFeature(ctx, featureId)
    // `resetFailed: false` is the selective-retry path (retryTicket already
    // reset exactly the tickets it wants burned — the rest stay failed).
    //
    // Deliberately UNSCOPED by lap, unlike the G3 checks above: resuming a dead
    // burn is about rescuing whatever the run left broken, so an earlier lap's
    // failed ticket is retried here too. Only the decision to START a burn is a
    // lap question.
    const failed = opts.resetFailed === false ? [] : tickets.filter((t) => t.status === 'failed')
    for (const t of failed) {
      // Keep `attemptBranch` (the re-burn resumes from the preserved commits)
      // and `conflictFiles` (a ticket that only failed to LAND gets its
      // conflict resolved rather than re-implemented).
      updateTicket(ctx, t.id, { status: 'pending', error: null })
    }
    emit(ctx, featureId, {
      type: 'burn.restarted',
      message:
        failed.length > 0
          ? `restarting burn — retrying ${failed.length} failed ticket(s)`
          : 'restarting burn (previous run cancelled or crashed)',
      data: { retried: failed.map((t) => t.seq) },
    })
  } else if (iterating) {
    // Loop back review → implementation (the pipeline's one backward transition)
    // so the run picks up the fresh pending tickets. G4 auto-advance closes the
    // loop back to review when they finish.
    setPhase(ctx, featureId, REVIEW_LOOP_BACK.to, 'burn.started', 'burn from review — iterating')
  } else {
    setPhase(ctx, featureId, 'implementation', 'burn.started', 'burning tickets')
  }
  const { runId } = await startRun(ctx, featureId, 'ticket-burner', {
    modelOverride: opts.modelOverride,
  })
  return { runId }
}

/**
 * Rethink — the review → ideation loop back that starts lap N+1 (ADR-0010 §1,
 * SPEC §15.2). Where Fix (`burn` from review) says the spec was right and the
 * code wasn't, Rethink says the opposite: the drive taught us something the
 * spec does not know yet, so the feature goes back to ideation to digest it.
 *
 * Increments `lap` and sets the phase to `ideation`, emitting `lap.started`.
 * Nothing else moves: earlier laps' tickets, sessions and events keep their lap
 * tag and the trail is derived by grouping on it (there is no laps table).
 *
 * Every guard runs BEFORE the mutation. The session guard especially: the
 * caller launches the lap's terminal right after this returns, and a launch the
 * one-terminal-per-feature guard would refuse must not leave the feature already
 * bumped onto a lap with no session to work it.
 */
export function rethink(ctx: AppCtx, featureId: string): Feature {
  const feature = getFeatureRow(ctx, featureId)
  if (feature.phase !== RETHINK_LOOP_BACK.from) {
    throw new GateError(
      `feature must be in the review phase to rethink (currently ${feature.phase})`,
    )
  }
  if (hasActiveRun(ctx, featureId)) {
    throw new GateError('a run is burning this feature — cancel or wait for it before rethinking')
  }
  const live = activeSessionsForFeature(ctx, featureId)
  if (live.length > 0) {
    throw new GateError(
      `a ${live[0].kind} session is already live for ${feature.slug} — only one terminal per feature; end or resume it first`,
    )
  }

  const lap = feature.lap + 1
  ctx.db.update(features).set({ lap }).where(eq(features.id, featureId)).run()
  return setPhase(ctx, featureId, RETHINK_LOOP_BACK.to, 'lap.started', `rethink — lap ${lap}`)
}

/**
 * Retry ONE failed ticket (UI lane action). Resets the ticket — and every
 * failed ticket in its transitive `blockedBy` closure, since a dependent can
 * only burn once its blockers are redone — to `pending`, then starts a burn if
 * none is live. Other failed tickets stay failed (unlike the whole-feature
 * re-burn, which retries everything).
 *
 * `fresh` discards the ticket's preserved work — EVERY attempt branch of this
 * ticket (the recorded one plus any orphans a pre-`attemptBranch` burn left),
 * `attemptBranch` and `conflictFiles` cleared — so the new agent starts from the
 * feature branch tip. Blockers reset alongside it keep their chains — only the
 * named ticket starts over.
 *
 * A ticket that failed on a LANDING CONFLICT keeps its `conflictFiles`, which is
 * what makes the burner resolve the conflict instead of re-implementing the
 * ticket (`resolvingConflict` in the result says so, for the caller's copy).
 * "Retry fresh" is the escape hatch that throws the conflicted work away and
 * re-implements from the current tip.
 *
 * When the ticket has NO recorded `attemptBranch` (it failed before the column
 * existed, or the db was reset), the fallback lookup
 * (`git.findPreservedTicketBranch`) checks the ticket's deterministic branch
 * prefix for leftover unmerged work and adopts it, so the button rescues old
 * failures too.
 *
 * Refused while a run is live: the running scheduler snapshotted its ticket
 * set at start and would never pick the reset ticket up, which would strand it
 * `pending` with no agent coming.
 */
export async function retryTicket(
  ctx: AppCtx,
  ticketId: string,
  opts: { fresh?: boolean } = {},
): Promise<{
  runId: string
  retried: number[]
  /** Branch the retry will resume from (recorded or adopted), or null. */
  resumedFrom: string | null
  /** Commits preserved on that branch (0 when starting clean). */
  preservedCommits: number
  /** True when this retry resolves a landing conflict rather than re-implementing. */
  resolvingConflict: boolean
}> {
  const ticket = getTicket(ctx, ticketId)
  const feature = getFeatureRow(ctx, ticket.featureId)
  if (ticket.status !== 'failed') {
    throw new GateError(`only failed tickets can be retried — ticket ${ticket.seq} is ${ticket.status}`)
  }
  if (hasActiveRun(ctx, feature.id)) {
    throw new GateError('a run is live for this feature — retry after it finishes, or cancel it first')
  }
  const project = projectForFeature(ctx, feature)

  const all = listByFeature(ctx, feature.id)
  const bySeq = new Map(all.map((t) => [t.seq, t]))

  // Transitive failed-blocker closure: retrying a dependent without its failed
  // blockers would just cascade it straight back to failed.
  const toReset = new Map<number, Ticket>([[ticket.seq, ticket]])
  const queue = [ticket.seq]
  while (queue.length > 0) {
    const t = bySeq.get(queue.shift() as number)
    if (!t) continue
    for (const b of t.blockedBy) {
      const blocker = bySeq.get(b)
      if (blocker && blocker.status === 'failed' && !toReset.has(blocker.seq)) {
        toReset.set(blocker.seq, blocker)
        queue.push(blocker.seq)
      }
    }
  }

  let resumedFrom: string | null = ticket.attemptBranch ?? null
  let preservedCommits = 0
  if (opts.fresh) {
    const discard = new Set(
      await git.listTicketAttemptBranches(project.repoPath, feature.slug, ticket.seq),
    )
    if (ticket.attemptBranch) discard.add(ticket.attemptBranch)
    for (const b of discard) await git.deleteTempBranch(project.repoPath, b) // best-effort
    resumedFrom = null
  } else if (resumedFrom) {
    preservedCommits = (
      await git.branchCommitsAhead(project.repoPath, feature.branch, resumedFrom)
    ).length
  } else {
    const found = await git.findPreservedTicketBranch(
      project.repoPath,
      feature.branch,
      feature.slug,
      ticket.seq,
    )
    if (found) {
      resumedFrom = found.branch
      preservedCommits = found.commits.length
    }
  }

  // A landing conflict survives a plain retry (the burner resolves it) but not
  // a fresh one (the work it described is being discarded).
  const resolvingConflict = !opts.fresh && ticket.conflictFiles !== undefined && !!resumedFrom

  for (const t of toReset.values()) {
    const isTarget = t.id === ticket.id
    updateTicket(ctx, t.id, {
      status: 'pending',
      error: null,
      // Record an adopted branch / clear on fresh — the burner reads this
      // pointer to base the new attempt; blockers keep whatever they have.
      ...(isTarget ? { attemptBranch: resumedFrom } : {}),
      ...(isTarget && !resolvingConflict ? { conflictFiles: null } : {}),
    })
  }

  const seqs = [...toReset.keys()].sort((a, b) => a - b)
  const how = opts.fresh
    ? ' from scratch'
    : resolvingConflict
      ? ` — resolving its conflict with ${feature.branch} (${preservedCommits} commit(s) preserved on ${resumedFrom})`
      : resumedFrom
        ? ` from ${preservedCommits} preserved commit(s) on ${resumedFrom}`
        : ''
  emit(ctx, feature.id, {
    type: 'ticket.retry',
    message:
      seqs.length > 1
        ? `retrying ticket ${ticket.seq}${how} (+ failed blocker${seqs.length > 2 ? 's' : ''} ${seqs.filter((s) => s !== ticket.seq).join(', ')})`
        : `retrying ticket ${ticket.seq}${how}`,
    ticketId: ticket.id,
    data: { retried: seqs, fresh: !!opts.fresh, resumedFrom, preservedCommits, resolvingConflict },
  })

  const { runId } = await burn(ctx, feature.id, { resetFailed: false })
  return { runId, retried: seqs, resumedFrom, preservedCommits, resolvingConflict }
}

export interface EscalateResult {
  ok: true
  /** Set (with no other effect) when the feature was already mapped. */
  warning?: string
}

/**
 * Escalate a grilling session into a map (ADR-0001 / SPEC §13.3): flip `mapped`,
 * scaffold `map.md` seeded from the caller's Destination/Notes, emit an event.
 *
 * Idempotent: a second call on an already-mapped feature warns and makes NO
 * changes — no re-scaffold (which would anyway be a no-op) and no event. The
 * first chart wins, so re-escalating never clobbers the accumulated map.
 */
export function escalateToMap(
  ctx: AppCtx,
  featureId: string,
  input: { destination: string; notes?: string },
): EscalateResult {
  const feature = getFeatureRow(ctx, featureId)
  if (feature.mapped) {
    return { ok: true, warning: `feature ${feature.slug} is already mapped — no changes made` }
  }

  const project = projectForFeature(ctx, feature)
  ctx.db.update(features).set({ mapped: true }).where(eq(features.id, featureId)).run()
  scaffoldMapDoc(project, { ...feature, mapped: true }, input)

  emit(ctx, featureId, {
    type: 'feature.escalated',
    message: `grilling escalated to a map (destination: ${input.destination})`,
    data: { destination: input.destination },
  })
  return { ok: true }
}

/**
 * Archive a feature (decision #8): allowed from any phase and any status except
 * an already-archived one. Ends any live session first (the same PTY-killing
 * teardown the End-session button uses), flips status to `archived`, and emits
 * `feature.archived`. All data is kept — archiving only hides the feature behind
 * the sidebar's show-archived filter; `unarchiveFeature` reverses it.
 */
export function archiveFeature(ctx: AppCtx, featureId: string): Feature {
  const feature = getFeatureRow(ctx, featureId)
  if (feature.status === 'archived') {
    throw new GateError(`feature ${feature.slug} is already archived`)
  }

  // End any live session — an archived feature must not keep a terminal alive.
  const live = listSessionsByFeature(ctx, featureId).find((s) => s.status === 'live')
  if (live) endSession(ctx, live.id)

  ctx.db.update(features).set({ status: 'archived' }).where(eq(features.id, featureId)).run()
  emit(ctx, featureId, {
    type: 'feature.archived',
    message: `feature ${feature.slug} archived`,
    data: { from: feature.status },
  })
  return { ...feature, status: 'archived' }
}

/**
 * Unarchive a feature (decision #8): restore its pre-archive status, derived
 * from the phase — a feature that reached `shipped` is restored to `shipped`,
 * everything else to `active` (status only ever holds those three values, so
 * deriving is exact). Emits `feature.unarchived`.
 */
export function unarchiveFeature(ctx: AppCtx, featureId: string): Feature {
  const feature = getFeatureRow(ctx, featureId)
  if (feature.status !== 'archived') {
    throw new GateError(`feature ${feature.slug} is not archived`)
  }

  const restored: FeatureStatus = feature.phase === 'shipped' ? 'shipped' : 'active'
  ctx.db.update(features).set({ status: restored }).where(eq(features.id, featureId)).run()
  emit(ctx, featureId, {
    type: 'feature.unarchived',
    message: `feature ${feature.slug} unarchived (${restored})`,
    data: { status: restored },
  })
  return { ...feature, status: restored }
}

/**
 * Permanently delete a NON-SHIPPED feature (decision #8), cleaning up everything
 * runcastle created for it. Shipped features are refused — their branch is merged
 * into the base, so deleting their rows would orphan the record of shipped work
 * (archive covers those). Committed `docs/features/<slug>/` history is left
 * untouched: no removal commit, no history rewrite — branch deletion orphans the
 * branch-side doc commits naturally, and anything already on the base stays.
 *
 * Cleanup order stops live things first and deletes DB rows LAST, so a failure
 * mid-cleanup (e.g. a locked talk worktree on Windows) throws with the feature
 * row still present and the whole operation retryable:
 *   1. cancel an active run   2. end a live session   3. stop THIS feature's test
 *   drive   4. remove the talk worktree (throws on a locked/failed removal)
 *   5. delete feature + runcastle temp branches   6. emit a PROJECT-scoped
 *   `feature.deleted` (a feature-scoped event would die with the rows)
 *   7. remove session artifact dirs + delete all DB rows keyed by the feature.
 */
export async function deleteFeature(
  ctx: AppCtx,
  featureId: string,
): Promise<{ ok: true; slug: string }> {
  const feature = getFeatureRow(ctx, featureId)
  if (feature.status === 'shipped') {
    throw new GateError(
      `feature ${feature.slug} is shipped — archive it instead (delete is for non-shipped features)`,
    )
  }
  const project = projectForFeature(ctx, feature)

  // (1) Cancel any in-flight run — abort its signal before we tear the rest down.
  for (const run of listRunsByFeature(ctx, featureId)) {
    if (run.status === 'running') cancelRun(run.id)
  }

  // (2) End a live session (the same PTY-killing teardown Archive uses).
  const live = listSessionsByFeature(ctx, featureId).find((s) => s.status === 'live')
  if (live) endSession(ctx, live.id)

  // (3) Stop a test drive of THIS feature — it holds the main checkout on the
  // feature branch, which would block the branch delete (a drive of another
  // feature is left alone).
  if (git.activeTestDriveFeatureId() === featureId) {
    await git.testDrive(ctx, project, feature, 'stop')
  }

  // (4) Remove the talk worktree — throws on a locked/failed removal so DB rows
  // stay put below and the delete is retryable rather than half-applied.
  await git.removeTalkWorktree(project.repoPath, worktreeDir(project.id, feature.slug))

  // (5) Delete feature/<slug> + matching runcastle temp branches (best-effort;
  // an orphaned branch never fails the delete).
  await git.deleteFeatureBranches(project.repoPath, feature.slug)

  // (6) Announce on the PROJECT stream BEFORE the rows go — a feature-scoped
  // event would be deleted along with the feature it describes.
  emitProject(ctx, project.id, {
    type: 'feature.deleted',
    message: `feature ${feature.slug} deleted`,
    data: { featureId, slug: feature.slug },
  })

  // (7) Remove per-session artifact dirs, then delete all DB rows LAST.
  for (const s of listSessionsByFeature(ctx, featureId)) {
    try {
      rmSync(sessionDir(s.id), { recursive: true, force: true })
    } catch {
      // best-effort — a stray artifact dir is harmless; the DB rows still go
    }
  }
  deleteFeatureRows(ctx, featureId)

  return { ok: true, slug: feature.slug }
}

/**
 * Delete every DB row keyed by `featureId` — tickets, sessions, runs, events,
 * gate overrides, waypoints — then the feature row itself. Feature-scoped events
 * die here; the project-scoped `feature.deleted` (featureId null) survives.
 */
function deleteFeatureRows(ctx: AppCtx, featureId: string): void {
  ctx.db.delete(tickets).where(eq(tickets.featureId, featureId)).run()
  ctx.db.delete(sessions).where(eq(sessions.featureId, featureId)).run()
  ctx.db.delete(runs).where(eq(runs.featureId, featureId)).run()
  ctx.db.delete(events).where(eq(events.featureId, featureId)).run()
  ctx.db.delete(gateOverrides).where(eq(gateOverrides.featureId, featureId)).run()
  ctx.db.delete(waypoints).where(eq(waypoints.featureId, featureId)).run()
  ctx.db.delete(features).where(eq(features.id, featureId)).run()
}

function gateState(ctx: AppCtx, feature: Feature): FeatureGateState {
  const gate = nextGate(feature)
  if (!gate) return { next: null, satisfied: false }
  const result = checkGate(ctx, gate.check, feature)
  return { next: gate, satisfied: result.satisfied, reason: result.reason }
}

function uniqueSlug(ctx: AppCtx, projectId: string, title: string): string {
  const base = slugify(title)
  const existing = new Set(
    ctx.db
      .select({ slug: features.slug })
      .from(features)
      .where(eq(features.projectId, projectId))
      .all()
      .map((r) => r.slug),
  )
  if (!existing.has(base)) return base
  let n = 2
  while (existing.has(`${base}-${n}`)) n += 1
  return `${base}-${n}`
}

/** lowercase, non-alphanumeric runs → single hyphen, trimmed. */
function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'feature'
}
