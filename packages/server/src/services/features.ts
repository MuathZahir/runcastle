import type {
  Feature,
  FeatureStatus,
  Project,
  Run,
  SessionRow,
  SessionStatus,
  Ticket,
  TicketInput,
  Waypoint,
} from '@runcastle/core'
import {
  newId,
  shapeCheckedTickets,
  ticketShapeWarningLine,
  ticketShapeWarnings,
} from '@runcastle/core'
import { sessionDir, worktreeDir } from '@runcastle/core/paths'
import { desc, eq } from 'drizzle-orm'
import { rmSync } from 'node:fs'
import type { AppCtx } from '../db/types'
import { events, features, runs, sessions, tickets, waypoints } from '../db/schema'
import { GateError, InvalidInputError, isNotImplemented } from '../errors'
import { emit, emitProject, latestEventTs, latestTsByFeature } from './events'
import * as git from './git'
import { listDocs, scaffoldDocs, scaffoldMapDoc } from './knowledge'
import type { DocSummary, ScaffoldOptions } from './knowledge'
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
import {
  carryPendingTicketsIntoLap,
  getTicket,
  isPendingTicket,
  listByFeature,
  storeTickets,
  sweepOrphanedBurning,
  updateTicket,
} from './tickets'
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
}

export interface FeatureFull {
  feature: Feature
  tickets: Ticket[]
  sessions: SessionRow[]
  runs: Run[]
  docs: DocSummary[]
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

  // A draft cuts nothing (decision 3): its base is chosen and resolved later, at
  // Start. Otherwise the stored base is the RESOLVED local branch (a remote pick
  // materialized a local tracking branch), always a real merge target at ship time.
  const cut = input.draft
    ? null
    : await ensureFeatureBranch(project, slug, await requestedBase(project, input.baseBranch))

  const row = {
    id: newId('feat'),
    projectId: project.id,
    slug,
    title: input.title,
    oneLiner: input.oneLiner,
    // Only a draft parks its brief in the column (decision 4); a live create
    // writes it straight to `brief.md`, the source of truth from then on.
    brief: input.draft ? (input.brief ?? null) : null,
    // Every feature is created unmapped; mapping is escalation-only, reached
    // mid-grill via the MCP escalate_to_map tool (no "start mapped" at creation).
    mapped: false,
    // Burn derives and stamps the lap from prior burn runs.
    lap: 1,
    phase: 'planning' as const,
    // The branch NAME is recorded even for a draft (decision 2); `status:
    // 'draft'` alone means the branch does not exist in the repo yet.
    branch,
    baseBranch: cut?.baseBranch ?? null,
    status: cut ? ('active' as const) : ('draft' as const),
    createdAt: Date.now(),
  }
  const inserted = ctx.db.insert(features).values(row).returning().get()
  const feature = rowToFeature(inserted)

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

  // A draft is a DB row and nothing else (decision 4) — no docs on disk and no
  // commit until Start, so parked scribbles never land on the current branch.
  if (!cut) return feature

  await scaffoldDocsOnFeatureBranch(ctx, project, feature, { brief: input.brief })

  return feature
}

/**
 * The canonical draft refusal (decision 8). A draft's verb set is Start and
 * delete; every door that treats the feature as live calls this first, so the
 * human gets one consistent message pointing at the button that fixes it rather
 * than an incidental git failure about a branch that was never cut.
 */
