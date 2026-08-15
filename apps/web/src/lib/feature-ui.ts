import { nextPhase, parsePhase } from '@runcastle/core'
import type { EventRow, GateId, Phase, TestNoteAuthor, TicketKind } from '@runcastle/core'
import type { BranchList, FeatureFull, FeatureListItem } from './api'
import { relTime } from './format'
import { PREPARED_LABEL } from './settings'

/**
 * The New Feature form's default base branch. A new feature forks off the branch
 * the user is currently on — that's the branch they chose to work on, and burns
 * never touch the checkout. Fall back to the project main branch when the current
 * checkout isn't a selectable base: a detached HEAD, or a test drive holding
 * runcastle itself on a `feature/*` branch (which the picker excludes).
 */
export function defaultBaseBranch(
  data: Pick<BranchList, 'current' | 'mainBranch' | 'branches'>,
): string {
  return data.branches.includes(data.current) ? data.current : data.mainBranch
}

/**
 * The slug a title will get, for the branch line both creation forms preview.
 * A preview only — the server slugifies again (and deduplicates) on create, so
 * this never has to agree about a collision suffix, only about the shape.
 */
export function slugPreview(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
}

/**
 * The New Feature form's inline "you already have one of these" note, or null.
 *
 * The form had no duplicate guard at all (findings F25.3): typing a title the
 * project already uses created a second feature with a suffixed branch and no
 * warning, and only the branch line hinted at it. This is a warning, never a
 * block — a deliberate second attempt at the same idea is legitimate, and the
 * server deduplicates the slug either way.
 *
 * Matching is on the SLUG, not the raw title, because that is what actually
 * collides: "Slack notifications" and "slack notifications!" become the same
 * branch name.
 */
export function duplicateTitleWarning(
  title: string,
  features: readonly Pick<FeatureListItem, 'title' | 'slug' | 'status'>[],
): string | null {
  const slug = slugPreview(title)
  if (slug === '') return null
  const existing = features.find((f) => f.slug === slug)
  if (!existing) return null
  const where = existing.status === 'shipped' ? 'was already shipped' : 'already exists'
  return `“${existing.title}” ${where} on feature/${existing.slug}. Creating this makes a second feature and a second branch.`
}

/**
 * Client-side feature derivations (UI-SPEC §2/§3): sidebar glyph, needs-me
 * classification, and the guided next step. Pure functions over wire data — no IO.
 */

export const PHASE_ORDER: Phase[] = [
  'ideation',
  'spec',
  'tickets',
  'implementation',
  'review',
  'shipped',
]

/** Sidebar status glyph per phase (mono). */
export function phaseGlyph(phase: Phase): string {
  switch (phase) {
    case 'ideation':
      return '◉'
    case 'spec':
      return '◐'
    case 'tickets':
      return '▤'
    case 'implementation':
      return '⚙'
    case 'review':
      return '◆'
    case 'shipped':
      return '✓'
  }
}

/**
 * The rail glyph for a parked draft (decision 9), shown in place of
 * {@link phaseGlyph}. A draft has no meaningful pipeline position, so it gets no
 * phase glyph — the open circle says "nothing has started here yet".
 */
export const DRAFT_GLYPH = '◌'

export type NeedsMeKind = 'grill' | 'burn' | 'attention' | 'ship'

export interface NeedsMe {
  kind: NeedsMeKind
  label: string
}

/**
 * An open terminal whose agent is mid-turn — the HITL twin of `activeRun`, and
 * the thing the phase alone can never tell you (decisions §3). A terminal still
 * launching counts: nothing has stopped for anyone yet.
 */
function agentMidTurn(f: FeatureListItem): boolean {
  return !!f.liveSession && !f.liveSession.awaitingInput
}

/**
 * Which features need me (UI-SPEC §2). Computed from `feature.list` data:
 * feature phase + ticket counts + active-run flag + the feature's live session.
 *
 * A live session outranks the phase in BOTH directions (decisions §3): while its
 * agent is mid-turn the feature wants nothing from me, and when the agent stops
 * for an answer that IS what needs me, whatever phase it is at. This supersedes
 * the accepted gap it replaces — `feature.list` used to omit sessions entirely,
 * so the grilling dot showed for every active ideation feature whether or not
 * anyone was mid-conversation with it, which is the rail lying about the one
 * thing it exists to say.
 */
export function needsMe(f: FeatureListItem): NeedsMe | null {
  // A parked draft is not in the pipeline at all (decision 9): it claims no
  // attention until the human clicks Start, whatever its phase says.
  if (f.status === 'draft') return null
  if (f.status === 'shipped' || f.status === 'archived') return null
  if (f.activeRun) return null // burning: shown as a spinner, not a needs-me dot
  if (f.liveSession) {
    // The amber `grill` dot: every talk session is a conversation, and a
    // conversation that has stopped is waiting on my half of it.
    return f.liveSession.awaitingInput
      ? { kind: 'grill', label: 'the session is waiting on you' }
      : null
  }
  if (f.ticketCounts.failed > 0)
    return { kind: 'attention', label: 'run failed — needs attention' }
  if (f.phase === 'ideation') return { kind: 'grill', label: 'needs grilling' }
  if (f.phase === 'tickets' && f.ticketCounts.total > 0)
    return { kind: 'burn', label: 'review & burn tickets' }
  if (f.phase === 'review') return { kind: 'ship', label: 'test & merge' }
  return null
}

export type RowChipKind = 'needsMe' | 'working' | 'shipped' | 'draft' | 'age'

/** What fills a sidebar row's single status-chip slot. */
export interface RowChip {
  kind: RowChipKind
  /** The chip's visible text — `''` for the shipped chip, which is its ✓ alone. */
  text: string
  /** Hover sentence; for needs-me, the specific reason behind the generic label. */
  title: string
  /** needs-me only: which flavour of attention, which colours the dot. */
  needs?: NeedsMeKind
}

/**
 * The one thing a feature row's chip says (decisions §1). The slot holds exactly
 * one thing, so the four candidates are ranked: something wants me > an agent is
 * working > it shipped > nothing is happening, and here is how long for.
 *
 * "An agent is working" covers both kinds of agent — the unattended burner and
 * the one mid-turn in an open terminal — so the chip and the triage lane never
 * disagree about a feature.
 */
export function rowChip(f: FeatureListItem, now: number = Date.now()): RowChip {
  const nm = needsMe(f)
  if (nm) return { kind: 'needsMe', text: 'Needs you', title: nm.label, needs: nm.kind }
  if (f.activeRun) return { kind: 'working', text: 'Working', title: 'agent working' }
  if (agentMidTurn(f)) {
    return { kind: 'working', text: 'Working', title: 'the agent is working in the session' }
  }
  if (f.status === 'shipped') return { kind: 'shipped', text: '', title: 'shipped' }
  // A parked idea's age is noise, not news (decision 9) — say what it IS instead.
  if (f.status === 'draft')
    return { kind: 'draft', text: 'Draft', title: 'parked — click Start to cut its branch' }
  const text = relTime(f.lastActivityAt, now)
  return { kind: 'age', text, title: `last activity ${text === 'now' ? 'just now' : `${text} ago`}` }
}

/**
 * A feature's ticket progress for the row's second line, or null when it has no
 * tickets. Null rather than "0/0 done": a figure about nothing costs the line
 * width that the slug and the pipeline map need.
 */
export function ticketProgress(f: FeatureListItem): string | null {
  const { total, done } = f.ticketCounts
  return total > 0 ? `${done}/${total} done` : null
}

/** Sidebar sort: needs-me first, then active, then parked drafts, then shipped
 *  (both dimmed). Stable within groups (the server returns newest-first). */
export function sortForSidebar(features: FeatureListItem[]): FeatureListItem[] {
  const rank = (f: FeatureListItem): number => {
    if (f.status === 'shipped') return 3
    // Parked ideas sit below work in motion and above shipped history
    // (decision 9) — more alive than a merged branch, not in the pipeline.
    if (f.status === 'draft') return 2
    if (needsMe(f)) return 0
    return 1
  }
  return [...features]
    .map((f, i) => ({ f, i }))
    .sort((a, b) => rank(a.f) - rank(b.f) || a.i - b.i)
    .map((x) => x.f)
}

function latestRun(runs: FeatureFull['runs']): FeatureFull['runs'][number] | undefined {
  if (runs.length === 0) return undefined
  return [...runs].sort((a, b) => b.startedAt - a.startedAt)[0]
}

export { latestRun }

