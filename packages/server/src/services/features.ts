import type {
  BlockRef,
  DependencyRef,
  Feature,
  FeatureNeed,
  FeatureStatus,
  Project,
  ReadyDeclaration,
  Run,
  SessionRow,
  SessionStatus,
  Ticket,
} from '@runcastle/core'
import { isProviderHaltReason, newId, PROVIDER_HALT_CLEARED, READY_TO_TEST, STOPPED } from '@runcastle/core'
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
  workers,
} from '../db/schema'
import { GateError, InvalidInputError } from '../errors'
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
import { refreshFeatureTokens } from './usage'
import type { DocSummary, PreviewSummary, ScaffoldOptions } from './knowledge'
import { needEventsByProject, needOf } from './feature-need'
import {
  getFeatureRow,
  getProjectById,
  listRunsByFeature,
  listSessionsByFeature,
  projectForFeature,
  requireProjectById,
  rowToFeature,
} from './repo'
import { activeSessionsForFeature, featureSessions } from '../launcher/sessions'
import { endSession } from '../pty/end-session'
import { leadState, NO_LEAD } from '../threads/read'
import { agentHost } from '../threads/types'
import { listByFeature, ticketStatusCounts } from './tickets'
import { removeFeatureWorkers, stopFeatureWorkers, workerProgressByFeature, workersHoldingReady, workersPageByFeature, workersWorkingByFeature } from '../workers/service'

/**
 * Feature service (SPEC §3/§4): create, aggregate read, rounds. Git branch
 * creation goes through `ensureFeatureBranch`.
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
 * open at all, and is its agent mid-turn or waiting on the human?
 * `workersWorking` answers the same question for the feature's workers.
 */
export interface LiveSessionState {
  /** `launching` while the terminal opens, `live` once Claude Code reported in. */
  status: Extract<SessionStatus, 'launching' | 'live'>
  /** The agent finished its turn and is waiting on the human (the `Stop` hook). */
  awaitingInput: boolean
}

