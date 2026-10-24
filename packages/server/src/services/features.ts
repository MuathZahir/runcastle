import type {
  BlockRef,
  DependencyRef,
  Feature,
  FeatureStatus,
  Project,
  ReadyDeclaration,
  Run,
  SessionRow,
  SessionStatus,
  Ticket,
} from '@runcastle/core'
import { newId } from '@runcastle/core'
import { sessionDir, worktreeDir } from '@runcastle/core/paths'
import { asc, desc, eq, or } from 'drizzle-orm'
import { rmSync } from 'node:fs'
import type { AppCtx } from '../db/types'
import {
  events,
  featureDependencies,
  features,
  readyDeclarations,
  runs,
  sessions,
  tickets,
} from '../db/schema'
import { GateError, InvalidInputError, isNotImplemented } from '../errors'
import {
  blocksOf,
  dependencyMaps,
  dependentsOf,
  dependsOnOf,
  describeBlocker,
  waitingOn,
} from './dependencies'
import { emit, emitProject, latestEventTs, latestTsByFeature, upNextProblems } from './events'
import { retireArchivedWorktree } from './feature-worktrees'
import * as git from './git'
import { listDocs, previewSummary, scaffoldDocs } from './knowledge'
import { deliverToLead } from './lead-delivery'
import { latestBurn, runClaimedTicketIds } from './runs'
import { refreshLeadTokens } from './usage'
import type { DocSummary, PreviewSummary, ScaffoldOptions } from './knowledge'
import {
  getFeatureRow,
  hasActiveRun,
  listRunsByFeature,
  listSessionsByFeature,
  projectForFeature,
  requireProjectById,
  rowToFeature,
} from './repo'
import { activeSessionsForFeature } from '../launcher/sessions'
import { endSession } from '../pty/end-session'
import {
  getTicket,
  isPendingTicket,
  listByFeature,
  sweepOrphanedBurning,
  updateTicket,
} from './tickets'
import { cancelRun, startRun } from '../workflows/runner'

/**
 * Feature service (SPEC §3/§4): create, aggregate read, rounds, burn. Git branch creation is B2's; `createFeature` tolerates the B2 stub via
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

/**
 * A feature's open terminal, as the triage lanes read it (decisions §3): is one
 * open at all, and is its agent mid-turn or waiting on the human? `activeRun`
 * answers the same question for the unattended burner; this is the HITL half,
 * which the list simply did not carry.
 */
export interface LiveSessionState {
  /** `launching` while the terminal opens, `live` once Claude Code reported in. */
  status: Extract<SessionStatus, 'launching' | 'live'>
  /** The agent finished its turn and is waiting on the human (the `Stop` hook). */
  awaitingInput: boolean
}

export interface FeatureListItem extends Feature {
  /** Every ticket, by status — the red dot reads `failed`. */
  ticketCounts: TicketCounts
  activeRun: boolean
  /**
   * The feature's open session, or null when it has none — an ended session
   * clears this entirely, because a conversation nobody is in is not a claim on
   * anyone's attention.
   */
  liveSession: LiveSessionState | null
  /**
   * When this feature last did anything — its newest event's `ts`, falling back
   * to `createdAt` when it has no events yet. The sidebar row's relative stamp
   * ("10m") reads this: `createdAt` alone answers when the feature was made,
   * which is not the question a triage rail is asked.
   */
  lastActivityAt: number
  /** What this feature waits on (ADR-0013), each with its derived `satisfied`. */
  dependsOn: DependencyRef[]
  /** The drafts this feature is still holding up — empty once it has merged. */
  blocks: BlockRef[]
  /** Why an up-next draft did not start by itself (newest since the mark was set), else null. */
  upNextProblem: string | null
}

export interface FeatureFull {
  feature: Feature
  tickets: Ticket[]
  sessions: SessionRow[]
  runs: Run[]
  docs: DocSummary[]
  /** null when the feature's docs dir has no preview.html */
  preview: PreviewSummary | null
  dependsOn: DependencyRef[]
  blocks: BlockRef[]
  /** See {@link FeatureListItem.upNextProblem}. */
  upNextProblem: string | null
}