// ===========================================================================
// app-redesign derivations — pipeline-first shell (triage sidebar, workspace
// pipeline stepper, guided next-step bar). Pure functions over wire data.
// ===========================================================================

export const PHASE_LABELS: Record<Phase, string> = {
  ideation: 'ideation',
  spec: 'spec',
  tickets: 'tickets',
  implementation: 'build',
  review: 'review',
  shipped: 'shipped',
}

/** One-line tooltip per phase for the pipeline stepper. */
export const PHASE_TIP: Record<Phase, string> = {
  ideation: 'Shape the idea in a grill session',
  spec: 'Write it up as a spec',
  tickets: 'Break the work into atomic tickets',
  implementation: 'Burn the tickets into commits',
  review: 'Test-drive the branch, then merge',
  shipped: 'Merged to the main branch',
}

export function phaseIndex(phase: Phase): number {
  return PHASE_ORDER.indexOf(phase)
}

// --- triage sidebar --------------------------------------------------------

export type TriageKey =
  | 'needsYou'
  | 'agentWorking'
  | 'inProgress'
  | 'drafts'
  | 'shipped'
  | 'archived'

export interface TriageGroup {
  key: TriageKey
  label: string
  features: FeatureListItem[]
}

/**
 * Which triage lane a feature belongs to. Order of checks matters — the first
 * match wins. Archived wins over everything: an archived feature carries no
 * needs-me / working state, it only sits in the archived lane.
 *
 * Both lanes read the same live session (decisions §3): `needsMe` has already
 * claimed one whose agent has stopped for an answer, so any session left here
 * is one with an agent mid-turn — which is Agent working, not In progress.
 */
export function triageOf(f: FeatureListItem): TriageKey {
  if (f.status === 'archived') return 'archived'
  if (f.status === 'shipped') return 'shipped'
  // Its own band (decision 9): a parked draft carries no needs-me or working
  // state, so it never interleaves with things in motion.
  if (f.status === 'draft') return 'drafts'
  if (f.activeRun) return 'agentWorking'
  if (needsMe(f)) return 'needsYou'
  if (agentMidTurn(f)) return 'agentWorking'
  return 'inProgress'
}

/**
 * Group features into the sidebar's triage lanes (app-redesign). Preserves the
 * incoming order within each lane (the server returns newest-first). Empty lanes
 * are omitted; lanes are returned in display order. Archived features are
 * excluded from the default view (decision #8) — pass `showArchived` to surface
 * them in a trailing Archived lane.
 */
export function triage(
  features: FeatureListItem[],
  opts: { showArchived?: boolean } = {},
): TriageGroup[] {
  const buckets: Record<TriageKey, FeatureListItem[]> = {
    needsYou: [],
    agentWorking: [],
    inProgress: [],
    drafts: [],
    shipped: [],
    archived: [],
  }
  for (const f of features) buckets[triageOf(f)].push(f)

  const order: { key: TriageKey; label: string }[] = [
    { key: 'needsYou', label: 'Needs you' },
    { key: 'agentWorking', label: 'Agent working' },
    { key: 'inProgress', label: 'In progress' },
    { key: 'drafts', label: 'Drafts' },
    { key: 'shipped', label: 'Shipped' },
  ]
  if (opts.showArchived) order.push({ key: 'archived', label: 'Archived' })
  return order
    .map(({ key, label }) => ({ key, label, features: buckets[key] }))
    .filter((g) => g.features.length > 0)
}

/** How many Shipped rows the rail shows collapsed (decisions §2). */
const SHIPPED_LANE_CAP = 5

export interface CappedLane {
  /** The features the lane renders right now. */
  visible: FeatureListItem[]
  /**
   * The expander button's label — 'Show all (N)' collapsed, 'Show fewer'
   * expanded — or null when the lane shows everything it has and needs no button.
   */
  expanderLabel: string | null
}

/**
 * How much of a triage lane to render (decisions §2). Shipped is the only lane
 * that grows without bound, so it alone collapses to its newest
 * {@link SHIPPED_LANE_CAP} rows — the incoming order is the server's newest-first
 * — behind a "Show all (N)" expander. Every other lane is exactly what the rail
 * exists to surface and is never hidden.
 *
 * N counts the whole lane, not the hidden tail: the label beside it is the
 * lane's true total, and two different figures for one lane read as a bug.
 */
export function capLane(group: TriageGroup, expanded: boolean): CappedLane {
  if (group.key !== 'shipped' || group.features.length <= SHIPPED_LANE_CAP) {
    return { visible: group.features, expanderLabel: null }
  }
  return {
    visible: expanded ? group.features : group.features.slice(0, SHIPPED_LANE_CAP),
    expanderLabel: expanded ? 'Show fewer' : `Show all (${group.features.length})`,
  }
}

// --- pipeline (sidebar mini-map + workspace stepper) -----------------------

export type StepState = 'done' | 'current' | 'upcoming'

export interface PipelineStep {
  phase: Phase
  label: string
  state: StepState
  /** The phase currently shown in the workspace (viewed pin or live phase). */
  isViewed: boolean
  /** Whether clicking the step navigates (done or current phases only). */
  clickable: boolean
  tip: string
}

function stepState(feature: { phase: Phase }, phase: Phase): StepState {
  const ci = phaseIndex(feature.phase)
  const pi = phaseIndex(phase)
  if (pi < ci) return 'done'
  if (pi === ci) return 'current'
  return 'upcoming'
}

/** Compact 6-segment lifecycle map for a sidebar row. */
export function miniSegments(
  feature: { phase: Phase },
): { phase: Phase; state: StepState }[] {
  return PHASE_ORDER.map((phase) => ({ phase, state: stepState(feature, phase) }))
}

/** The phase actually shown in the workspace (pinned view, else the live phase). */
export function effectivePhase(
  feature: { phase: Phase },
  viewedPhase: Phase | null,
): Phase {
  return viewedPhase ?? feature.phase
}

/** Viewing an earlier, completed phase (workspace is read-only). */
export function isReadonlyView(feature: { phase: Phase }, effective: Phase): boolean {
  return phaseIndex(effective) < phaseIndex(feature.phase)
}

/** The full workspace pipeline stepper for a feature at a given viewed phase. */
export function pipelineSteps(
  feature: { phase: Phase },
  effective: Phase,
): PipelineStep[] {
  return PHASE_ORDER.map((phase) => {
    const state = stepState(feature, phase)
    return {
      phase,
      label: PHASE_LABELS[phase],
      state,
      isViewed: phase === effective,
      clickable: state === 'done' || state === 'current',
      tip: PHASE_TIP[phase],
    }
  })
}

// --- guided next-step bar ---------------------------------------------------

export type ActionKind =
  | 'startDraft' // feature.start — cut the branch on a parked draft, then grill
  | 'startGrill' // launchSession { kind: 'ideation' }
  | 'converge' // feature.converge — crosses G1 on a mapped feature
  | 'convergeOverride' // feature.converge { overrideReason } — forces G1, needs a reason
  | 'advance' // feature.advance (crosses non-human gates G1/G2/G4)
  | 'burn' // feature.burn (G3, and resume a parked run)
  | 'cancelRun' // run.cancel
  | 'testDriveStart' // feature.testDrive { action: 'start' }
  | 'testDriveStop' // feature.testDrive { action: 'stop' }
  | 'merge' // feature.merge (G5)
  | 'askQuestions' // launchSession { kind: 'qa' }
  | 'revisit' // launchSession { kind: 'revisit' } — resume the old conversation, amend docs + tickets
  | 'resolveConflict' // launchSession { kind: 'revisit', kickoffLine: mergeConflictKickoff(…) }
  | 'rethink' // feature.rethink — start the next lap (review → ideation)
  | 'unarchive' // feature.unarchive — restore an archived feature to its lane (next-step bar)

/**
 * An action that can't fire on click: the bar expands inline to a free-text
 * input first and hands the typed string to the dispatcher (today, the reason
 * recorded with a forced G1 override).
 */
export interface ReasonPrompt {
  placeholder: string
  /** Label of the button that fires the action with the typed reason. */
  submitLabel: string
}

export interface NextAction {
  label: string
  kind: ActionKind
  danger?: boolean
  /** Set when the action needs a reason string before it can fire. */
  reason?: ReasonPrompt
  /**
   * Why this action cannot fire right now — the server would refuse it in this
   * state. Set means shown-but-disabled, with this sentence as the reason: an
   * action that vanishes leaves the user hunting for it, and one that fails on
   * click teaches nothing (findings F3).
   */
  disabled?: string
}