export interface FeatureListItem extends Feature {
  /** Every ticket of its frozen history, by status: the progress pie of a feature built before workers. */
  ticketCounts: TicketCounts
  /** How many of its workers are working or queued right now. */
  workersWorking: number
  /** Its build workers (with you, on its own) not dropped, and how many landed: the progress pie of a feature built with workers. */
  workerProgress: { counted: number; landed: number }
  /**
   * Its workers page, for the arrow on its sidebar row
   * (clicking-a-feature-opens-its-lead decisions 4, 5): `inPlay` workers need
   * the human or are at work. Null when the page would list nothing, and the
   * row has no arrow.
   */
  workersPage: { inPlay: number } | null
  /**
   * The feature's open session, or null when it has none — an ended session
   * clears this entirely, because a conversation nobody is in is not a claim on
   * anyone's attention.
   */
  liveSession: LiveSessionState | null
  /** The lead replied, or asks, and the human has not answered (`leadState`, decision 15). */
  leadAwaitsHuman: boolean
  /** The lead replied and its background work still runs: Agent working, not Waiting on you. */
  leadInBackground: boolean
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
  /** The one thing it waits on the human for, or null (`services/feature-need.ts`). */
  need: FeatureNeed | null
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
  /** See {@link FeatureListItem.leadAwaitsHuman}: the header reads the sidebar's answer. */
  leadAwaitsHuman: boolean
  /** See {@link FeatureListItem.need}: the header, the sidebar and the pings read one answer. */
  need: FeatureNeed | null
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
   * stub. The orchestrator passes the reasoning it just worked out with the
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

/** Create the feature's git branch off the resolved base. */
async function ensureFeatureBranch(
  ctx: AppCtx,
  project: Project,
  slug: string,
  base: string,
): Promise<BranchCut> {
  const reportHeal = (): void => {
    emitProject(ctx, project.id, {
      type: 'repo.head_healed',
      message: 'created runcastle: initial commit so branches can be cut',
    })
  }
  const baseBranch = await git.resolveBaseBranch(project, base, reportHeal)
  await git.createFeatureBranch(project, slug, baseBranch, reportHeal)
  return { branchReady: true, baseBranch }
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
  // Telemetry only (decision 25): every conversation's tokens are recorded as it works, never returned.
  refreshFeatureTokens(ctx, id, { mode: 'lazy' })
  const lead = leadState(ctx, id)
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
    leadAwaitsHuman: lead.awaitsHuman,
    need: needOf(ctx, feature, { lead }),
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
  const ticketStatuses = ticketStatusCounts(ctx, projectId)
  const working = workersWorkingByFeature(ctx, projectId)
  const workerShares = workerProgressByFeature(ctx, projectId)
  const workerPages = workersPageByFeature(ctx, projectId)
  const needEvents = needEventsByProject(ctx, projectId)
  const driveConfigured = !!getProjectById(ctx, projectId)?.devCommand

  return projectFeatures.map((feature) => {
    const byStatus = ticketStatuses.get(feature.id)
    const counts: TicketCounts = {
      total: [...(byStatus?.values() ?? [])].reduce((sum, n) => sum + n, 0),
      pending: byStatus?.get('pending') ?? 0,
      burning: byStatus?.get('burning') ?? 0,
      done: byStatus?.get('done') ?? 0,
      failed: byStatus?.get('failed') ?? 0,
      cancelled: byStatus?.get('cancelled') ?? 0,
    }
    // Only a feature in flight has a lead to wait on: nothing reads this of the
    // others, and asking would read the log of every feature ever shipped.
    const lead = feature.status === 'active' ? leadState(ctx, feature.id) : NO_LEAD
    return {
      ...feature,
      ticketCounts: counts,
      workersWorking: working.get(feature.id) ?? 0,
      workerProgress: workerShares.get(feature.id) ?? { counted: 0, landed: 0 },
      workersPage: workerPages.get(feature.id) ?? null,
      liveSession: liveSessionOf(ctx, feature.id),
      leadAwaitsHuman: lead.awaitsHuman,
      leadInBackground: lead.inBackground,
      lastActivityAt: lastActivity.get(feature.id) ?? feature.createdAt,
      dependsOn: deps.dependsOn.get(feature.id) ?? [],
      blocks: deps.blocks.get(feature.id) ?? [],
      upNextProblem: feature.upNext && feature.status === 'draft' ? (problems.get(feature.id) ?? null) : null,
      need: needOf(ctx, feature, { events: needEvents.get(feature.id) ?? [], lead, driveConfigured }),
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
  // A side session's and a worker's turns are their own errands (a drive worker is a worker):
  // the feature's line speaks for the main chat
  // (several-sessions-per-feature decision 12).
  const open = activeSessionsForFeature(ctx, featureId).filter((s) => s.kind !== 'side' && s.kind !== 'worker' && s.kind !== 'scenario')
  const session = open.find((s) => s.status === 'live') ?? open[0]
  // `activeSessionsForFeature` never returns an ended row; the check is what
  // narrows the status to the two this reports, without a cast.
  if (!session || session.status === 'ended') return null
  return { status: session.status, awaitingInput: session.awaitingInput }
}

export { markHumanMessage, setWaiting } from './lead-status'

/** Refuse the lead's starts while the human's Stop stands: nothing starts until they reply (decision 15). */
export function requireNotStopped(feature: Pick<Feature, 'stoppedAt' | 'lastHumanMessageAt'>): void {
  if (feature.stoppedAt !== null && !((feature.lastHumanMessageAt ?? 0) > feature.stoppedAt)) {
    throw new GateError('Stopped by the human — wait for their reply')
  }
}

/**
 * The human's Stop (burns-become-workers decision 15): end the lead's turn,
 * cancel the turn of every working or queued worker (they stay where they are,
 * enterable), set the stopped
 * mark so nothing new starts until the human replies, and tell the lead with
 * that reply. The status reads "Waiting for you · stopped".
 *
 * The mark lands and emits first: cancelling turns and killing a round's
 * sandboxes can take seconds, and the status the human just pressed beside
 * must not wait them out.
 */
export async function stopFeature(ctx: AppCtx, featureId: string): Promise<Feature> {
  const feature = getFeatureRow(ctx, featureId)
  requireNotDraft(feature)
  ctx.db
    .update(features)
    .set({ stoppedAt: Date.now(), waitingReason: STOPPED, waitingKind: null })
    .where(eq(features.id, featureId))
    .run()
  emit(ctx, featureId, {
    type: 'feature.stopped',
    message: 'stopped by the human',
  })
  await stopFeatureWorkers(ctx, featureId)
  for (const chat of featureSessions(ctx, featureId, ['chat'])) {
    await agentHost(ctx)
      .cancel(chat.id)
      .catch((err) => console.error(`chat ${chat.id}: stop`, err))
  }
  const updated = getFeatureRow(ctx, featureId)
  await deliverToLead(ctx, updated, {
    text:
      `[runcastle] The human pressed Stop: your turn and every working worker's were cancelled. ` +
      'Start, message or send back no worker until the human replies.',
    source: 'runcastle',
    // Its turn is over: the note rides the human's reply and wakes nothing.
    reason: 'news',
  })
  return updated
}

/**
 * Resume after a provider halt (small-fixes-before-publish decisions 10, 16):
 * the human says the limit, billing or sign-in problem is cleared, and the lead
 * gets one message from them — which, as a human message, clears the waiting
 * reason. The lead decides whether to dispatch again. Refused unless the feature
 * waits on a provider halt.
 */
export async function resumeFeature(ctx: AppCtx, featureId: string): Promise<Feature> {
  const feature = getFeatureRow(ctx, featureId)
  if (!isProviderHaltReason(feature.waitingReason)) {
    throw new GateError('this feature is not waiting on the provider — there is nothing to resume')
  }
  emit(ctx, featureId, {
    type: 'feature.resumed',
    message: 'resumed by the human after a provider halt',
    data: { was: feature.waitingReason },
  })
  await deliverToLead(ctx, feature, { text: PROVIDER_HALT_CLEARED, source: 'human' })
  return getFeatureRow(ctx, featureId)
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
 * only the scenario the Test drive button starts. A declaration, never a gate.
 */
export function declareReady(
  ctx: AppCtx,
  featureId: string,
  input: { scenario: string },
): { declaration: ReadyDeclaration } {
  const feature = getFeatureRow(ctx, featureId)
  requireNotDraft(feature)
  if (feature.status === 'shipped') throw new GateError(`\`${feature.slug}\` has already shipped`)
  const scenario = input.scenario.trim()
  if (!scenario) throw new InvalidInputError('a ready declaration needs a scenario')
  refuseWhileWorkersOpen(ctx, featureId)

  const declaration = ctx.db
    .insert(readyDeclarations)
    .values({
      id: newId('ready'),
      featureId,
      runId: null,
      scenario,
      createdAt: Date.now(),
    })
    .returning()
    .get()
  // Under Needs you until the human replies or a round runs; the event below speaks for it.
  ctx.db.update(features).set({ waitingReason: READY_TO_TEST, waitingKind: null }).where(eq(features.id, featureId)).run()

  emit(ctx, featureId, {
    type: 'feature.ready_declared',
    message: `ready for you · test drive ▸ ${scenario}`,
    data: { declarationId: declaration.id, runId: null, scenario },
  })
  return { declaration }
}

/**
 * No "ready" while a worker works or holds work that has not landed
 * (interactive-workers decision 19): the refusal names each and what to do.
 */
function refuseWhileWorkersOpen(ctx: AppCtx, featureId: string): void {
  const open = workersHoldingReady(ctx, featureId)
  if (!open.length) return
  const named = open.map((w) => `"${w.label}" (${w.id}, ${w.status})`).join(', ')
  throw new GateError(
    `not ready while workers are open: ${named}. Land or drop each handed-back worker, ` +
      'and wait for (or drop) the ones still working, then declare ready again.',
  )
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
  // Each stopped worker keeps a whole copy of the repo; nothing else would clean it up (decision 18).
  await removeFeatureWorkers(ctx, featureId, 'archived')
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
 *   1. (none: rounds are frozen)   2. end a live session   3. stop THIS feature's test
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

  // (1) Nothing is in flight outside the workers (removed in step 2): rounds are frozen history.
  // (2) End the live sessions (the same PTY-killing teardown Archive uses), and
  // remove the workers' containers and branches (interactive-workers decision 18).
  endLiveSessions(ctx, featureId)
  await removeFeatureWorkers(ctx, featureId)

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
  ctx.db.delete(workers).where(eq(workers.featureId, featureId)).run()
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