export interface CreateFeatureInput {
  /** The project the feature belongs to (multi-project, issue #43). */
  projectId: string
  title: string
  oneLiner: string
  /**
   * Branch to fork `feature/<slug>` off, and the branch it later merges back
   * into. Any existing local branch is valid (the current branch, a release
   * line, another feature). Every shipped caller states one; omitting it falls
   * back to the project checkout's current branch, never a stored default
   * (decision 2).
   */
  baseBranch?: string
  /**
   * Body for `brief.md`, verbatim instead of the generated title + one-liner
   * stub. The project session passes the reasoning it just worked out with the
   * human (decision 19) — without it that reasoning evaporates when the intake
   * terminal closes, and the burner reads a restated one-liner instead.
   */
  brief?: string
  /**
   * Park the feature instead of starting it (decision 2): insert the row at
   * status `draft` and do no git or filesystem work at all — no branch, no docs,
   * no commit. `baseBranch` is ignored on this path; the base is chosen and
   * resolved later, when the human clicks Start (decision 3).
   */
  draft?: boolean
}

export async function createFeature(
  ctx: AppCtx,
  input: CreateFeatureInput,
): Promise<Feature> {
  const project = requireProjectById(ctx, input.projectId)
  const slug = uniqueSlug(ctx, project.id, input.title)
  const branch = `feature/${slug}`

  const { cut, baseBranch, status } = await parkOrCut(ctx, project, slug, input)

  const row = {
    id: newId('feat'),
    projectId: project.id,
    slug,
    title: input.title,
    oneLiner: input.oneLiner,
    // Only a draft parks its brief in the column (decision 4); a live create
    // writes it straight to `brief.md`, the source of truth from then on.
    brief: cut ? null : (input.brief ?? null),
    // The branch NAME is recorded even for a draft (decision 2); `status:
    // 'draft'` alone means the branch does not exist in the repo yet.
    branch,
    baseBranch,
    status,
    createdAt: Date.now(),
  }
  const inserted = ctx.db.insert(features).values(row).returning().get()
  const feature = rowToFeature(inserted)

  emitFeatureCreated(ctx, feature, cut)

  // A draft is a DB row and nothing else (decision 4) — no docs on disk and no
  // commit until Start, so parked scribbles never land on the current branch.
  if (!cut) return feature

  await scaffoldDocsOnFeatureBranch(ctx, project, feature, { brief: input.brief })

  return feature
}

/** The branch a creation door cut: its resolved base, and whether git made it. */
type BranchCut = { branchReady: boolean; baseBranch: string }

/**
 * Park or cut — the one decision every creation door makes. A draft cuts nothing
 * (decision 3): its base is chosen and resolved later, at Start. Otherwise the
 * stored base is the RESOLVED local branch (a remote pick materialized a local
 * tracking branch), always a real merge target at ship time. `cut` is null for a
 * draft; `baseBranch` and `status` are the row's columns derived from it.
 */
async function parkOrCut(
  ctx: AppCtx,
  project: Project,
  slug: string,
  input: { draft?: boolean; baseBranch?: string },
): Promise<{ cut: BranchCut | null; baseBranch: string | null; status: 'active' | 'draft' }> {
  if (input.draft) return { cut: null, baseBranch: null, status: 'draft' }
  const cut = await ensureFeatureBranch(ctx, project, slug, await requestedBase(ctx, project, input.baseBranch))
  return { cut, baseBranch: cut.baseBranch, status: 'active' }
}

/**
 * The birth event every creation door emits — `cut` is the branch it cut, or
 * null for a draft, which cuts nothing until Start.
 */
function emitFeatureCreated(ctx: AppCtx, feature: Feature, cut: BranchCut | null): void {
  const { slug, branch } = feature
  emit(ctx, feature.id, {
    type: 'feature.created',
    message: !cut
      ? `feature.created (draft — ${branch} not cut yet)`
      : cut.branchReady
        ? `feature.created (${branch} ← ${cut.baseBranch})`
        : 'feature.created (branch pending)',
    data: {
      slug,
      branch,
      baseBranch: cut?.baseBranch,
      branchReady: cut?.branchReady ?? false,
      draft: !cut,
    },
  })
}

/**
 * The canonical draft refusal (decision 8). A draft's verb set is Start and
 * delete; every door that treats the feature as live calls this first, so the
 * human gets one consistent message pointing at the button that fixes it rather
 * than an incidental git failure about a branch that was never cut.
 */