export interface NextStep {
  /** Small tracked kicker above the title (e.g. NEXT STEP / IN PROGRESS). */
  kick: string
  title: string
  desc: string
  primary?: NextAction
  secondary: NextAction[]
  /** A run is actively burning — show a spinner in the bar. */
  busy: boolean
  /** Soft warning shown under the description — remaining map fog. */
  fog?: string
  /**
   * Soft warning about the step's own action, shown and never enforced: today,
   * the drive keys this test drive depends on that no dry run has ever proven
   * (decision 7). Unlike {@link NextAction.disabled} it blocks nothing — drives
   * are best-effort and happen on every review, so a gate here would become a
   * click-through ritual, while a line where the eye already is stays read.
   */
  warning?: string
}

/**
 * Kickoff line for a review-phase revisit session opened to RESOLVE a merge
 * conflict (CONTEXT decision #9). Passed as the `launchSession` override, so the
 * revisit agent — whose cwd IS the talk worktree checked out on the feature
 * branch — opens straight on the merge-into-feature resolution rather than the
 * generic revisit prompt. Parameterized with the base branch, feature branch,
 * and conflicting files carried on the `merge.conflict` event.
 */
export function mergeConflictKickoff(base: string, branch: string, files: string[]): string {
  const list = files.length ? files.join(', ') : '(run git status to see the conflicts)'
  return (
    `Proceed with your task: RESOLVE A MERGE CONFLICT. Merging ${base} into ${branch} conflicts ` +
    `on: ${list}. Your working directory IS the talk worktree, already checked out on ${branch}. ` +
    `Run \`git merge ${base}\`, then resolve every conflict using this feature’s spec.md and ` +
    `decisions.md for intent, and commit the merge. Do NOT push and do NOT advance the phase ` +
    `(never call complete_phase). When the merge commit is in, tell me to click “Merge & ship” ` +
    `again for a clean retry.`
  )
}

/**
 * Kickoff line for the run lane's "Resolve in terminal" — the human escape
 * hatch when the burner's automatic resolver could not finish a ticket's
 * landing conflict. Passed as the `launchSession` override, so the revisit
 * agent (cwd = the talk worktree, checked out on the feature branch) opens on
 * the resolution with the ticket's identity, its branch, and the conflicting
 * files already in hand.
 *
 * Note the direction: the human session merges the TICKET branch into the
 * feature branch (the landing that failed), which is the opposite of what the
 * unattended resolver does in the sandbox — there is no sandbox here, and the
 * talk worktree already holds the feature branch.
 */
export function ticketConflictKickoff(input: {
  seq: number
  title: string
  branch: string
  featureBranch: string
  files: string[]
}): string {
  const list = input.files.length
    ? input.files.join(', ')
    : '(run git status after the merge to see them)'
  return (
    `Proceed with your task: RESOLVE A MERGE CONFLICT. Ticket #${input.seq} (“${input.title}”) is ` +
    `fully implemented on branch ${input.branch}, but landing it on ${input.featureBranch} ` +
    `conflicts on: ${list}. Your working directory IS the talk worktree, already checked out on ` +
    `${input.featureBranch}. Run \`git merge ${input.branch}\`, read both sides before resolving ` +
    `(the ticket's work on one side, the sibling tickets that landed first on the other), and ` +
    `resolve by intent using this feature's spec.md and decisions.md — keep BOTH sides working. ` +
    `Run the tests over the touched code, then commit the merge. Do NOT push and do NOT advance ` +
    `the phase (never call complete_phase). When the merge commit is in, tell me to click Retry ` +
    `on the ticket so runcastle records it as landed.`
  )
}

export interface MergeConflictState {
  /** The base branch that failed to merge in (the merge target). */
  base: string
  /** Repo-relative paths that conflicted. */
  files: string[]
  /**
   * When the conflict was recorded (the event's `ts`). The panel is undated
   * without it, and an undated red panel reads as "happening now" — the audit
   * found one that was fifteen days old (findings F8).
   */
  at: number
}

/**
 * The standing (unresolved) merge conflict for a feature, derived from its event
 * feed so the review conflict card survives a page reload. The latest
 * `merge.conflict` event carries the base branch + conflicting files; two later
 * events supersede it. `burn.started` — burning re-runs implementation and the
 * recorded file list no longer applies, so the card clears once the loop moves
 * on. `merge.resolved` — the server watched a resolve session land the merge
 * (decision 2a), which is how a resolved conflict stops disabling the pipeline's
 * last step instead of standing forever.
 * Returns null when there is no standing conflict. `events` must be in id order.
 */
export function unresolvedMergeConflict(events: EventRow[]): MergeConflictState | null {
  let conflict: MergeConflictState | null = null
  for (const e of events) {
    if (e.type === 'merge.conflict') {
      const d = (e.data ?? {}) as { base?: unknown; files?: unknown }
      const files = Array.isArray(d.files) ? d.files.filter((f): f is string => typeof f === 'string') : []
      conflict = { base: typeof d.base === 'string' ? d.base : '', files, at: e.ts }
    } else if (e.type === 'burn.started' || e.type === 'merge.resolved') {
      conflict = null
    }
  }
  return conflict
}

export interface UndoableOverride {
  /** The gate that was forced. */
  gate: GateId
  /** The phase the feature was on before the override advanced it. */
  from: Phase
  /** Where the override put it — the feature's phase, while the undo stands. */
  to: Phase
}

/**
 * The phase move an event records, or null if it records none. Every phase
 * change goes through the server's `setPhase`, which carries `{ from, to }` on
 * the event whatever it types the event as — so the data SHAPE identifies a
 * transition where a list of event types would go stale. Status changes carry
 * `{ from, to }` too, but of statuses, so requiring BOTH to parse as phases
 * separates them.
 */
function phaseTransition(e: EventRow): { from: Phase; to: Phase } | null {
  const d = (e.data ?? {}) as { from?: unknown; to?: unknown }
  const from = parsePhase(d.from)
  const to = parsePhase(d.to)
  return from && to ? { from, to } : null
}

/**
 * The gate override that can still be taken back, derived from the event feed
 * (so the affordance survives a reload, like the conflict card).
 *
 * Override is the pipeline's quietest irreversible action: Apply advanced the
 * phase instantly, and the only ways back were an agent action or DB surgery
 * (findings F24). Undo is offered only while the override is the feature's
 * LATEST transition — `overrideGate` emits `gate.overridden` and then the
 * advance, so any later phase transition (a burn, a lap, a merge, another
 * advance) means the pipeline has moved on and stepping back one phase would no
 * longer be the reversal of anything. `events` must be in id order.
 */
export function undoableOverride(events: EventRow[]): UndoableOverride | null {
  let forcedGate: GateId | null = null
  let undoable: UndoableOverride | null = null
  for (const e of events) {
    if (e.type === 'gate.overridden') {
      forcedGate = ((e.data ?? {}) as { gate?: GateId }).gate ?? null
      continue
    }
    const moved = phaseTransition(e)
    if (!moved) continue
    // The advance that the override just forced — or any other transition, which
    // closes the window on whatever was open.
    undoable = forcedGate ? { gate: forcedGate, ...moved } : null
    forcedGate = null
  }
  return undoable
}

/**
 * Whether this feature was ever test-driven, from the event feed — the third
 * figure the merge confirmation reports (findings F21). A stopped drive still
 * counts: the human did put the branch on the road.
 */
export function testDriveTaken(events: EventRow[]): boolean {
  return events.some((e) => e.type === 'testdrive.started')
}

// --- review honesty: the SUMMARY card and the merge confirmation -------------

/**
 * How much trust a review figure has earned, as a dot colour: `ok` green,
 * `warn` amber, `danger` red, `idle` grey for "there is nothing here".
 *
 * The distinction that matters is `idle` vs `ok`. The audit found the SUMMARY
 * card painting "0 commits", "0/0 done" and a missing run in all-clear green
 * (findings F23) — the one card meant to inform an irreversible merge reassuring
 * the user about data it did not have. Absence is never `ok` here.
 */
export type CheckTone = 'ok' | 'warn' | 'danger' | 'idle'

/** One labelled figure in the review summary / merge confirmation. */
export interface CheckRow {
  /** Row label, as shown ("tickets", "run", "changes", "test drive"). */
  key: string
  /** The figure itself, as shown. */
  value: string
  tone: CheckTone
}

/** A run as the summary reads it — the wire row, narrowed to what it paints. */
interface RunFigure {
  status: string
  summary?: string | null
}

