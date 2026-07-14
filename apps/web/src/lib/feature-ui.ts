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
  if (f.status === 'shipped') return null
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
 * Watch run → Test drive → Merge → Ask questions.
 *
 * `driving` = a client-tracked active test drive on this feature (status bar).
 */
export function primaryAction(full: FeatureFull, driving: boolean): PrimaryAction {
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
      return driving
        ? { kind: 'merge', label: 'Merge' }
        : { kind: 'testDrive', label: 'Test drive' }
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
        : 'Run complete — test drive, then merge.'
    case 'shipped':
      return 'Shipped. Ask questions anytime.'
  }
}

function latestRun(runs: FeatureFull['runs']): FeatureFull['runs'][number] | undefined {
  if (runs.length === 0) return undefined
  return [...runs].sort((a, b) => b.startedAt - a.startedAt)[0]
}

export { latestRun }