export function requireNotDraft(feature: Feature): void {
  if (feature.status === 'draft') {
    throw new GateError(`\`${feature.slug}\` is in the backlog — click Start to cut its branch and begin`)
  }
}

/**
 * Start a parked draft (decision 7): resolve the base AT THIS MOMENT (an
 * explicit pick, else the checkout's current branch — see {@link requestedBase}),
 * cut `feature/<slug>`, scaffold `brief.md` from the parked
 * column and auto-commit it, then flip the row to `active` with the resolved
 * base and emit `feature.started`.
 *
 * The git work happens BEFORE the db update on purpose: no rollback machinery
 * is needed because a branch-cut failure propagates with the draft untouched,
 * still parked and still startable once the human resolves the cause.
 */
export async function startDraft(
  ctx: AppCtx,
  featureId: string,
  opts: { baseBranch?: string; autoStartedBy?: string } = {},
): Promise<Feature> {
  const feature = getFeatureRow(ctx, featureId)
  if (feature.status !== 'draft') {
    throw new GateError(`feature ${feature.slug} is not in the backlog — it has already been started`)
  }
  // Merge-order dependencies (ADR-0013) gate exactly this click, before any git
  // work. No override: the way past an archived blocker is removing the edge.
  const blockers = waitingOn(ctx, featureId)
  if (blockers.length) {
    throw new GateError(`\`${feature.slug}\` waits on ${blockers.map(describeBlocker).join(', ')}`)
  }
  const project = projectForFeature(ctx, feature)
  const base = await requestedBase(ctx, project, opts.baseBranch)

  const { branchReady, baseBranch } = await ensureFeatureBranch(ctx, project, feature.slug, base)

  ctx.db
    .update(features)
    .set({ status: 'active', baseBranch, upNext: false })
    .where(eq(features.id, featureId))
    .run()
  const started: Feature = { ...feature, status: 'active', baseBranch, upNext: false }

  emit(ctx, featureId, {
    type: 'feature.started',
    message: opts.autoStartedBy
      ? `feature ${feature.slug} started by itself: \`${opts.autoStartedBy}\` shipped (${feature.branch} ← ${baseBranch})`
      : branchReady
        ? `feature ${feature.slug} started (${feature.branch} ← ${baseBranch})`
        : `feature ${feature.slug} started (branch pending)`,
    data: {
      branch: feature.branch,
      baseBranch,
      branchReady,
      ...(opts.autoStartedBy ? { autoStartedBy: opts.autoStartedBy } : {}),
    },
  })

  // The brief parked in the column becomes the file, through the same verbatim
  // scaffold path create uses — and onto the feature branch, the same way.
  await scaffoldDocsOnFeatureBranch(ctx, project, started, { brief: feature.brief })

  return started
}

/**
 * The base a feature is cut from: what the caller named, else the branch the
 * project checkout is standing on (decision 2). Never a stored project default —
 * a base nobody chose, that no surface showed, is exactly what this replaced.
 * Every shipped surface names one, so the fallback is a backstop, not a path.
 */
async function requestedBase(
  ctx: AppCtx,
  project: Project,
  picked: string | undefined,
): Promise<string> {
  return (
    picked?.trim() ||
    (await git.currentCheckoutBranch(project, () => {
      emitProject(ctx, project.id, {
        type: 'repo.head_healed',
        message: 'created runcastle: initial commit so branches can be cut',
      })
    }))
  )
}

/**
 * Create the feature's git branch if B2's git service is available, tolerating
 * its typed stub so the feature is created without a branch pre-B2. When B2
 * lands this transparently starts creating real branches — no caller change.
 */
async function ensureFeatureBranch(
  ctx: AppCtx,
  project: Project,
  slug: string,
  base: string,
): Promise<BranchCut> {
  try {
    const reportHeal = (): void => {
      emitProject(ctx, project.id, {
        type: 'repo.head_healed',
        message: 'created runcastle: initial commit so branches can be cut',
      })
    }
    const baseBranch = await git.resolveBaseBranch(project, base, reportHeal)
    await git.createFeatureBranch(project, slug, baseBranch, reportHeal)
    return { branchReady: true, baseBranch }
  } catch (e) {
    // Pre-B2 the git service is a stub — the feature is created branchless and
    // the requested base is recorded as-is (resolution happens when B2 lands).
    if (isNotImplemented(e)) return { branchReady: false, baseBranch: base }
    throw e
  }
}