function ticketRow(tickets: readonly { status: string }[]): CheckRow {
  const total = tickets.length
  const done = tickets.filter((t) => t.status === 'done').length
  const failed = tickets.filter((t) => t.status === 'failed').length
  const value = `${done}/${total} done${failed > 0 ? ` · ${failed} failed` : ''}`
  // 0/0 is grey, not green: no tickets means nothing was verified, which is a
  // different thing from everything having passed.
  const tone: CheckTone =
    failed > 0 ? 'danger' : total === 0 ? 'idle' : done === total ? 'ok' : 'warn'
  return { key: 'tickets', value, tone }
}

function runRow(run: RunFigure | undefined): CheckRow {
  if (!run) return { key: 'run', value: 'no run recorded', tone: 'idle' }
  const tone: CheckTone =
    run.status === 'succeeded' ? 'ok' : run.status === 'failed' ? 'danger' : 'warn'
  return { key: 'run', value: `${run.status}${run.summary ? ` · ${run.summary}` : ''}`, tone }
}

/**
 * The commits row. `count` comes from git (`feature.commitCount`), not from
 * ticket commit rows — a branch a human or an Iterate session committed to has
 * commits and no ticket rows at all, which is how a branch one commit ahead of
 * main reported "0 commits" in green. `undefined` means git could not tell, and
 * says so rather than borrowing zero's certainty.
 */
function commitRow(count: number | undefined): CheckRow {
  if (count === undefined) return { key: 'changes', value: 'commit count unknown', tone: 'idle' }
  return {
    key: 'changes',
    value: `${count} commit${count === 1 ? '' : 's'}`,
    tone: count > 0 ? 'ok' : 'warn',
  }
}

/** A ticket as the review surfaces read it — the wire row, narrowed. */
interface ReviewTicketFigure {
  kind?: TicketKind
  status: string
  error?: string
}

/** A note as the review surfaces read it — only who wrote it matters here. */
interface NoteFigure {
  author?: TestNoteAuthor
}

/**
 * What the review agent's pass amounted to (decisions #7). The human's review
 * now starts from the agent's report, so every review surface has to be able to
 * say what that report was — including that there wasn't one.
 */
export type ReviewOutcome =
  /** No review ticket was emitted — today's status quo, and not a fault. */
  | { state: 'none' }
  /** The review ran to completion. Findings are not failure (decisions #6). */
  | { state: 'ran'; findings?: number }
  /** The review could not run; `reason` is whatever the ticket recorded. */
  | { state: 'failed'; reason?: string }
  /** A review ticket exists but has not finished — a burn still in flight. */
  | { state: 'waiting'; status: string }

/**
 * The review agent's outcome, read off the feature's tickets and notes.
 *
 * Findings are counted from agent-authored notes rather than asked of the
 * ticket, because the notes ARE the deliverable (decisions #2): a review that
 * filed four notes found four things. All of them count, whatever became of
 * them — a finding the human has since ticked off or promoted was still a
 * finding. `undefined` notes means the list has not arrived, which reports as
 * unknown rather than as 0: a clean bill of health is a claim, not a default.
 *
 * Lap 1 emits at most one review ticket per feature (spec, "Later laps"), so
 * the last review ticket in the batch is *the* review. If multiplicity ever
 * lands, this is the seam that has to aggregate instead of pick.
 */
export function reviewOutcome(input: {
  tickets?: readonly ReviewTicketFigure[]
  /** The feature's test notes, or undefined while the list is still in flight. */
  notes?: readonly NoteFigure[]
}): ReviewOutcome {
  const review = (input.tickets ?? []).filter((t) => t.kind === 'review').at(-1)
  if (!review) return { state: 'none' }
  if (review.status === 'failed') {
    return { state: 'failed', ...(review.error ? { reason: review.error } : {}) }
  }
  if (review.status !== 'done') return { state: 'waiting', status: review.status }
  const findings = input.notes?.filter((n) => n.author === 'agent').length
  return { state: 'ran', ...(findings === undefined ? {} : { findings }) }
}

/**
 * The review agent's figure, as both review surfaces render it — or null when
 * there is nothing to say because no review was ever asked for.
 *
 * `no findings` is green on purpose: a review that ran clean is the one positive
 * signal this machinery can produce, and greying it would make a good result
 * look like a missing one. Findings are amber, never red — they are things to
 * read, not failures (decisions #6) — and so is a review that could not run,
 * which merely leaves the human where they stood before any of this existed.
 */
function reviewRow(outcome: ReviewOutcome): CheckRow | null {
  const key = 'review agent'
  switch (outcome.state) {
    case 'none':
      return null
    case 'waiting':
      return { key, value: `ticket ${outcome.status}`, tone: 'warn' }
    case 'failed':
      return {
        key,
        value: `could not run${outcome.reason ? ` · ${outcome.reason}` : ''}`,
        tone: 'warn',
      }
    case 'ran': {
      const n = outcome.findings
      if (n === undefined) return { key, value: 'ran · findings unknown', tone: 'idle' }
      if (n === 0) return { key, value: 'no findings', tone: 'ok' }
      return { key, value: `${n} finding${n === 1 ? '' : 's'}`, tone: 'warn' }
    }
  }
}

/** The review SUMMARY card's rows, in the order the card shows them. */
export function reviewChecks(input: {
  tickets?: readonly ReviewTicketFigure[]
  run?: RunFigure
  commitCount?: number
  /** The feature's test notes — where the agent's findings are counted from. */
  notes?: readonly NoteFigure[]
}): CheckRow[] {
  // The agent's report LEADS the card (decisions #7). The human arrives at this
  // screen to read it, and a line appended under the commit count is exactly the
  // "easy to miss" that decision exists to prevent. Omitted entirely when no
  // review ticket ran: a feature that never asked for a review is not missing
  // anything, and this card does not nag.
  const review = reviewRow(reviewOutcome({ tickets: input.tickets, notes: input.notes }))
  return [
    ...(review ? [review] : []),
    ticketRow(input.tickets ?? []),
    runRow(input.run),
    commitRow(input.commitCount),
  ]
}

/** What the merge confirmation shows: the figures, and every gap in them. */
export interface MergeSummary {
  rows: CheckRow[]
  /**
   * One sentence per missing or unhappy figure, shown as warnings above the
   * confirm button. Empty when everything checks out.
   */
  warnings: string[]
}

/**
 * The merge confirmation's summary (findings F21): what is about to be merged,
 * and what is missing from that picture. Merging is the pipeline's most
 * irreversible action and fired on a single unconfirmed click — this is the text
 * that click now has to be read past.
 *
 * Every gap is reported, not just the first: "no commits" and "never
 * test-driven" are two different reasons to stop, and the human deserves both
 * before deciding.
 */
export function mergeSummary(input: {
  commitCount?: number
  run?: RunFigure
  driveTaken: boolean
  /** Notes captured during the test drive that were never ticked off. */
  openNotes?: number
  /** What the review agent made of this branch, when the caller knows. */
  review?: ReviewOutcome
}): MergeSummary {
  const drive: CheckRow = input.driveTaken
    ? { key: 'test drive', value: 'taken', tone: 'ok' }
    : { key: 'test drive', value: 'never test-driven', tone: 'warn' }

  // Unlike the review card, this dialog says so when no review ticket ran: it
  // reports every gap in the picture it is painting ("no run recorded", "commit
  // count unknown"), and an unreviewed branch is one of them. Advisory only —
  // it is a row, not a warning, because most branches will never have asked for
  // a review and nagging every merge is not what decisions #7 asked for.
  const reviewLine: CheckRow | null = input.review
    ? (reviewRow(input.review) ?? {
        key: 'review agent',
        value: 'no review ticket',
        tone: 'idle',
      })
    : null

  const warnings: string[] = []
  if (input.commitCount === undefined) {
    // Covers both "git could not tell" and "the count has not arrived yet" —
    // either way the honest line is that this dialog cannot vouch for it.
    warnings.push('The commit count for this branch is unknown — check it before merging.')
  } else if (input.commitCount === 0) {
    warnings.push('This branch carries no commits — merging it changes nothing.')
  }
  if (!input.run) warnings.push('No run was recorded — no burn has run on this branch.')
  else if (input.run.status !== 'succeeded') {
    warnings.push(`The last run ${input.run.status} rather than succeeding.`)
  }
  if (!input.driveTaken) warnings.push('This branch was never test-driven.')
  // A review that could not run is a gap in this picture, same family as "never
  // test-driven": nothing was verified for the human, and they should know that
  // before clicking. Findings themselves get no warning — the open-notes line
  // below already counts the ones still outstanding, agent-written included.
  if (input.review?.state === 'failed') {
    const reason = input.review.reason
    warnings.push(`The review agent could not run${reason ? `: ${reason}` : ''}.`)
  }
  // Informational, never blocking (decisions #7): shipping over findings the
  // human logged and never handled is the moment worth catching, but someone who
  // judged their open notes shippable must not be stopped.
  const open = input.openNotes ?? 0
  if (open > 0) warnings.push(`${open} open test-drive note${open === 1 ? '' : 's'}.`)

  return {
    rows: [
      commitRow(input.commitCount),
      runRow(input.run),
      drive,
      ...(reviewLine ? [reviewLine] : []),
    ],
    warnings,
  }
}

