import { nextPhase } from '@runcastle/core'
import type { Phase } from '@runcastle/core'
import type { FeatureFull, FeatureListItem } from './api'

/**
 * Client-side feature derivations (UI-SPEC §2/§3): sidebar glyph, needs-me
 * classification, and the overview primary-action state machine. Pure functions
 * over wire data — no IO.
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

export type NeedsMeKind = 'grill' | 'burn' | 'attention' | 'ship'

export interface NeedsMe {
  kind: NeedsMeKind
  label: string
}

/**
 * Which features need me (UI-SPEC §2). Computed from `feature.list` data:
 * feature phase + ticket counts + active-run flag. A failed run leaves failed
 * tickets, so `ticketCounts.failed` is the list-level proxy for "run failed".
 *
 * Note: "ideation & no-live-session" — `feature.list` omits sessions, so the
 * grilling dot shows for any active ideation feature; the live-session nuance is
 * reflected in the overview primary action (which uses full `feature.get` data).
 */
export function needsMe(f: FeatureListItem): NeedsMe | null {
  if (f.status === 'shipped' || f.status === 'archived') return null
  if (f.activeRun) return null // burning: shown as a spinner, not a needs-me dot
  if (f.ticketCounts.failed > 0)
    return { kind: 'attention', label: 'run failed — needs attention' }
  if (f.phase === 'ideation') return { kind: 'grill', label: 'needs grilling' }
  if (f.phase === 'tickets' && f.ticketCounts.total > 0)
    return { kind: 'burn', label: 'review & burn tickets' }
  if (f.phase === 'review') return { kind: 'ship', label: 'test & merge' }
  return null
}

/** Sidebar sort: needs-me first, then active, then shipped (dimmed). Stable
 *  within groups (the server returns newest-first). */
export function sortForSidebar(features: FeatureListItem[]): FeatureListItem[] {
  const rank = (f: FeatureListItem): number => {
    if (f.status === 'shipped') return 2
    if (needsMe(f)) return 0
    return 1
  }
  return [...features]
    .map((f, i) => ({ f, i }))
    .sort((a, b) => rank(a.f) - rank(b.f) || a.i - b.i)
    .map((x) => x.f)
}

// --- overview primary-action state machine (UI-SPEC §3) --------------------

export type PrimaryActionKind =
  | 'startGrill'
  | 'openGrill'
  | 'reviewTickets'
  | 'startBurn'
  | 'watchRun'
  | 'testDrive'
  | 'merge'
  | 'askQuestions'

export interface PrimaryAction {
  kind: PrimaryActionKind
  label: string
  /** Session to focus for `openGrill`. */
  sessionId?: string
  /** Run to focus for `watchRun`. */
  runId?: string
}

/**
 * The single solid button on the overview (UI-SPEC §3):
 * Start grilling → Open live grill → Review tickets → (Burn in tickets tab) →
 * Watch run → Merge → Ask questions. Test driving at `review` is optional and
 * lives as a secondary action, so the primary here no longer depends on it.
 */
export function primaryAction(full: FeatureFull): PrimaryAction {
  const { feature, sessions, runs } = full
  const liveSession = sessions.find((s) => s.status === 'live')

  switch (feature.phase) {
    case 'ideation':
    case 'spec':
      return liveSession
        ? { kind: 'openGrill', label: 'Open live grill', sessionId: liveSession.id }
        : { kind: 'startGrill', label: 'Start grilling' }
    case 'tickets':
      return { kind: 'reviewTickets', label: 'Review tickets' }
    case 'implementation': {
      const run = latestRun(runs)
      // A live run → watch it. No active run means the burn was cancelled or
      // crashed (or G3 was overridden without starting one): offer to (re)start
      // the burn so the feature never dead-ends at `implementation`.
      if (run && run.status === 'running') {
        return { kind: 'watchRun', label: 'Watch run', runId: run.id }
      }
      return { kind: 'startBurn', label: 'Start burn' }
    }
    case 'review':
      // Merge is the primary action whether or not a test drive is active — the
      // server stops an active drive of this feature before merging. Test driving
      // first is optional (offered as a secondary action on the overview).
      return { kind: 'merge', label: 'Merge' }
    case 'shipped':
      return { kind: 'askQuestions', label: 'Ask questions' }
  }
}