/**
 * Scaffold the feature's docs and commit them onto the FEATURE branch — the one
 * step every creation door shares (create, Start a draft).
 *
 * The work happens inside the feature's talk worktree, which is git's own
 * checkout of `feature/<slug>`, and never in the human's checkout. Committing at
 * `project.repoPath` landed the scaffold on whatever branch the human happened
 * to be standing on — in practice `main` — so `feature/<slug>` reached its grill
 * session carrying no `brief.md`, and the ideation agent re-derived a design the
 * intake conversation had already settled.
 *
 * Ensuring the worktree first is also what puts the docs where the rest of the
 * app looks for them: `featureDocsDir` prefers the worktree when it exists, so
 * the scaffold, the docs list and every later session read one copy of the docs,
 * on the branch that owns them.
 *
 * Best-effort throughout, like every other docs checkpoint: neither a worktree
 * that cannot be created nor a commit hiccup may cost the human their feature.
 */
async function scaffoldDocsOnFeatureBranch(
  ctx: AppCtx,
  project: Project,
  feature: Feature,
  opts: ScaffoldOptions,
): Promise<void> {
  let worktreePath: string
  try {
    worktreePath = await git.ensureTalkWorktree(project, feature, () => {
      emit(ctx, feature.id, {
        type: 'repo.head_healed',
        message: 'created runcastle: initial commit so branches can be cut',
      })
    })
  } catch (e) {
    // Pre-B2 the git service is a stub: no branch was cut and no worktree can be,
    // so the docs stay in the checkout, uncommitted, exactly as they did then.
    if (isNotImplemented(e)) {
      scaffoldDocs(ctx, feature, opts)
      return
    }
    emit(ctx, feature.id, {
      type: 'docs.scaffold_failed',
      message: `docs not scaffolded onto ${feature.branch}: ${e instanceof Error ? e.message : String(e)}`,
    })
    return
  }

  scaffoldDocs(ctx, feature, opts)
  try {
    await git.commitDocs(
      worktreePath,
      git.docsCommitMessage(`scaffold ${feature.slug} docs`, project.docsCommitPrefix),
    )
  } catch {
    // best-effort — the docs sit in the worktree; only the auto-commit is skipped
  }
}

export function getFeatureFull(ctx: AppCtx, id: string): FeatureFull {
  const feature = getFeatureRow(ctx, id)
  // Telemetry only (decision 25): the lead's tokens are recorded as it works, never returned.
  refreshLeadTokens(ctx, id, { lazy: true })
  return {
    feature,
    tickets: listByFeature(ctx, id),
    sessions: listSessionsByFeature(ctx, id).map((session) =>
      session.kind === 'chat' && session.status === 'ended' && !session.ccSessionId
        ? { ...session, title: null, transcriptMissing: true }
        : session,
    ),
    runs: listRunsByFeature(ctx, id),
    docs: listDocs(ctx, feature),
    preview: previewSummary(ctx, feature),
    dependsOn: dependsOnOf(ctx, id),
    blocks: blocksOf(ctx, id),
    upNextProblem: feature.upNext && feature.status === 'draft'
      ? (upNextProblems(ctx, feature.projectId).get(id) ?? null)
      : null,
  }
}

export function list(ctx: AppCtx, projectId: string): FeatureListItem[] {
  const rows = ctx.db
    .select()
    .from(features)
    .where(eq(features.projectId, projectId))
    .orderBy(desc(features.createdAt))
    .all()

  const lastActivity = latestTsByFeature(ctx, projectId)
  const projectFeatures = rows.map(rowToFeature)
  const deps = dependencyMaps(ctx, projectId, projectFeatures)
  const problems = upNextProblems(ctx, projectId)

  return projectFeatures.map((feature) => {
    const tickets = listByFeature(ctx, feature.id)
    const counts: TicketCounts = {
      total: tickets.length,
      pending: tickets.filter((t) => t.status === 'pending').length,
      burning: tickets.filter((t) => t.status === 'burning').length,
      done: tickets.filter((t) => t.status === 'done').length,
      failed: tickets.filter((t) => t.status === 'failed').length,
      cancelled: tickets.filter((t) => t.status === 'cancelled').length,
    }
    return {
      ...feature,
      ticketCounts: counts,
      activeRun: hasActiveRun(ctx, feature.id),
      liveSession: liveSessionOf(ctx, feature.id),
      lastActivityAt: lastActivity.get(feature.id) ?? feature.createdAt,
      dependsOn: deps.dependsOn.get(feature.id) ?? [],
      blocks: deps.blocks.get(feature.id) ?? [],
      upNextProblem: feature.upNext && feature.status === 'draft' ? (problems.get(feature.id) ?? null) : null,
    }
  })
}