/** Why a session's briefing is flagged in the session strip. */
export type KickoffTrouble = 'undelivered' | 'not-ready'

/**
 * How long a terminal may sit `launching` — spawned by the server, but with no
 * `SessionStart` check-in from Claude Code yet — before the panel says so.
 */
export const CHECK_IN_GRACE_MS = 30_000

/**
 * True when the session's terminal has been up past {@link CHECK_IN_GRACE_MS}
 * with the agent inside it still not checked in.
 *
 * Informational only. `launching` is a fully active state ({@link
 * sessionActive}) — the terminal is there and can be typed into — so this never
 * withholds anything; it is the panel's quiet explanation for why the strip
 * still reads "launching…", which is usually something on screen waiting on the
 * human (a trust prompt, a resume chooser).
 *
 * The age comes from the session's own `session.launching` event because the
 * session row carries no timestamp. No such event in the log means an age that
 * cannot be stated, and saying nothing beats guessing. `events` must be in id
 * order.
 */
export function awaitingCheckIn(
  session: { id: string; status: string },
  events: EventRow[],
  now: number = Date.now(),
): boolean {
  if (session.status !== 'launching') return false
  const launched = events.find(
    (e) =>
      e.type === 'session.launching' &&
      (e.data as { sessionId?: unknown } | null)?.sessionId === session.id,
  )
  return !!launched && now - launched.ts > CHECK_IN_GRACE_MS
}

/**
 * Whether a session's opening briefing is currently in trouble, derived from the
 * event feed (so it survives a reload, like the conflict card).
 *
 * The server types the briefing into the PTY and waits for Claude Code to
 * acknowledge it via the `UserPromptSubmit` hook. Two things can go wrong, and
 * both used to be invisible — the terminal looked healthy and the agent simply
 * never knew why it had been opened:
 * - `session.kickoff_undelivered` — typed, never acknowledged (a startup dialog
 *   ate the keystrokes), or the human typed first so injection stopped.
 * - `session.not_ready` — the terminal spawned but Claude Code never reported
 *   `SessionStart` at all, so nothing was ever typed.
 * A later `session.kickoff` (the automatic retry, or a manual Send) clears it.
 * `events` must be in id order.
 */
export function kickoffTrouble(events: EventRow[], sessionId: string): KickoffTrouble | null {
  let trouble: KickoffTrouble | null = null
  for (const e of events) {
    if ((e.data as { sessionId?: unknown } | null)?.sessionId !== sessionId) continue
    if (e.type === 'session.kickoff_undelivered') trouble = 'undelivered'
    else if (e.type === 'session.not_ready') trouble = 'not-ready'
    else if (e.type === 'session.kickoff' || e.type === 'session.ended') trouble = null
  }
  return trouble
}

/**
 * Whether a session's terminal is running — the one question every surface that
 * asks "is a session up?" should ask, and the only place the statuses that mean
 * yes are named.
 *
 * BOTH `launching` and `live` count. The server spawns the PTY, owns it, and
 * tracks its exit first-hand (it marks the row ended and emits
 * `session.pty_exited`), so either status means there is a real terminal the
 * human can already type into. `live` records something narrower: that Claude
 * Code's `SessionStart` hook called back, i.e. the agent confirmed it is inside.
 * That check-in only ever UPGRADES what is known about a session — it must never
 * gate whether one exists, because a hook that fails to arrive would then leave
 * the bar offering "Start grill session" over the terminal being worked in,
 * which is the reported bug.
 */
export function sessionActive(session: { status: string }): boolean {
  return session.status === 'launching' || session.status === 'live'
}

/**
 * The session strip's word for an active session — the ONE thing the two
 * statuses are allowed to read differently, because here the distinction is the
 * whole point: `launching…` says the terminal is up and the agent has not
 * checked in yet, `live` says it has. Every strip says it identically.
 */
export function sessionStatusLabel(session: { status: string }): string {
  return session.status === 'launching' ? 'launching…' : 'live'
}

/** The feature's active session ({@link sessionActive}), if it has one. */
export function activeSession<T extends { status: string }>(
  sessions: readonly T[],
): T | undefined {
  return sessions.find((s) => sessionActive(s))
}

/**
 * True when the feature has an ENDED session of `kind` whose Claude Code
 * conversation can still be picked up (it reached `live`, so it recorded a
 * `ccSessionId`). Opening a terminal of that kind `--resume`s the latest such
 * conversation server-side, so this only decides the WORDING — Resume vs Start —
 * never the action. A terminal is a real process, so quitting runcastle ends
 * every session row; without this the bar would keep saying "Start" for a
 * conversation that is actually being continued.
 *
 * `kind` is optional because a `revisit` launch is kind-BLIND server-side: it
 * resumes the feature's most recent resumable conversation whatever kind it was,
 * which is what the lap's own session asks for.
 */
function hasResumable(sessions: FeatureFull['sessions'], kind?: string): boolean {
  return sessions.some(
    (s) => (!kind || s.kind === kind) && s.status === 'ended' && !!s.ccSessionId,
  )
}

/**
 * The Start-test-drive step's inline warning (decision 7): the drive keys this
 * drive is about to depend on that no dry run has ever proven, by their settings
 * labels, pointing at the one thing that clears them. Never blocks the drive.
 */
function unverifiedWarning(keys: string[]): string {
  const named = keys.map((k) => PREPARED_LABEL[k] ?? k)
  const list =
    named.length === 1
      ? named[0]
      : `${named.slice(0, -1).join(', ')} and ${named[named.length - 1]}`
  return `${list} ${named.length === 1 ? 'was' : 'were'} never proven by a dry run — run preparation to verify.`
}

/**
 * The single guided next step for a feature's *current* phase (app-redesign).
 * Two rules order the cases:
 *
 * - A live session wins over everything the session agent can do itself. It
 *   calls `complete_phase` on its own and locks decisions incrementally, so a
 *   satisfied gate mid-grill is not an invitation — the bar goes status-only
 *   (no primary, no secondaries) rather than offering a promotion that races it.
 * - Gate-aware otherwise: with nothing live and the gate guarding the next phase
 *   satisfied without a human-only gate (G3 Burn / G5 Merge), the promotion
 *   survives as a quiet secondary behind the phase's work action — the recovery
 *   path for hand-written docs or an unresumable conversation.
 *
 * Buttons are only for verbs the agent cannot perform.
 */
