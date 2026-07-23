import type {
  Feature,
  GateDef,
  Project,
  Run,
  SessionRow,
  Ticket,
  Waypoint,
} from '@runcastle/core'
import { REVIEW_LOOP_BACK, newId, nextGate, nextPhase } from '@runcastle/core'
import { desc, eq } from 'drizzle-orm'
import type { AppCtx } from '../db/types'
import { features } from '../db/schema'
import { GateError, isNotImplemented } from '../errors'
import { emit } from './events'
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
import { getTicket, listByFeature, updateTicket } from './tickets'
import { frontier, listByFeature as listWaypoints } from './waypoints'
import { startRun } from '../workflows/runner'

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
 * dead-ends. On restart every `failed` ticket is reset to `pending` (error
 * cleared) so the re-burn actually retries it — this is the retry path the
 * burner's "resolve manually, then re-burn" messages promise. Requires ≥1
 * non-cancelled ticket.
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
  const tickets = listByFeature(ctx, featureId)
  // A ticket the burner still has to run: not done/failed/cancelled (the
  // terminal states). Fresh fix tickets from an Iterate session land as `pending`.
  const pending = tickets.filter(
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
  if (tickets.filter((t) => t.status !== 'cancelled').length < 1) {
    throw new GateError(
      tickets.length > 0 ? 'no burnable tickets — every ticket is cancelled' : 'no tickets to burn',
    )
  }

  if (restarting) {
    // `resetFailed: false` is the selective-retry path (retryTicket already
    // reset exactly the tickets it wants burned — the rest stay failed).
    const failed = opts.resetFailed === false ? [] : tickets.filter((t) => t.status === 'failed')
    for (const t of failed) {
      // Keep `attemptBranch`: the re-burn resumes from the preserved commits.
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
 * Retry ONE failed ticket (UI lane action). Resets the ticket — and every
 * failed ticket in its transitive `blockedBy` closure, since a dependent can
 * only burn once its blockers are redone — to `pending`, then starts a burn if
 * none is live. Other failed tickets stay failed (unlike the whole-feature
 * re-burn, which retries everything).
 *
 * `fresh` discards the ticket's preserved work — EVERY attempt branch of this
 * ticket (the recorded one plus any orphans a pre-`attemptBranch` burn left),
 * `attemptBranch` cleared — so the new agent starts from the feature branch
 * tip. Blockers reset alongside it keep their chains — only the named ticket
 * starts over.
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

  for (const t of toReset.values()) {
    const isTarget = t.id === ticket.id
    updateTicket(ctx, t.id, {
      status: 'pending',
      error: null,
      // Record an adopted branch / clear on fresh — the burner reads this
      // pointer to base the new attempt; blockers keep whatever they have.
      ...(isTarget ? { attemptBranch: resumedFrom } : {}),
    })
  }

  const seqs = [...toReset.keys()].sort((a, b) => a - b)
  const how = opts.fresh
    ? ' from scratch'
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
    data: { retried: seqs, fresh: !!opts.fresh, resumedFrom, preservedCommits },
  })

  const { runId } = await burn(ctx, feature.id, { resetFailed: false })
  return { runId, retried: seqs, resumedFrom, preservedCommits }
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