/**
 * The feature's open terminal for {@link FeatureListItem.liveSession}. One
 * live HITL session per feature is the launcher's guard, so the pick only
 * matters while a second terminal is coming up: the one that reached `live`
 * wins, because it is the one somebody is actually talking to. A scenario chat
 * is docked to the drive, not the feature, so it is never the feature's session.
 */
function liveSessionOf(ctx: AppCtx, featureId: string): LiveSessionState | null {
  // A side session's turns are its own errand, and a scenario chat is docked to
  // the drive: the feature's line speaks for the main chat
  // (several-sessions-per-feature decision 12).
  const open = activeSessionsForFeature(ctx, featureId).filter((s) => s.kind !== 'side' && s.kind !== 'scenario')
  const session = open.find((s) => s.status === 'live') ?? open[0]
  // `activeSessionsForFeature` never returns an ended row; the check is what
  // narrows the status to the two this reports, without a cast.
  if (!session || session.status === 'ended') return null
  return { status: session.status, awaitingInput: session.awaitingInput }
}

/**
 * Restart the burn over the feature's pending tickets — the engine under the
 * run lane's per-ticket retry ({@link retryTicket}), which has already reset
 * exactly the tickets it wants burned. Rounds start through
 * {@link dispatchRound}; this is never a door of its own.
 *
 * No run is live (refused first), so a ticket still marked `burning` is an
 * orphan from a run that died without finalizing — it is failed first, so the
 * scheduler (which only queues `pending`) never strands it.
 */
export async function burn(ctx: AppCtx, featureId: string): Promise<{ runId: string }> {
  const feature = getFeatureRow(ctx, featureId)
  requireNotDraft(feature)
  // One burn at a time on a feature branch (ADR-0002).
  if (hasActiveRun(ctx, featureId)) throw new GateError('a run is already burning this feature')
  const tickets = listByFeature(ctx, featureId)
  if (!tickets.some(isPendingTicket)) {
    throw new GateError(tickets.length > 0 ? 'no pending tickets to burn' : 'no tickets to burn')
  }
  sweepOrphanedBurning(ctx, featureId, 'orphaned — the previous run died while it was burning')
  emit(ctx, featureId, { type: 'burn.restarted', message: 'restarting burn' })
  // Only the id crosses the seam — `startRun` also hands back a `done` promise
  // the caller must not await (the run finishes long after the click returns).
  const { runId } = await startRun(ctx, featureId, 'ticket-burner')
  return { runId }
}

export { markHumanMessage, setWaiting } from './lead-status'

/**
 * Dispatch a round (decision 13): one ticket-burner run over exactly the named
 * tickets; every other pending ticket waits for a later round. The engine
 * underneath is the burn's, unchanged.
 *
 * The only hard refusals, each saying why: the feature is a draft or has
 * shipped, a round is already running, a drive of this feature holds the drive
 * slot (decision 19), the human pressed Stop and has not replied since
 * (decision 23), a seq that is unknown or has nothing left to burn, or a named
 * ticket blocked by one outside the round that is not `done`/`cancelled` (or
 * does not exist) — the refusal lists every such edge. A named
 * `failed` ticket is reset to `pending` first, as the burn's restart does.
 */