export function nextStep(
  full: FeatureFull,
  ctx: {
    driving: boolean
    mapContent?: string
    /**
     * The feature's standing merge conflict ({@link unresolvedMergeConflict}).
     * Set means the last Merge & ship failed and nothing has superseded it, so
     * the bar must stop recommending the merge that can only fail again — the
     * bar and the conflict panel contradicting each other is findings F8.
     */
    conflict?: MergeConflictState | null
    /**
     * Drive-loop keys this project has a value for that no dry run has ever
     * proven (decision 7). Keys with no value are absent — a checkout-only drive
     * has nothing to doubt.
     */
    unverifiedDriveKeys?: string[]
    /** A preparation dry run holds the singleton drive slot (decision 9). */
    dryRunActive?: boolean
    /**
     * A draft's Start has no base to send yet — the branch list is still
     * loading, so the base the body is showing is not known. Starting now would
     * silently fall back to the project main branch, the same trap the New
     * Feature form guards against.
     */
    draftBaseUnresolved?: boolean
  },
): NextStep {
  const { feature, tickets, sessions, runs, gate } = full
  const live = activeSession(sessions)
  const resumableGrill = hasResumable(sessions, 'ideation')
  const t = tickets.length
  const done = tickets.filter((x) => x.status === 'done').length
  const failed = tickets.filter((x) => x.status === 'failed').length
  // Non-terminal tickets the burner still has to run — matches the server's
  // `burn` acceptance check (features.ts). Fix tickets from an Iterate session
  // land here as `pending`, driving the review → burn loop-back.
  const pending = tickets.filter(
    (x) => x.status !== 'done' && x.status !== 'failed' && x.status !== 'cancelled',
  ).length
  const run = latestRun(runs)
  const running = run?.status === 'running'
  const nextName = nextPhase(feature)

  // A parked draft is not in the pipeline either (decision 9): it is created at
  // phase `ideation`, so its status has to win over its phase here, or the bar
  // would offer a grill session on a feature with no branch — which the server
  // refuses. Its one next step is Start; the base picker rides along in the
  // draft body's Advanced disclosure.
  if (feature.status === 'draft') {
    return {
      kick: 'NEXT STEP',
      title: 'Start this feature',
      desc: 'Parked as a draft — Start cuts its branch, writes the brief, and opens the grill session.',
      primary: {
        label: 'Start',
        kind: 'startDraft',
        ...(ctx.draftBaseUnresolved ? { disabled: 'Loading the branch list…' } : {}),
      },
      secondary: [],
      busy: false,
    }
  }

  // An archived feature is parked out of the pipeline (decision #8): it offers no
  // phase next-step, only a way back. Guard before the phase switch so no phase
  // surfaces grill/burn/merge actions while archived.
  if (feature.status === 'archived') {
    return {
      kick: 'ARCHIVED',
      title: 'Feature archived',
      desc: 'This feature is archived and out of the pipeline. Unarchive it to pick the work back up.',
      primary: { label: 'Unarchive', kind: 'unarchive' },
      secondary: [],
      busy: false,
    }
  }

  const canAdvance =
    !!gate.next && gate.satisfied && gate.next.id !== 'G3' && gate.next.id !== 'G5'
  const promoteLabel = nextName ? `Promote to ${PHASE_LABELS[nextName]}` : 'Promote'

  switch (feature.phase) {
    case 'ideation': {
      // Mapped features converge instead of promoting: Converge crosses G1 and
      // spawns the converge session, and the bar owns it (decision #4) — it never
      // shows a plain `advance`, which would bump the phase without a session
      // (ADR-0001 §13.6). Remaining fog — the map's still-unspecified prose —
      // rides along as a warning: shown, never enforced, so it neither gates nor
      // disables Converge.
      if (feature.mapped) {
        const fog = ctx.mapContent
          ? parseMapSections(ctx.mapContent)['Not yet specified']?.trim() || undefined
          : undefined
        if (gate.satisfied) {
          return {
            kick: 'MAP',
            title: 'Converge the map',
            desc: 'Every waypoint is resolved — converge to draft the spec and tickets.',
            primary: { label: 'Converge', kind: 'converge' },
            secondary: [],
            busy: false,
            fog,
          }
        }
        return {
          kick: 'MAP',
          title: 'Work the frontier',
          desc: gate.reason ?? 'Resolve the open waypoints; converge once the frontier clears.',
          // The override is the seatbelt, not the cage: a quiet secondary that
          // asks for a reason before it forces G1.
          secondary: [
            {
              label: 'Override & converge…',
              kind: 'convergeOverride',
              reason: {
                placeholder: 'reason to converge past open waypoints',
                submitLabel: 'Converge anyway',
              },
            },
          ],
          busy: false,
          fog,
        }
      }
      // From lap 2 on, ideation belongs to the LAP's session (SPEC §15.2): one
      // terminal digests what the drive taught, amends the docs, emits this lap's
      // tickets and advances itself through ideation → spec → tickets. So the bar
      // never offers a bare promote here — lap 1's decisions.md is still on disk,
      // and promoting on it skips the whole lap and dead-ends at `tickets` with
      // nothing to burn (findings F4). The lap-scoped gates refuse it server-side;
      // this is the same truth in the copy, pointing at the session instead.
      if (feature.lap > 1) {
        if (live) {
          return {
            kick: 'LAP LIVE',
            title: `Lap ${feature.lap} in progress`,
            desc: 'The lap session digests the drive, amends the docs and emits this lap’s tickets.',
            primary: undefined,
            secondary: [],
            busy: false,
          }
        }
        const resumableLap = hasResumable(sessions)
        return {
          kick: 'NEXT STEP',
          title: `Work lap ${feature.lap}`,
          desc: `Lap ${feature.lap} is open — its session amends the docs and emits this lap’s tickets, then hands back to Burn. Promoting is refused until it has run.`,
          primary: {
            label: resumableLap
              ? `Resume lap ${feature.lap} session`
              : `Start lap ${feature.lap} session`,
            kind: 'revisit',
          },
          secondary: [],
          busy: false,
        }
      }
      if (live) {
        return {
          kick: 'GRILL LIVE',
          title: 'Grill session in progress',
          desc: 'Shape the idea with Claude — it promotes the phase itself when the grilling is done.',
          primary: undefined,
          secondary: [],
          busy: false,
        }
      }
      if (canAdvance) {
        return {
          kick: 'NEXT STEP',
          title: 'Shape the idea, or promote it',
          desc: 'Decisions are captured — carry on in a grill session, or promote the idea when it feels concrete.',
          primary: {
            label: resumableGrill ? 'Resume grill session' : 'Start grill session',
            kind: 'startGrill',
          },
          secondary: [{ label: promoteLabel, kind: 'advance' }],
          busy: false,
        }
      }
      return resumableGrill
        ? {
            kick: 'NEXT STEP',
            title: 'Pick the conversation back up',
            desc: 'The grill session ended, but its conversation is still on disk — resume it to carry on where you left off.',
            primary: { label: 'Resume grill session', kind: 'startGrill' },
            secondary: [],
            busy: false,
          }
        : {
            kick: 'NEXT STEP',
            title: 'Shape the idea with Claude',
            desc: 'Launch a grill session to shape the idea before any code is written.',
            primary: { label: 'Start grill session', kind: 'startGrill' },
            secondary: [],
            busy: false,
          }
    }
    case 'spec': {
      if (live) {
        return {
          kick: 'GRILL LIVE',
          title: 'Writing the spec',
          desc: 'The spec takes shape beside the conversation — the session advances the phase when it’s written.',
          primary: undefined,
          secondary: [],
          busy: false,
        }
      }
      if (canAdvance) {
        return {
          kick: 'NEXT STEP',
          title: 'Refine the spec, or approve it',
          desc: 'The spec is written — reopen the grill to work on it, or approve it to move into tickets.',
          primary: {
            label: resumableGrill ? 'Resume grill' : 'Open grill',
            kind: 'startGrill',
          },
          secondary: [{ label: 'Approve spec → tickets', kind: 'advance' }],
          busy: false,
        }
      }
      return {
        kick: 'NEXT STEP',
        title: 'Write the spec',
        desc: resumableGrill
          ? 'No spec yet — resume the grill conversation to draft it.'
          : 'No spec yet — open a grill session to draft it.',
        primary: {
          label: resumableGrill ? 'Resume grill' : 'Open grill',
          kind: 'startGrill',
        },
        secondary: [],
        busy: false,
      }
    }
    case 'tickets': {
      if (t > 0) {
        return {
          kick: 'NEXT STEP',
          title: 'Review & burn the tickets',
          desc: 'Each ticket is one atomic task Claude will implement. Review them, then burn.',
          // Burn stays primary even while a session is live: `emit_tickets` lands
          // one batch, so a non-zero count means the cards are ready to review.
          primary: { label: `Burn ${t} ticket${t === 1 ? '' : 's'}`, kind: 'burn' },
          // Revisit resumes the grilling conversation to amend docs/tickets —
          // only offered when no session is live (one terminal per feature).
          secondary: live ? [] : [{ label: 'Revisit', kind: 'revisit' }],
          busy: false,
        }
      }
      if (live) {
        return {
          kick: 'WAITING',
          title: 'Emitting tickets',
          desc: 'The session breaks the spec into tickets — they appear here as they land.',
          primary: undefined,
          secondary: [],
          busy: false,
        }
      }
      return {
        kick: 'WAITING',
        title: 'Waiting for tickets',
        desc: 'No tickets yet — a grill session emits them. Open a session to shape the work.',
        primary: {
          label: resumableGrill ? 'Resume grill to emit tickets' : 'Open grill to emit tickets',
          kind: 'startGrill',
        },
        secondary: [],
        busy: false,
      }
    }
    case 'implementation': {
      if (running) {
        return {
          kick: 'IN PROGRESS',
          title: 'Burning tickets',
          desc: `Burning ${t} ticket${t === 1 ? '' : 's'} — ${done} done${failed ? `, ${failed} failed` : ''}.`,
          primary: { label: 'Cancel run', kind: 'cancelRun', danger: true },
          secondary: [],
          busy: true,
        }
      }
      // Nothing to burn. The bar used to offer an enabled "Burn 0 tickets" over
      // an empty ledger whose own copy said the opposite (findings F25.1) — the
      // tickets phase has always handled this state honestly, so this says the
      // same thing: the missing thing is tickets, and a session emits them.
      if (t === 0) {
        if (live) {
          return {
            kick: 'WAITING',
            title: 'No tickets to burn',
            desc: 'This feature reached the build phase with an empty ledger. The live session breaks the work into tickets — they appear here as they land.',
            primary: undefined,
            secondary: [],
            busy: false,
          }
        }
        return {
          kick: 'WAITING',
          title: 'No tickets to burn',
          desc: 'This feature reached the build phase with an empty ledger. A session breaks the work into tickets — open one, and the burn has something to run.',
          primary: {
            label: resumableGrill ? 'Resume the session' : 'Open a session',
            kind: 'startGrill',
          },
          secondary: [],
          busy: false,
        }
      }
      // Never burned at all — the feature was born here (the quick-change door,
      // decision 21) or crossed G3 by an override. There is nothing to resume,
      // so this is the plain first Burn, worded like the tickets phase's.
      if (!run) {
        return {
          kick: 'NEXT STEP',
          title: pending === 1 ? 'Review & burn the ticket' : 'Review & burn the tickets',
          desc: 'Read the card — edit it if it is not quite right — then burn it into commits.',
          primary: { label: `Burn ${t} ticket${t === 1 ? '' : 's'}`, kind: 'burn' },
          secondary: live ? [] : [{ label: 'Revisit', kind: 'revisit' }],
          busy: false,
        }
      }
      const why =
        run.status === 'failed'
          ? 'The run failed — resume the burn to retry.'
          : run.status === 'cancelled'
            ? 'The run was cancelled — resume the burn to continue.'
            : 'The burn has not started — resume to run the tickets.'
      return {
        kick: 'NEXT STEP',
        title: 'Resume the burn',
        desc: why,
        primary: { label: 'Resume burn', kind: 'burn' },
        // Failed tickets are reset to pending on resume; Revisit instead opens
        // a session to amend docs and edit/cancel tickets before re-burning.
        secondary: live ? [] : [{ label: 'Revisit', kind: 'revisit' }],
        busy: false,
      }
    }
    case 'review': {
      // Review offers three verbs (ADR-0010 §3): Fix — the Burn primary below,
      // for when the spec was right and the code wasn't; Iterate — the spec was
      // wrong, so start lap N+1 back at ideation (the `rethink` procedure keeps
      // the internal name, for continuity of the timeline); Merge & ship. Test
      // drive stays available throughout. Iterate opens the lap's terminal, and
      // there is one terminal per feature, so it's hidden while any session is
      // live — and disabled while the drive holds the branch its worktree needs,
      // which the server refuses outright (findings F3).
      // A dry run holds the same singleton drive slot, so the server refuses a
      // feature drive outright while one is up (decision 9) — said here rather
      // than on click. Unverified keys never disable: they are a caveat about
      // what the drive may do, not a reason it cannot run (decision 7), and the
      // refusal outranks the caveat when both apply.
      const testDriveAction: NextAction = ctx.driving
        ? { label: 'Stop test drive', kind: 'testDriveStop' }
        : {
            label: 'Start test drive',
            kind: 'testDriveStart',
            ...(ctx.dryRunActive
              ? { disabled: 'A preparation dry-run is in progress — stop it first' }
              : {}),
          }
      // Nothing to caveat mid-drive — the offer there is Stop — and nothing to
      // caveat when the drive cannot start at all. Spread into each of review's
      // three bars, so the doubt rides along whatever else the phase is saying.
      const unverified = ctx.driving || ctx.dryRunActive ? [] : (ctx.unverifiedDriveKeys ?? [])
      const driveWarning =
        unverified.length > 0 ? { warning: unverifiedWarning(unverified) } : {}
      const iterate: NextAction[] = live
        ? []
        : [
            {
              label: 'Iterate',
              kind: 'rethink',
              ...(ctx.driving
                ? { disabled: 'Stop the test drive first — the branch is checked out' }
                : {}),
            },
          ]

      // A recorded conflict outranks every other review verb (findings F8). The
      // bar used to highlight Merge & ship directly above the red conflict panel,
      // so the one action the user trusts re-ran a merge that could not land.
      // Resolve is therefore the primary — but nothing here is disabled, and
      // that is the whole of decisions 2b and 3. A disabled Merge & ship
      // deadlocked every resolution runcastle could not see (one done in the
      // human's own checkout, a session that crashed); as a retry it either
      // ships or re-emits a fresh conflict, so the card self-corrects. And Burn
      // never touched the base merge in the first place — hiding it here hid the
      // one button whose event (`burn.started`) supersedes the conflict.
      if (ctx.conflict) {
        const retryMerge: NextAction = { label: 'Retry Merge & ship', kind: 'merge' }
        const burn: NextAction[] =
          pending > 0
            ? [{ label: `Burn ${pending} ticket${pending === 1 ? '' : 's'}`, kind: 'burn' }]
            : []
        return {
          kick: 'MERGE CONFLICT',
          title: 'Resolve the merge conflict',
          desc: live
            ? `Merging ${ctx.conflict.base} in hit conflicts — resolve them in the open session, then merge again.`
            : `Merging ${ctx.conflict.base} in hit conflicts. An agent can resolve them on this branch, then Merge & ship retries.`,
          // One terminal per feature: with a session live there is nothing to
          // launch, and the conflict panel below carries the file list.
          primary: live
            ? undefined
            : { label: 'Resolve the merge conflict', kind: 'resolveConflict' },
          secondary: [retryMerge, ...burn, testDriveAction, ...iterate],
          busy: false,
          ...driveWarning,
        }
      }

      // Fix tickets are non-terminal — while any exist, the review loops back
      // through a burn (CONTEXT decision #7): Burn is promoted to primary, and
      // Merge & ship drops to a secondary.
      if (pending > 0) {
        return {
          kick: 'NEXT STEP',
          title: 'Burn the fix tickets',
          desc: ctx.driving
            ? 'Test-driving the branch — burn the fix tickets when you’re ready.'
            : `${pending} fix ticket${pending === 1 ? '' : 's'} ready — burn to run them, then review again.`,
          primary: { label: `Burn ${pending} ticket${pending === 1 ? '' : 's'}`, kind: 'burn' },
          secondary: [{ label: 'Merge & ship', kind: 'merge' }, testDriveAction, ...iterate],
          busy: false,
          ...driveWarning,
        }
      }

      // "Checks are in" is an all-clear, so it needs checks to have run: the audit
      // found it over a feature with no run recorded at all (findings F23), which
      // is the state a quick-change or an overridden gate lands in.
      const desc = ctx.driving
        ? 'Test-driving the branch — merge when it looks right.'
        : failed > 0
          ? `Run finished with ${failed} failed ticket${failed === 1 ? '' : 's'} — review, then ship.`
          : run
            ? 'Checks are in. Test-drive the branch, then merge to ship.'
            : 'No run has been recorded on this branch — test-drive it yourself before merging.'
      return {
        kick: 'NEXT STEP',
        title: ctx.driving ? 'Merge when it looks right' : 'Test drive, then ship',
        desc,
        primary: { label: 'Merge & ship', kind: 'merge' },
        secondary: [testDriveAction, ...iterate],
        busy: false,
        ...driveWarning,
      }
    }
    case 'shipped':
      return {
        kick: 'SHIPPED',
        title: 'Shipped to main',
        desc: 'The branch is merged and the pipeline is complete. Ask a question anytime.',
        primary: undefined,
        secondary: [{ label: 'Ask a question', kind: 'askQuestions' }],
        busy: false,
      }
  }
}