/** One-line state summary shown above the primary action (UI-SPEC §3). */
export function stateSummary(full: FeatureFull, driving: boolean): string {
  const { feature, tickets, sessions, runs } = full
  const live = sessions.some((s) => s.status === 'live')
  const t = tickets.length
  const done = tickets.filter((x) => x.status === 'done').length
  const failed = tickets.filter((x) => x.status === 'failed').length
  switch (feature.phase) {
    case 'ideation':
      return live
        ? 'Grilling in progress — decisions accumulate in Knowledge.'
        : 'Grill the agent to capture decisions and shape the work.'
    case 'spec':
      return live ? 'Writing the spec beside the conversation.' : 'Spec in progress.'
    case 'tickets':
      return `${t} ticket${t === 1 ? '' : 's'} ready — review, then burn.`
    case 'implementation': {
      const run = latestRun(runs)
      // Only claim a burn is in progress when a run is actually running —
      // otherwise be honest that it hasn't started / was cancelled.
      if (!run) return `Burn not started — ${t} ticket${t === 1 ? '' : 's'} ready. Start the burn.`
      if (run.status === 'running') {
        return `Burning ${t} ticket${t === 1 ? '' : 's'} — ${done} done${failed ? `, ${failed} failed` : ''}.`
      }
      if (run.status === 'cancelled') return 'Run cancelled — start the burn to retry.'
      if (run.status === 'failed') return 'Run failed — start the burn to retry.'
      return `Burn not started — ${t} ticket${t === 1 ? '' : 's'} ready. Start the burn.`
    }
    case 'review':
      if (driving) return 'Test driving the branch — merge when it looks right.'
      return failed
        ? `Run finished with ${failed} failed ticket${failed === 1 ? '' : 's'} — review, then ship.`
        : 'Run complete — merge to ship, or test drive it first.'
    case 'shipped':
      return 'Shipped. Ask questions anytime.'
  }
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

/** True when `spec` is skipped for this feature (collapsed size). */
export function skipsSpec(feature: { size: FeatureListItem['size'] }): boolean {
  return feature.size === 'collapsed'
}

// --- triage sidebar --------------------------------------------------------

export type TriageKey = 'needsYou' | 'agentWorking' | 'inProgress' | 'shipped' | 'archived'

export interface TriageGroup {
  key: TriageKey
  label: string
  features: FeatureListItem[]
}

/**
 * Which triage lane a feature belongs to. Order of checks matters — the first
 * match wins. Archived wins over everything: an archived feature carries no
 * needs-me / working state, it only sits in the archived lane.
 */
export function triageOf(f: FeatureListItem): TriageKey {
  if (f.status === 'archived') return 'archived'
  if (f.status === 'shipped') return 'shipped'
  if (f.activeRun) return 'agentWorking'
  if (needsMe(f)) return 'needsYou'
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
    shipped: [],
    archived: [],
  }
  for (const f of features) buckets[triageOf(f)].push(f)

  const order: { key: TriageKey; label: string }[] = [
    { key: 'needsYou', label: 'Needs you' },
    { key: 'agentWorking', label: 'Agent working' },
    { key: 'inProgress', label: 'In progress' },
    { key: 'shipped', label: 'Shipped' },
  ]
  if (opts.showArchived) order.push({ key: 'archived', label: 'Archived' })
  return order
    .map(({ key, label }) => ({ key, label, features: buckets[key] }))
    .filter((g) => g.features.length > 0)
}

// --- pipeline (sidebar mini-map + workspace stepper) -----------------------

export type StepState = 'done' | 'current' | 'upcoming' | 'skipped'

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

function stepState(feature: { phase: Phase; size: FeatureListItem['size'] }, phase: Phase): StepState {
  if (skipsSpec(feature) && phase === 'spec') return 'skipped'
  const ci = phaseIndex(feature.phase)
  const pi = phaseIndex(phase)
  if (pi < ci) return 'done'
  if (pi === ci) return 'current'
  return 'upcoming'
}