export async function dispatchRound(
  ctx: AppCtx,
  featureId: string,
  seqs: number[],
): Promise<{ runId: string }> {
  const feature = getFeatureRow(ctx, featureId)
  requireNotDraft(feature)
  if (feature.status === 'shipped') throw new GateError(`\`${feature.slug}\` has shipped — there is nothing left to dispatch`)
  if (hasActiveRun(ctx, featureId)) {
    throw new GateError('a round is already running — wait for it to return, or stop it with stop_round')
  }
  const project = projectForFeature(ctx, feature)
  if (git.activeTestDriveFeatureId(project.id) === featureId) {
    throw new GateError('the human is test-driving this feature — no round starts until the drive stops')
  }
  if (feature.stoppedAt !== null && !((feature.lastHumanMessageAt ?? 0) > feature.stoppedAt)) {
    throw new GateError('Stopped by the human — wait for their reply')
  }
  if (seqs.length === 0) throw new InvalidInputError('name at least one ticket seq to dispatch')

  // No run is live (refused above), so a `burning` row is an orphan of a dead run.
  sweepOrphanedBurning(ctx, featureId, 'orphaned — the previous run died while it was burning')
  const bySeq = new Map(listByFeature(ctx, featureId).map((t) => [t.seq, t]))
  const named = [...new Set(seqs)].map((seq) => {
    const ticket = bySeq.get(seq)
    if (!ticket) throw new GateError(`ticket ${seq} does not exist on this feature`)
    if (ticket.status !== 'pending' && ticket.status !== 'failed') {
      throw new GateError(`ticket ${seq} is ${ticket.status} — only pending (or failed) tickets can be dispatched`)
    }
    return ticket
  })
  // A blocker outside the round must already be finished (decisions 1, 3, 5).
  const namedSeqs = new Set(named.map((t) => t.seq))
  const unmet: string[] = []
  for (const t of [...named].sort((a, b) => a.seq - b.seq)) {
    for (const b of [...t.blockedBy].sort((x, y) => x - y)) {
      if (namedSeqs.has(b)) continue
      const blocker = bySeq.get(b)
      if (!blocker) {
        unmet.push(`ticket ${t.seq} is blocked by ticket ${b}, which does not exist on this feature`)
      } else if (blocker.status !== 'done' && blocker.status !== 'cancelled') {
        unmet.push(
          `ticket ${t.seq} is blocked by ticket ${b}, which is not in this round and is ${blocker.status} — name ${b} in this round as well`,
        )
      }
    }
  }
  if (unmet.length > 0) throw new GateError(`this round cannot start: ${unmet.join('; ')}`)
  for (const t of named) {
    // Keep `attemptBranch`/`conflictFiles` so the retry resumes, as burn()'s restart does.
    if (t.status === 'failed') updateTicket(ctx, t.id, { status: 'pending', error: null })
  }

  const { runId } = await startRun(ctx, featureId, 'ticket-burner', { ticketIds: named.map((t) => t.id) })
  ctx.db
    .update(features)
    .set({ lastDispatchAt: Date.now(), waitingReason: null })
    .where(eq(features.id, featureId))
    .run()
  emit(ctx, featureId, {
    type: 'round.dispatched',
    message: `round dispatched over ${named.map((t) => `#${t.seq}`).join(', ')}`,
    runId,
    data: { seqs: named.map((t) => t.seq) },
  })
  return { runId }
}

/** The feature's running round, or a refusal saying there is none. */
function requireRunningRound(ctx: AppCtx, featureId: string): Run {
  const run = listRunsByFeature(ctx, featureId).find((r) => r.status === 'running')
  if (!run) throw new GateError('no round is running')
  return run
}

/**
 * Stop the running round (decision 15): its agents are killed and the run reads
 * cancelled; work that already landed stays on the feature branch.
 */
export async function stopRound(ctx: AppCtx, featureId: string): Promise<{ runId: string; confirmed: boolean }> {
  const run = requireRunningRound(ctx, featureId)
  const { confirmed } = await cancelRun(run.id)
  emit(ctx, featureId, {
    type: 'round.stopped',
    message: confirmed ? 'round stopped' : 'round stopped — an agent of it may still be running',
    runId: run.id,
    data: { confirmed },
  })
  return { runId: run.id, confirmed }
}

/**
 * The human's Stop (decision 23): stop the running round if there is one, set
 * the stopped mark so nothing new is dispatched until the human replies, and
 * tell the lead. The status reads "Waiting for you · stopped".
 *
 * The mark lands and emits first: killing a round's sandboxes can take seconds,
 * and the status the human just pressed beside must not wait them out.
 */