// --- the map rail (mapped ideation) ----------------------------------------

/**
 * The map doc's path, or undefined when the feature isn't mapped or nothing is
 * charted yet. One implementation so the rail's read and the next-step bar's fog
 * read resolve the SAME `docs.read` query key and share a single fetch.
 */
export function mapDocPath(full: FeatureFull): string | undefined {
  if (!full.feature.mapped) return undefined
  return full.docs.find((d) => d.relPath.endsWith('map.md'))?.relPath
}

/** Split `map.md` into a `{ heading: body }` map keyed by its `## ` sections. */
export function parseMapSections(content: string): Record<string, string> {
  const out: Record<string, string> = {}
  let current: string | null = null
  const buf: string[] = []
  const flush = () => {
    if (current !== null) out[current] = buf.join('\n')
    buf.length = 0
  }
  for (const line of content.split('\n')) {
    const heading = line.match(/^##\s+(.+?)\s*$/)
    if (heading) {
      flush()
      current = heading[1]
    } else if (current !== null) {
      buf.push(line)
    }
  }
  flush()
  return out
}

export type Waypoint = FeatureFull['waypoints'][number]

export type WaypointGroupKey = 'frontier' | 'claimed' | 'blocked' | 'done'

/**
 * One waypoint as the rail renders it: the row itself plus the bits the wire
 * only carries as references — `blockedBy` is a list of seqs and
 * `originWaypointId` an id, both meaningless to a human until resolved against
 * the sibling waypoints.
 */
export interface RailWaypoint {
  waypoint: Waypoint
  /** Titles of the blockers still standing — terminal ones no longer block. */
  blockerTitles: string[]
  /** Title of the waypoint that surfaced this one, when it has an origin. */
  originTitle?: string
  /** Starts expanded in the rail: the frontier is what the human chooses between. */
  expanded: boolean
}

export interface WaypointGroup {
  key: WaypointGroupKey
  label: string
  waypoints: RailWaypoint[]
}

const WAYPOINT_GROUP_LABELS: Record<WaypointGroupKey, string> = {
  frontier: 'Frontier',
  claimed: 'Claimed',
  blocked: 'Blocked',
  done: 'Resolved / dropped',
}

/** A waypoint that is finished with, either way it went. */
function isTerminal(w: Waypoint): boolean {
  return w.status === 'resolved' || w.status === 'dropped'
}

/**
 * The map rail's waypoint groups (decision #4), in display order: frontier,
 * claimed, blocked, then the resolved/dropped tail. Empty groups are omitted.
 * The frontier is server-derived (open, unclaimed, every blocker terminal) and
 * is ordered by ascending seq — charting order, the closest thing to authored
 * intent. Every other group keeps the order the server sent.
 */
export function waypointGroups(
  waypoints: Waypoint[],
  frontierIds: string[],
): WaypointGroup[] {
  const front = new Set(frontierIds)
  const byId = new Map(waypoints.map((w) => [w.id, w]))
  const bySeq = new Map(waypoints.map((w) => [w.seq, w]))

  const groupOf = (w: Waypoint): WaypointGroupKey => {
    if (isTerminal(w)) return 'done'
    if (w.status === 'claimed') return 'claimed'
    return front.has(w.id) ? 'frontier' : 'blocked'
  }

  const buckets: Record<WaypointGroupKey, RailWaypoint[]> = {
    frontier: [],
    claimed: [],
    blocked: [],
    done: [],
  }
  for (const w of waypoints) {
    const key = groupOf(w)
    buckets[key].push({
      waypoint: w,
      blockerTitles: w.blockedBy
        .map((seq) => bySeq.get(seq))
        .filter((b): b is Waypoint => !!b && !isTerminal(b))
        .map((b) => b.title),
      originTitle: w.originWaypointId ? byId.get(w.originWaypointId)?.title : undefined,
      expanded: key === 'frontier',
    })
  }
  buckets.frontier.sort((a, b) => a.waypoint.seq - b.waypoint.seq)

  const order: WaypointGroupKey[] = ['frontier', 'claimed', 'blocked', 'done']
  return order
    .map((key) => ({ key, label: WAYPOINT_GROUP_LABELS[key], waypoints: buckets[key] }))
    .filter((g) => g.waypoints.length > 0)
}

// --- the session strip's done state (decision #9) ---------------------------

/**
 * What the terminal strip has to say about a session whose waypoint is finished.
 * `notDone` is the ordinary live rendering; the other three are the done cases,
 * each carrying the resolved waypoint itself (its `summary` is the line the
 * human reads).
 */
export type SessionDoneState =
  | { kind: 'notDone' }
  /** Resolved, and the frontier has somewhere to go next — the one offered button. */
  | { kind: 'workNext'; waypoint: Waypoint; next: Waypoint }
  /** Resolved, frontier empty, research runs still holding claims — nothing to click. */
  | { kind: 'awaitingResearch'; waypoint: Waypoint; claimed: number }
  /** Resolved, and nothing is left open — the next-step bar owns Converge. */
  | { kind: 'mapComplete'; waypoint: Waypoint }

/**
 * The done state for the session the strip is rendering (decision #9). A session
 * owns the waypoint whose `lastSessionId` is its own — `resolve` clears
 * `claimedBy` but keeps that pointer, so the link survives resolution. It is only
 * promoted once the session actually went live, so a session that died on the way
 * up owns nothing and reads as not done; so does any session on a feature with no
 * waypoints at all.
 *
 * "Next" is the lowest-`seq` waypoint on the server-derived frontier — charting
 * order, the closest thing to authored intent, with the rest of the frontier one
 * glance away in the rail.
 */
export function sessionDoneState(
  full: FeatureFull,
  session: Pick<FeatureFull['sessions'][number], 'id'>,
): SessionDoneState {
  const waypoint = full.waypoints.find((w) => w.lastSessionId === session.id)
  if (!waypoint || !isTerminal(waypoint)) return { kind: 'notDone' }

  const next = full.waypoints
    .filter((w) => full.frontierIds.includes(w.id))
    .sort((a, b) => a.seq - b.seq)[0]
  if (next) return { kind: 'workNext', waypoint, next }

  // An empty frontier with claims still standing means AFK research is in flight
  // (a live session would be holding this feature's one terminal, which is ours).
  const claimed = full.waypoints.filter((w) => w.status === 'claimed').length
  if (claimed > 0) return { kind: 'awaitingResearch', waypoint, claimed }

  return { kind: 'mapComplete', waypoint }
}

/**
 * The live session a Work click would have to end, named by what it is holding
 * (decision #2/#8) — the card's inline confirm asks about *this*, so it needs a
 * human name for it, not a session id.
 */
export interface LiveSessionBlocker {
  sessionId: string
  kind: string
  /** Title of the waypoint that session still holds, when it holds one. */
  waypointTitle?: string
}

/**
 * The feature's live session and the still-open waypoint it claimed, if any.
 * `workWaypoint` ends a session it can prove is finished on its own, so this is
 * only consulted once the server has refused: it turns that refusal into the
 * card's confirm ("a session is live on X — end it and work this instead?").
 * A session whose waypoint has already resolved keeps no claim, so it reports
 * no title — and never reaches the confirm, because the server swept it.
 */
export function liveSessionBlocker(
  sessions: FeatureFull['sessions'],
  waypoints: Waypoint[],
): LiveSessionBlocker | undefined {
  const live = activeSession(sessions)
  if (!live) return undefined
  const held = waypoints.find((w) => w.status === 'claimed' && w.claimedBy === live.id)
  return { sessionId: live.id, kind: live.kind, waypointTitle: held?.title }
}

// --- the shipped body's Q&A terminal ----------------------------------------

/**
 * The sessions the shipped body's terminal panel should consider — the Q&A ones,
 * and only when one of them is worth a panel at all.
 *
 * "Ask a question" is the shipped bar's action, so the conversation it starts
 * belongs in the shipped body. Everything *else* on a shipped feature is a spent
 * pipeline session, and a resumable one of those is the grill's (or review's)
 * Resume, not shipped's — hence qa only. It reports nothing unless some qa session
 * is live/launching or ended with its conversation still on disk (a `ccSessionId`,
 * which only a session that reached live recorded — the launcher's own resume
 * test), so a shipped feature nobody has asked anything stays the plain hero
 * instead of growing an empty box.
 */
export function shippedQaSessions(sessions: FeatureFull['sessions']): FeatureFull['sessions'] {
  const qa = sessions.filter((s) => s.kind === 'qa')
  return qa.some((s) => s.status !== 'ended' || !!s.ccSessionId) ? qa : []
}

/**
 * When the branch landed — the `ts` of the feature's latest `feature.shipped`
 * event, or null when the log carries none (the feature isn't merged, or the
 * event predates the log this view holds).
 *
 * `feature.shipped` is the only event that records the merge. The hero used to
 * take the last event of `feature.shipped | merge.conflict | feature.status`,
 * but the merge emits `feature.shipped` and THEN `feature.status`, so the
 * reverse scan always landed on the status event and the shipped hero has never
 * shown a merge time. The server reads the same fact the same way
 * (`latestEventTs(ctx, id, 'feature.shipped')`). `events` must be in id order.
 */
export function shippedAt(events: EventRow[]): number | null {
  const shipped = [...events].reverse().find((e) => e.type === 'feature.shipped')
  return shipped ? shipped.ts : null
}