export function requireNotDraft(feature: Feature): void {
  if (feature.status === 'draft') {
    throw new GateError(`\`${feature.slug}\` is a draft — click Start to cut its branch and begin`)
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
  opts: { baseBranch?: string } = {},
): Promise<Feature> {
  const feature = getFeatureRow(ctx, featureId)
  if (feature.status !== 'draft') {
    throw new GateError(`feature ${feature.slug} is not a draft — it has already been started`)
  }
  const project = projectForFeature(ctx, feature)
  const base = await requestedBase(project, opts.baseBranch)

  const { branchReady, baseBranch } = await ensureFeatureBranch(project, feature.slug, base)

  ctx.db
    .update(features)
    .set({ status: 'active', baseBranch })
    .where(eq(features.id, featureId))
    .run()
  const started: Feature = { ...feature, status: 'active', baseBranch }

  emit(ctx, featureId, {
    type: 'feature.started',
    message: branchReady
      ? `feature ${feature.slug} started (${feature.branch} ← ${baseBranch})`
      : `feature ${feature.slug} started (branch pending)`,
    data: { branch: feature.branch, baseBranch, branchReady },
  })

  // The brief parked in the column becomes the file, through the same verbatim
  // scaffold path create uses — and onto the feature branch, the same way.
  await scaffoldDocsOnFeatureBranch(ctx, project, started, { brief: feature.brief })

  return started
}

export interface QuickChangeInput {
  projectId: string
  /** Card title — the rail entry, the docs dir's slug. */
  title: string
  /**
   * One sentence per ticket, in the order the human typed them (decisions.md
   * #4 — real quick work is often several small tickets, not one blob). Each
   * becomes a ticket whose goal AND sole acceptance criterion are that prose.
   * Blank entries are dropped; at least one has to survive.
   */
  tickets: string[]
  /** Same semantics as `CreateFeatureInput.baseBranch`. */
  baseBranch?: string
}

/** How wide a derived ticket title may run before it is cut. */
const TICKET_TITLE_MAX = 72

/**
 * A quick-change ticket's title, derived from its own prose. The ledger lists
 * tickets by title, so N of them all wearing the feature's title would say
 * nothing about which is which. The first line, cut at a word boundary when it
 * runs long — the whole prose survives verbatim as the goal and the criterion.
 */
function quickTicketTitle(prose: string): string {
  const line = prose.split('\n')[0].trim()
  if (line.length <= TICKET_TITLE_MAX) return line
  const cut = line.slice(0, TICKET_TITLE_MAX)
  const space = cut.lastIndexOf(' ')
  return `${(space > 0 ? cut.slice(0, space) : cut).trimEnd()}…`
}

/**
 * `brief.md` for a quick change — the prose verbatim, which is what the burner
 * reads as `{{FEATURE_BRIEF}}`. Several tickets get a heading each, numbered to
 * match the seqs they are stored under; a lone ticket stays one paragraph.
 */
function quickBrief(title: string, proses: string[]): string {
  const body =
    proses.length === 1
      ? proses[0]
      : proses.map((p, i) => `## Ticket ${i + 1}\n\n${p}`).join('\n\n')
  return `# ${title}\n\n${body}\n`
}

/**
 * The review ticket a quick-change batch closes with (decisions.md #9 — "a
 * review always runs", every lap, unconditionally).
 *
 * The tickets skill states that mandate for the sessions that emit batches, but
 * the quick door has no emitting agent to obey it: nobody writes tickets here,
 * the human types sentences and this service turns them into rows. So on this
 * path the invariant has to be code, or it is not enforced at all — which is
 * exactly the hole a quick change fell through, reaching review having never
 * been reviewed.
 *
 * `blockedBy` names every typed ticket by its 1-based batch position — the
 * space `storeTickets` resolves — so it burns last, against the integrated
 * branch. Its prose says what the skill says a hand-written one must: the review
 * runs in exactly one mode, the drive is what varies, and the digest is the
 * lap's summary.
 */
function quickReviewTicket(proses: string[]): TicketInput {
  return {
    title: 'Review the integrated change',
    goal:
      'Review the integrated feature branch and report what you find, in exactly one mode: ' +
      'drive the app in a browser against the criteria below when this change touched something ' +
      'a human can operate and a drive is available, and otherwise run the verify gates and ' +
      "code-review the branch's diff against its base. Write one note per finding; finding bugs " +
      'is a successful review, and the notes are the deliverable.',
    context:
      'This feature came through the quick-change door, so there was no grill session and there ' +
      'is no spec.md or decisions.md to review it against: the whole statement of intent is the ' +
      `${proses.length === 1 ? 'sentence' : `${proses.length} sentences`} the human typed, which ` +
      'are the other tickets in this batch and are reproduced verbatim in brief.md. Nobody ' +
      'prescribed a walkthrough for you either — judge from the diff whether there is anything ' +
      'drivable, and if there is not, take the gates-and-diff mode. Your digest is ' +
      "the lap's prose summary of what landed, and its first line names the mode you ran; the " +
      'review page leads with it.',
    acceptanceCriteria: [
      'Reviewed in one mode — either walked in a browser, or put through the verify gates and ' +
        "code-reviewed on both axes (the repo's own standards, and the change against what was " +
        'asked for).',
      ...proses.map((prose) => `Landed and does what it says: ${prose}`),
    ],
    // Nothing to name: the review agent edits no code, and nobody read the
    // codebase on this path to say which surfaces it touches.
    seams: [],
    blockedBy: proses.map((_, i) => i + 1),
    kind: 'review',
  }
}

/**
 * The quick-change door (decision 21) — work too small to deserve a grill.
 *
 * An ORDINARY feature, born at `planning` with its tickets already emitted,
 * carrying one ticket per sentence the human typed — each ticket's goal, and
 * its sole acceptance criterion, is that sentence — plus the review ticket
 * every batch closes with (see {@link quickReviewTicket}), blocked by all of
 * them. From here it is the lifecycle's far side: review the cards, click Burn,
 * test-drive, click Merge — zero terminals.
 *
 * Nothing on the row marks it (ADR-0010 §7 forbids pipeline-shape settings), so
 * a quick change is indistinguishable from any other planning feature whose
 * tickets are ready to burn — the planning sub-steps it skipped are derived
 * from artifacts, never stored, so skipping them costs it nothing.
 *
 * No `spec.md` and no `decisions.md` are written — there was no conversation to
 * record. `brief.md` carries the prose verbatim, which is what the burner reads
 * as `{{FEATURE_BRIEF}}`.
 */
export async function quickChange(ctx: AppCtx, input: QuickChangeInput): Promise<Feature> {
  const project = requireProjectById(ctx, input.projectId)
  const title = input.title.trim()
  // A blank row is one the human added and left empty, not a ticket — the
  // overlay's list can stay loose because the rule lives here.
  const proses = input.tickets.map((t) => t.trim()).filter((t) => t !== '')
  if (!title) throw new InvalidInputError('a quick change needs a title')
  if (proses.length === 0)
    throw new InvalidInputError('a quick change needs a sentence describing the change')

  const slug = uniqueSlug(ctx, project.id, title)
  const branch = `feature/${slug}`
  const base = await requestedBase(project, input.baseBranch)
  const { branchReady, baseBranch } = await ensureFeatureBranch(project, slug, base)

  const inserted = ctx.db
    .insert(features)
    .values({
      id: newId('feat'),
      projectId: project.id,
      slug,
      title,
      // The first ticket's prose IS the one-liner — a quick change never had a
      // separate summary to give, and inventing one (or a count of the tickets)
      // would be a second source of truth for it. Only its first line, though:
      // `oneLiner` is single-line by name and by every consumer (the hook's
      // status line, the burner's brief header). Every sentence survives
      // verbatim where it belongs — brief.md and the tickets.
      oneLiner: proses[0].split('\n')[0].trim(),
      mapped: false,
      lap: 1,
      // Ready at birth: the tickets below are complete and no session is
      // enriching them. Nothing else would ever say so — only
      // `complete_phase("tickets")` stamps this column, and this path has no
      // session to run it — so it would stay null forever and the planning bar
      // would read every later chat as still finishing these tickets, hiding
      // Burn for as long as its terminal is open. Stamped in the insert rather
      // than via `markTicketsReady`, whose `tickets.awaiting_burn` milestone
      // nothing consumes and whose news `feature.quick_change` already carries.
      // Still a readiness fact and not a marker of the door (ADR-0010 §7).
      ticketsReadyLap: 1,
      phase: 'planning' as const,
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

  await scaffoldDocsOnFeatureBranch(ctx, project, feature, { brief: quickBrief(title, proses) })

  // One batch, not two: the review ticket's `blockedBy` names batch positions,
  // which only resolve against the typed tickets it is stored alongside.
  const stored = storeTickets(ctx, feature.id, [
    ...proses.map((prose) => ({
      title: quickTicketTitle(prose),
      goal: prose,
      context: prose,
      acceptanceCriteria: [prose],
      // No invented seams: nobody read the codebase to name them.
      seams: [],
      blockedBy: [],
    })),
    quickReviewTicket(proses),
  ])
  const typed = stored.slice(0, proses.length)
  const review = stored[stored.length - 1]

  // The one event that makes the fast path legible in the timeline — the row
  // itself carries no marker, so without this the feature simply appears at
  // `planning` with its tickets already written and no account of where they
  // came from. Feature-scoped on purpose: it is the birth of the whole card,
  // not of any one of the tickets it arrived with — `tickets.stored` above
  // already speaks for those. The tally counts what the human typed; the review
  // ticket is named apart from it, because it is the machinery's doing and not
  // theirs.
  const tally = typed.length === 1 ? 'one ticket' : `${typed.length} tickets`
  emit(ctx, feature.id, {
    type: 'feature.quick_change',
    message: `quick change — born at planning on lap 1 with ${tally} (${typed.map((t) => `#${t.seq}`).join(', ')}) plus a review ticket (#${review.seq}); no grill session, no spec.md`,
    data: { slug, ticketSeqs: stored.map((t) => t.seq), phase: 'planning' },
  })

  emitTicketShapeWarnings(ctx, feature.id, stored)

  return feature
}

/**
 * What the quick door just let through, on the feature's timeline — the door
 * the 14-ticket degenerate import came through, which had no validation at all.
 *
 * A warning, never a refusal (see `ticket-shape.ts`): the human typed these
 * sentences and may burn them exactly as they are, so nothing here stops the
 * feature being created or the Burn button working. The Burn card renders the
 * same warnings from the same function, so the sentence the human reads here is
 * the sentence they read again at the moment they decide.
 *
 * It is handed the WHOLE batch, review ticket and all, and `shapeCheckedTickets`
 * drops what nobody typed — the card passes its whole batch too, so the one rule
 * about which tickets get read lives in core with the rules about their shape.
 */
function emitTicketShapeWarnings(ctx: AppCtx, featureId: string, stored: Ticket[]): void {
  const checked = shapeCheckedTickets(stored)
  const warnings = ticketShapeWarnings(checked)
  if (warnings.length === 0) return
  emit(ctx, featureId, {
    type: 'tickets.shape_warning',
    message: `${warnings.length} shape warning${warnings.length === 1 ? '' : 's'} — the burn is not blocked, but a coder reads what is here: ${ticketShapeWarningLine(warnings)}`,
    data: { warnings, seqs: checked.map((t) => t.seq) },
  })
}

/**
 * The base a feature is cut from: what the caller named, else the branch the
 * project checkout is standing on (decision 2). Never a stored project default —
 * a base nobody chose, that no surface showed, is exactly what this replaced.
 * Every shipped surface names one, so the fallback is a backstop, not a path.
 */
async function requestedBase(project: Project, picked: string | undefined): Promise<string> {
  return picked?.trim() || (await git.currentCheckoutBranch(project))
}

/**
 * Create the feature's git branch if B2's git service is available, tolerating
 * its typed stub so the feature is created without a branch pre-B2. When B2
 * lands this transparently starts creating real branches — no caller change.
 */
async function ensureFeatureBranch(
  project: Project,
  slug: string,
  base: string,
): Promise<{ branchReady: boolean; baseBranch: string }> {
  try {
    const baseBranch = await git.resolveBaseBranch(project, base)
    await git.createFeatureBranch(project, slug, baseBranch)
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
 * step every creation door shares (create, Start a draft, quick change).
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
    worktreePath = await git.ensureTalkWorktree(project, feature)
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
  // Waypoints are a mapped-feature concept; unmapped features carry none, so we
  // skip the query entirely and return empty collections.
  const waypoints = feature.mapped ? listWaypoints(ctx, id) : []
  const frontierIds = feature.mapped ? frontier(ctx, id).map((w) => w.id) : []
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

  const lastActivity = latestTsByFeature(ctx, projectId)

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
    return {
      ...feature,
      ticketCounts: counts,
      activeRun: hasActiveRun(ctx, feature.id),
      liveSession: liveSessionOf(ctx, feature.id),
      lastActivityAt: lastActivity.get(feature.id) ?? feature.createdAt,
    }
  })
}

/**
 * The feature's open terminal for {@link FeatureListItem.liveSession}. One
 * live HITL session per feature is the launcher's guard, so the pick only
 * matters while a second terminal is coming up: the one that reached `live`
 * wins, because it is the one somebody is actually talking to.
 */
function liveSessionOf(ctx: AppCtx, featureId: string): LiveSessionState | null {
  const open = activeSessionsForFeature(ctx, featureId)
  const session = open.find((s) => s.status === 'live') ?? open[0]
  // `activeSessionsForFeature` never returns an ended row; the check is what
  // narrows the status to the two this reports, without a cast.
  if (!session || session.status === 'ended') return null
  return { status: session.status, awaitingInput: session.awaitingInput }
}

/**
 * Burn — the first of the two human clicks, and the only mutation that moves a
 * feature into `building`.
 *
 * From `planning` (the normal case) it stamps the lap, sets phase `building`
 * and starts the ticket-burner run. It also accepts a feature already at
 * `building` with NO active run — a run that was cancelled, crashed, or
 * finished with failures left the feature parked there — and (re)starts the
 * burn, so that state never dead-ends. On restart every ticket a dead run left
 * `burning` is failed first (no run is live, so nothing is behind it), then
 * every `failed` ticket is reset to `pending` (error cleared) so the re-burn
 * actually retries it — this is the retry path the burner's "resolve manually,
 * then re-burn" messages promise.
 *
 * It also accepts a feature at `review` with ≥1 pending (non-terminal) ticket
 * and no active run — the Iterate loop (CONTEXT.md, "Laps: iteration without a
 * mode"; cited by name because the locked-decision numbers get renumbered):
 * fresh fix tickets emitted during review are burned from where the feature
 * stands, and the runner's auto-advance returns it to `review` when they
 * finish. Repeatable until the human clicks Merge & ship.
 *
 * Exactly two things refuse: a burn already running on this feature, and git
 * safety (which surfaces as a launch failure). Everything the old gates refused
 * is a warning the operator reads and clicks through. Requires ≥1 non-cancelled
 * ticket — a burn with nothing to burn is a no-op, not a gate, and the UI does
 * not offer it.
 */
export async function burn(
  ctx: AppCtx,
  featureId: string,
  opts: {
    modelOverride?: string
    resetFailed?: boolean
    advanceLap?: boolean
    /** Burn only these tickets, leaving every other pending row for a later burn. */
    onlyTicketIds?: string[]
  } = {},
): Promise<{ runId: string }> {
  const feature = getFeatureRow(ctx, featureId)
  requireNotDraft(feature)
  // One of the two hard rules: one burn at a time on a feature branch
  // (ADR-0002). Refusing first is what lets everything below assume no run.
  if (hasActiveRun(ctx, featureId)) throw new GateError('a run is already burning this feature')
  let tickets = listByFeature(ctx, featureId)
  // A ticket the burner still has to run. Fresh fix tickets from an Iterate
  // session land as `pending`.
  const pending = tickets.filter(isPendingTicket)
  const restarting = feature.phase === 'building'
  const reviewing = feature.phase === 'review' && pending.length >= 1
  const iterating = reviewing && opts.advanceLap !== false

  if (feature.phase !== 'planning' && !restarting && !reviewing) {
    throw new GateError(
      feature.phase === 'review'
        ? 'no pending tickets to burn — emit fix tickets before burning from review'
        : `feature must be planning or in review with pending tickets to burn (currently ${feature.phase})`,
    )
  }
  if (tickets.filter((t) => t.status !== 'cancelled').length < 1) {
    throw new GateError(
      tickets.length > 0 ? 'no burnable tickets — every ticket is cancelled' : 'no tickets to burn',
    )
  }
  // The lap this burn runs in. Burning from review opens the next one — the
  // review being answered closed the last; every other road runs the lap the
  // feature is already on. A restart opens nothing at all: it resumes a run
  // that died mid-lap, and counting runs (a retry is a run of its own) invented
  // a lap for work that never moved. The tickets the click is about to burn are
  // carried onto it, because the session wrote them before the click.
  const lap = iterating ? feature.lap + 1 : feature.lap
  if (iterating) carryPendingTicketsIntoLap(ctx, featureId, feature.lap, lap)
  ctx.db.update(features).set({ lap }).where(eq(features.id, featureId)).run()

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
    // Deliberately UNSCOPED by lap: resuming a dead burn is about rescuing
    // whatever the run left broken, so an earlier lap's failed ticket is
    // retried here too.
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
  } else setPhase(ctx, featureId, 'building', 'burn.started', `burning tickets — lap ${lap}`)
  // Only the id crosses the seam — `startRun` also hands back a `done` promise
  // the caller must not await (the run finishes long after the click returns).
  const { runId } = await startRun(ctx, featureId, 'ticket-burner', {
    modelOverride: opts.modelOverride,
    ...(opts.onlyTicketIds ? { ticketIds: opts.onlyTicketIds } : {}),
  })
  return { runId }
}

/**
 * Did the feature's most recent run record a review drive refused over a dirty
 * working tree?
 *
 * The evidence is the `reviewdrive.denied` event the drive guard emits at the
 * moment it refuses (services/git.ts) — no new ticket status and no new column
 * (decisions §6): a denial never ends a review, it only downgrades it to a
 * repo-only pass, so the ticket ends `done` like any other and the timeline is
 * the only place the refusal is written down.
 *
 * Scoped to the latest run because the record has to be about the review the
 * human is looking at: a denial from an earlier run has already been superseded
 * by a burn that ran after it — including the retry this very check admits, so
 * one denial buys one retry.
 */
export function latestRunDeniedDirty(ctx: AppCtx, featureId: string): boolean {
  const latestRun = listRunsByFeature(ctx, featureId)[0]
  if (!latestRun) return false
  const deniedAt = latestEventTs(ctx, featureId, 'reviewdrive.denied')
  return deniedAt !== undefined && deniedAt >= latestRun.startedAt
}

/** Mint a standalone review pass for the current lap and burn it immediately. */
export async function agenticReview(ctx: AppCtx, featureId: string): Promise<{ runId: string }> {
  const feature = getFeatureRow(ctx, featureId)
  if (hasActiveRun(ctx, feature.id)) {
    throw new GateError('a run is live for this feature — start an agentic review after it finishes')
  }

  const project = projectForFeature(ctx, feature)
  if (latestRunDeniedDirty(ctx, feature.id)) {
    const stillDirty = await git.driveBlockingPaths(project.repoPath, project.docsCommitPrefix)
    if (stillDirty.length > 0) {
      throw new GateError(
        `the working tree is still dirty — the review drive would be denied again. Commit or ` +
          `discard ${stillDirty.length} file(s) first: ${git.truncatedFileList(stillDirty)}`,
      )
    }
  }

  const [ticket] = storeTickets(ctx, feature.id, [
    {
      title: `Agentic review — lap ${feature.lap}`,
      goal: "Perform a full, independent review of this lap's landed work.",
      context: 'Review the complete landed diff and report defects with evidence. Choose the review mode from current availability.',
      acceptanceCriteria: ['The current lap is reviewed in full and every finding is reported.'],
      seams: ['The landed work and its observable acceptance criteria'],
      blockedBy: [],
      kind: 'review',
      passKind: 'review',
    },
  ])
  emit(ctx, feature.id, {
    type: 'review.agentic-minted',
    message: `agentic review minted as ticket ${ticket.seq} for lap ${feature.lap}`,
    ticketId: ticket.id,
    data: { ticketSeq: ticket.seq, lap: feature.lap },
  })
  // Scoped to the ticket just minted: the button asks for another review pass,
  // not for the pending fix queue beside it. An unscoped burn would launch
  // every fix the last review found — code changes nobody clicked Burn for —
  // and then hold the new pass behind them at the review gate. It also lands
  // those fixes on the lap that already burned them, because a review pass
  // opens no lap (decision 7: the mint is FOR the current lap).
  return burn(ctx, feature.id, {
    resetFailed: false,
    advanceLap: false,
    onlyTicketIds: [ticket.id],
  })
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
  // Archive is refused for drafts (decision 8): `unarchiveFeature` derives the
  // restored status from the phase and would resurrect a draft as
  // active-without-a-branch. A draft IS the shelf; delete covers dead ideas.
  requireNotDraft(feature)
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

  // (1) Cancel any in-flight run — and wait for its agents to actually die
  // before we tear the rest down: a container still holding the worktree open
  // is exactly what makes step (4)'s removal fail on Windows.
  for (const run of listRunsByFeature(ctx, featureId)) {
    if (run.status === 'running') await cancelRun(run.id)
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
 * waypoints — then the feature row itself. Feature-scoped events
 * die here; the project-scoped `feature.deleted` (featureId null) survives.
 */
function deleteFeatureRows(ctx: AppCtx, featureId: string): void {
  ctx.db.delete(tickets).where(eq(tickets.featureId, featureId)).run()
  ctx.db.delete(sessions).where(eq(sessions.featureId, featureId)).run()
  ctx.db.delete(runs).where(eq(runs.featureId, featureId)).run()
  ctx.db.delete(events).where(eq(events.featureId, featureId)).run()
  ctx.db.delete(waypoints).where(eq(waypoints.featureId, featureId)).run()
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