export async function stopFeature(ctx: AppCtx, featureId: string): Promise<Feature> {
  const feature = getFeatureRow(ctx, featureId)
  requireNotDraft(feature)
  const running = listRunsByFeature(ctx, featureId).find((r) => r.status === 'running')
  ctx.db
    .update(features)
    .set({ stoppedAt: Date.now(), waitingReason: 'stopped' })
    .where(eq(features.id, featureId))
    .run()
  emit(ctx, featureId, {
    type: 'feature.stopped',
    message: running ? 'stopped by the human — cancelling the round' : 'stopped by the human',
    data: { runId: running?.id ?? null },
  })
  const stopped = running ? await stopRound(ctx, featureId) : null
  const updated = getFeatureRow(ctx, featureId)
  await deliverToLead(ctx, updated, {
    text:
      `[runcastle] The human pressed Stop${stopped ? ' — the running round was cancelled; landed work stays' : ''}. ` +
      'Dispatch nothing until the human replies.',
    source: 'runcastle',
  })
  return updated
}

/** The feature's ready declarations, oldest first. */
export function listReadyDeclarations(ctx: AppCtx, featureId: string): ReadyDeclaration[] {
  return ctx.db
    .select()
    .from(readyDeclarations)
    .where(eq(readyDeclarations.featureId, featureId))
    .orderBy(asc(readyDeclarations.createdAt), asc(readyDeclarations.id))
    .all()
}

/**
 * The lead declares the feature ready for the human: the record goes on the
 * trail and the feature waits on the human ("ready to test"), which clears like
 * any waiting reason — on their next message or the next round. What to test
 * and how the work was checked the lead says in chat; the declaration carries
 * only the scenario the Test drive button starts. A declaration, never a gate:
 * what the human should hear about comes back as warnings the lead must relay.
 */
export function declareReady(
  ctx: AppCtx,
  featureId: string,
  input: { scenario: string },
): { declaration: ReadyDeclaration; warnings: string[] } {
  const feature = getFeatureRow(ctx, featureId)
  requireNotDraft(feature)
  if (feature.status === 'shipped') throw new GateError(`\`${feature.slug}\` has already shipped`)
  const scenario = input.scenario.trim()
  if (!scenario) throw new InvalidInputError('a ready declaration needs a scenario')

  const lastRound = latestBurn(ctx, featureId)
  const declaration = ctx.db
    .insert(readyDeclarations)
    .values({
      id: newId('ready'),
      featureId,
      runId: lastRound?.id ?? null,
      scenario,
      createdAt: Date.now(),
    })
    .returning()
    .get()
  // Under Needs you until the human replies or a round runs; the event below speaks for it.
  ctx.db.update(features).set({ waitingReason: 'ready to test' }).where(eq(features.id, featureId)).run()

  const warnings = readyWarnings(ctx, lastRound)
  emit(ctx, featureId, {
    type: 'feature.ready_declared',
    message: `ready for you · test drive ▸ ${scenario}`,
    data: { declarationId: declaration.id, runId: declaration.runId, scenario, warnings },
  })
  return { declaration, warnings }
}

/**
 * What the lead must tell the human alongside "Ready for you": a last round
 * that did not come back clean. Whether a review ran is the lead's call, and it
 * says how the work was checked in chat, so its absence is not a warning.
 */
function readyWarnings(ctx: AppCtx, lastRound: Run | undefined): string[] {
  if (!lastRound) return []
  const held = new Set(runClaimedTicketIds(ctx, lastRound.id))
  const failed =
    lastRound.status !== 'succeeded' ||
    listByFeature(ctx, lastRound.featureId).some((t) => held.has(t.id) && t.status === 'failed')
  return failed ? ['the last round had failures — tell the human what failed before they drive it.'] : []
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
 *
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
  // blockers would just cascade it straight back to failed. A failed REVIEW
  // blocker is reset like any other — the blocked dependent is a fix ticket the
  // review minted, and the scheduler no longer counts those against the review's
  // own gate, so the reset pair burns in order instead of deadlocking.
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

  const { runId } = await burn(ctx, feature.id)
  return { runId, retried: seqs, resumedFrom, preservedCommits, resolvingConflict }
}

/**
 * Archive a feature (decision #8): allowed from any status except a draft or
 * an already-archived one. Ends any live session first (the same PTY-killing
 * teardown the End-session button uses), flips status to `archived`, and emits
 * `feature.archived`. All data is kept — archiving only hides the feature behind
 * the sidebar's show-archived filter; `unarchiveFeature` reverses it. The talk
 * worktree goes too when it is clean (a relaunch after unarchive re-adds it);
 * the branch is never touched.
 */