/** Compact 6-segment lifecycle map for a sidebar row. */
export function miniSegments(
  feature: { phase: Phase; size: FeatureListItem['size'] },
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
  feature: { phase: Phase; size: FeatureListItem['size'] },
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
  | 'startGrill' // launchSession { kind: 'ideation' }
  | 'openGrill' // focus the live session in the body
  | 'advance' // feature.advance (crosses non-human gates G1/G2/G4)
  | 'burn' // feature.burn (G3, and resume a parked run)
  | 'cancelRun' // run.cancel
  | 'testDriveStart' // feature.testDrive { action: 'start' }
  | 'testDriveStop' // feature.testDrive { action: 'stop' }
  | 'merge' // feature.merge (G5)
  | 'askQuestions' // launchSession { kind: 'qa' }
  | 'revisit' // launchSession { kind: 'revisit' } — resume the old conversation, amend docs + tickets
  | 'archive' // feature.archive — hide the feature, end any live session
  | 'unarchive' // feature.unarchive — restore the feature to its lane

export interface NextAction {
  label: string
  kind: ActionKind
  danger?: boolean
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
}

/**
 * The single guided next step for a feature's *current* phase (app-redesign).
 * Gate-aware: when the gate guarding the next phase is satisfied and crossable
 * without a human-only gate (G3 Burn / G5 Merge), the primary action becomes the
 * promotion; otherwise it's the work action for this phase (grill / burn / …).
 *
 * This supersedes {@link primaryAction} + {@link stateSummary} for the redesign,
 * but reuses the same wire data.
 */
export function nextStep(full: FeatureFull, ctx: { driving: boolean }): NextStep {
  const { feature, tickets, sessions, runs, gate } = full
  const live = sessions.find((s) => s.status === 'live')
  const t = tickets.length
  const done = tickets.filter((x) => x.status === 'done').length
  const failed = tickets.filter((x) => x.status === 'failed').length
  const run = latestRun(runs)
  const running = run?.status === 'running'
  const nextName = nextPhase(feature)

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
      // Mapped features converge instead of promoting: the map's Converge button
      // (in the body, beside the fog) crosses G1 and spawns the converge session.
      // The next-step bar just narrates — it never shows a plain `advance`, which
      // would bump the phase without a session (ADR-0001 §13.6).
      if (feature.mapped) {
        return {
          kick: 'MAP',
          title: gate.satisfied ? 'Converge the map' : 'Work the frontier',
          desc: gate.satisfied
            ? 'Every waypoint is resolved — converge to draft the spec and tickets.'
            : gate.reason ?? 'Resolve the open waypoints; converge once the frontier clears.',
          primary: live ? { label: 'Jump to grill', kind: 'openGrill' } : undefined,
          secondary: [],
          busy: false,
        }
      }
      if (canAdvance) {
        return {
          kick: 'NEXT STEP',
          title: 'Promote the idea',
          desc: 'Decisions are captured — promote the idea when it feels concrete.',
          primary: { label: promoteLabel, kind: 'advance' },
          secondary: live ? [{ label: 'Back to grill', kind: 'openGrill' }] : [],
          busy: false,
        }
      }
      if (live) {
        return {
          kick: 'GRILL LIVE',
          title: 'Grill session in progress',
          desc: 'Shape the idea with Claude — decisions accumulate in Knowledge.',
          primary: { label: 'Jump to grill', kind: 'openGrill' },
          secondary: [],
          busy: false,
        }
      }
      return {
        kick: 'NEXT STEP',
        title: 'Shape the idea with Claude',
        desc: 'Launch a grill session to shape the idea before any code is written.',
        primary: { label: 'Start grill session', kind: 'startGrill' },
        secondary: [],
        busy: false,
      }
    }
    case 'spec': {
      if (canAdvance) {
        return {
          kick: 'NEXT STEP',
          title: 'Approve the spec',
          desc: 'The spec is written — approve it to move into tickets.',
          primary: { label: 'Approve spec → tickets', kind: 'advance' },
          secondary: live ? [{ label: 'Back to grill', kind: 'openGrill' }] : [],
          busy: false,
        }
      }
      return live
        ? {
            kick: 'GRILL LIVE',
            title: 'Writing the spec',
            desc: 'The spec takes shape beside the conversation.',
            primary: { label: 'Jump to grill', kind: 'openGrill' },
            secondary: [],
            busy: false,
          }
        : {
            kick: 'NEXT STEP',
            title: 'Write the spec',
            desc: 'No spec yet — resume the grill to draft it.',
            primary: { label: 'Resume grill', kind: 'startGrill' },
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
          primary: { label: `Burn ${t} ticket${t === 1 ? '' : 's'}`, kind: 'burn' },
          // Revisit resumes the grilling conversation to amend docs/tickets —
          // only offered when no session is live (one terminal per feature).
          secondary: live
            ? [{ label: 'Back to grill', kind: 'openGrill' }]
            : [{ label: 'Revisit', kind: 'revisit' }],
          busy: false,
        }
      }
      return {
        kick: 'WAITING',
        title: 'Waiting for tickets',
        desc: 'No tickets yet — a grill session emits them. Open a session to shape the work.',
        primary: live
          ? { label: 'Jump to grill', kind: 'openGrill' }
          : { label: 'Open grill to emit tickets', kind: 'startGrill' },
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
      const why =
        run?.status === 'failed'
          ? 'The run failed — resume the burn to retry.'
          : run?.status === 'cancelled'
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
      const desc = ctx.driving
        ? 'Test-driving the branch — merge when it looks right.'
        : failed > 0
          ? `Run finished with ${failed} failed ticket${failed === 1 ? '' : 's'} — review, then ship.`
          : 'Checks are in. Test-drive the branch, then merge to ship.'
      return {
        kick: 'NEXT STEP',
        title: ctx.driving ? 'Merge when it looks right' : 'Test drive, then ship',
        desc,
        primary: { label: 'Merge & ship', kind: 'merge' },
        secondary: ctx.driving
          ? [{ label: 'Stop test drive', kind: 'testDriveStop' }]
          : [{ label: 'Start test drive', kind: 'testDriveStart' }],
        busy: false,
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