/**
 * End every session still up on the feature. Not just one: side sessions
 * (several-sessions-per-feature) run beside the main chat, and each holds a
 * terminal of its own.
 */
function endLiveSessions(ctx: AppCtx, featureId: string): void {
  for (const session of activeSessionsForFeature(ctx, featureId)) endSession(ctx, session.id)
}

export async function archiveFeature(ctx: AppCtx, featureId: string): Promise<Feature> {
  const feature = getFeatureRow(ctx, featureId)
  // Archive is refused for drafts (decision 8): `unarchiveFeature` derives the
  // restored status from the merge record and would resurrect a draft as
  // active-without-a-branch. A draft IS the shelf; delete covers dead ideas.
  requireNotDraft(feature)
  if (feature.status === 'archived') {
    throw new GateError(`feature ${feature.slug} is already archived`)
  }

  // End any live session — an archived feature must not keep a terminal alive.
  endLiveSessions(ctx, featureId)

  ctx.db.update(features).set({ status: 'archived' }).where(eq(features.id, featureId)).run()
  emit(ctx, featureId, {
    type: 'feature.archived',
    message: `feature ${feature.slug} archived`,
    data: { from: feature.status },
  })
  await retireArchivedWorktree(ctx, projectForFeature(ctx, feature), feature)
  return { ...feature, status: 'archived' }
}

/**
 * Unarchive a feature (decision #8): restore its pre-archive status, derived
 * from the record of its merge — a feature whose merge landed (`feature.shipped`)
 * is restored to `shipped`, everything else to `active` (a draft is never
 * archived, so deriving is exact). Emits `feature.unarchived`.
 */
export function unarchiveFeature(ctx: AppCtx, featureId: string): Feature {
  const feature = getFeatureRow(ctx, featureId)
  if (feature.status !== 'archived') {
    throw new GateError(`feature ${feature.slug} is not archived`)
  }

  const merged = latestEventTs(ctx, featureId, 'feature.shipped') !== undefined
  const restored: FeatureStatus = merged ? 'shipped' : 'active'
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

  // (1) Cancel any in-flight run — and wait for its agents to actually die
  // before we tear the rest down: a container still holding the worktree open
  // is exactly what makes step (4)'s removal fail on Windows.
  for (const run of listRunsByFeature(ctx, featureId)) {
    if (run.status === 'running') await cancelRun(run.id)
  }

  // (2) End the live sessions (the same PTY-killing teardown Archive uses).
  endLiveSessions(ctx, featureId)

  // (3) Stop a test drive of THIS feature — it holds the main checkout on the
  // feature branch, which would block the branch delete (a drive of another
  // feature is left alone).
  if (git.activeTestDriveFeatureId(project.id) === featureId) {
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

  // Each dependent's timeline records the edge the delete is about to cascade
  // away — otherwise a draft would silently stop waiting.
  for (const dependent of dependentsOf(ctx, featureId)) {
    emit(ctx, dependent.id, {
      type: 'feature.dependency.deleted',
      message: `dependency \`${feature.slug}\` deleted`,
      data: { featureId, slug: feature.slug },
    })
  }

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
 * dependency edges in both directions — then the feature row itself.
 * Feature-scoped events die here; the project-scoped `feature.deleted`
 * (featureId null) survives. Edges are deleted explicitly rather than left to
 * the FK cascade, which only fires where `foreign_keys` is on.
 */
function deleteFeatureRows(ctx: AppCtx, featureId: string): void {
  ctx.db
    .delete(featureDependencies)
    .where(
      or(
        eq(featureDependencies.dependentId, featureId),
        eq(featureDependencies.dependencyId, featureId),
      ),
    )
    .run()
  ctx.db.delete(tickets).where(eq(tickets.featureId, featureId)).run()
  ctx.db.delete(sessions).where(eq(sessions.featureId, featureId)).run()
  ctx.db.delete(runs).where(eq(runs.featureId, featureId)).run()
  ctx.db.delete(events).where(eq(events.featureId, featureId)).run()
  ctx.db.delete(features).where(eq(features.id, featureId)).run()
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
