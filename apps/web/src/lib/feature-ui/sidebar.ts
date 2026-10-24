import { stuckReason, unstartedState, type UnstartedState } from '@runcastle/core'
import type { FeatureFull, FeatureListItem } from '../api'
import { relTime } from '../format'
import { blockerList, blockers, upNextHint } from './dependencies'

/** Where an unstarted feature stands (decision 7 / spec "Derived states"); null once started. */
const draftState = (f: FeatureListItem): UnstartedState | null => unstartedState(f, f.dependsOn)

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
  // attention until the human clicks Start, whatever its phase says. The one
  // exception is an Up next feature that cannot start by itself any more
  // (waiting-is-not-backlog decision 5) — the backlog itself never asks.
  if (f.status === 'draft') {
    return draftState(f) === 'stuck'
      ? { kind: 'attention', label: f.upNextProblem ?? stuckReason(f.dependsOn) }
      : null
  }
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
  if (f.phase === 'planning') return f.ticketCounts.total > 0
    ? { kind: 'burn', label: 'review & burn tickets' }
    : { kind: 'grill', label: 'needs planning' }
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
  // A parked idea's age is noise, not news (decision 9) — say what it IS instead:
  // Up next says what it starts after; a backlog row whether it could start
  // (waiting-is-not-backlog decision 7).
  const state = draftState(f)
  if (state) {
    const open = blockers(f.dependsOn)
    const named = (verb: string) => (open.length === 1 ? `${verb} ${open[0]!.slug}` : `${verb} ${open.length}`)
    if (state === 'upNext') return { kind: 'draft', text: named('After'), title: upNextHint(f.dependsOn) }
    if (state === 'blocked')
      return { kind: 'draft', text: named('Blocked by'), title: `blocked by ${blockerList(f.dependsOn)}` }
    if (state === 'readyToStart')
      return { kind: 'draft', text: 'Ready to start', title: 'everything it waited on shipped — click Start to cut its branch' }
    return { kind: 'draft', text: 'In the backlog', title: 'parked — click Start to cut its branch' }
  }
  const text = relTime(f.lastActivityAt, now)
  return { kind: 'age', text, title: `last activity ${text === 'now' ? 'just now' : `${text} ago`}` }
}

/**
 * A feature's ticket progress as the row's trailing meta ("3/7"), or null when
 * this lap has no tickets. It is this lap's `lapTally` — the same count the
 * feature page states — not an all-laps total; earlier laps' totals live in the
 * lap trail. A tight row writes counts as fractions (DESIGN.md §Content); null
 * rather than "0/0", because a figure about nothing is noise.
 */
export function ticketProgress(f: FeatureListItem): string | null {
  const { total, landed } = f.lapTally
  return total > 0 ? `${landed}/${total}` : null
}

/** Stable sort by a rank, lowest first — ties keep their incoming order. */
function stableByRank(features: FeatureListItem[], rank: (f: FeatureListItem) => number): FeatureListItem[] {
  return [...features]
    .map((f, i) => ({ f, i }))
    .sort((a, b) => rank(a.f) - rank(b.f) || a.i - b.i)
    .map((x) => x.f)
}

/**
 * Within the Backlog, the ones that could start now first, then the plain
 * parked ideas, then those still blocked (waiting-is-not-backlog decision 7).
 */
const BACKLOG_RANK: Partial<Record<UnstartedState, number>> = { readyToStart: 0, backlog: 1, blocked: 2 }
const draftRank = (f: FeatureListItem): number => {
  const state = draftState(f)
  return (state && BACKLOG_RANK[state]) ?? 0
}

/** Sidebar sort: needs-me first, then active, then Up next, then the backlog
 *  (ready, parked, blocked), then shipped (both dimmed). Stable within groups
 *  (the server returns newest-first). */
export function sortForSidebar(features: FeatureListItem[]): FeatureListItem[] {
  return stableByRank(features, (f) => {
    if (f.status === 'shipped') return 6
    if (needsMe(f)) return 0
    // Parked ideas sit below work in motion and above shipped history
    // (decision 9) — more alive than a merged branch, not in the pipeline.
    // Up next is between the two: wanted, but not moving yet.
    const state = draftState(f)
    if (state === 'upNext') return 2
    if (state) return 3 + draftRank(f)
    return 1
  })
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

export type TriageKey =
  | 'needsYou'
  | 'agentWorking'
  | 'inProgress'
  | 'upNext'
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
  // Its own band (decision 9): a parked draft carries no working state, so it
  // never interleaves with things in motion. Up next has a band of its own,
  // and one that can no longer start by itself needs you (waiting-is-not-backlog
  // decisions 5 and 7).
  const state = draftState(f)
  if (state === 'upNext') return 'upNext'
  if (state === 'stuck') return 'needsYou'
  if (state) return 'drafts'
  if (f.activeRun) return 'agentWorking'
  if (needsMe(f)) return 'needsYou'
  if (agentMidTurn(f)) return 'agentWorking'
  return 'inProgress'
}

/**
 * Group features into the sidebar's triage lanes (app-redesign). Preserves the
 * incoming order within each lane (the server returns newest-first) — except
 * that the Backlog sorts ready-to-start first and blocked last. Up next sits
 * after the lanes of work in motion and before Backlog, placed by meaning
 * (waiting-is-not-backlog decision 16). Empty lanes
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
    upNext: [],
    drafts: [],
    shipped: [],
    archived: [],
  }
  for (const f of features) buckets[triageOf(f)].push(f)
  buckets.drafts = stableByRank(buckets.drafts, draftRank)

  const order: { key: TriageKey; label: string }[] = [
    { key: 'needsYou', label: 'Needs you' },
    { key: 'agentWorking', label: 'Agent working' },
    { key: 'inProgress', label: 'In progress' },
    { key: 'upNext', label: 'Up next' },
    { key: 'drafts', label: 'Backlog' },
    { key: 'shipped', label: 'Shipped' },
  ]
  if (opts.showArchived) order.push({ key: 'archived', label: 'Archived' })
  return order
    .map(({ key, label }) => ({ key, label, features: buckets[key] }))
    .filter((g) => g.features.length > 0)
}

/** The sidebar's features: what waits on the human, and the lanes under it. */
export interface SidebarLanes {
  /** Exactly the Needs you lane's features — what waits on the human. */
  inbox: FeatureListItem[]
  /** Every other non-empty lane, in {@link triage}'s order. */
  lanes: TriageGroup[]
}

/**
 * Split the triage into what needs the human, first in the sidebar, and the
 * lanes the sidebar draws under it (stopped rows, Working, the shelves). The
 * first is the Needs you lane lifted out; the rest is {@link triage} unchanged.
 */
export function sidebarLanes(
  features: FeatureListItem[],
  opts: { showArchived?: boolean } = {},
): SidebarLanes {
  const groups = triage(features, opts)
  return {
    inbox: groups.find((g) => g.key === 'needsYou')?.features ?? [],
    lanes: groups.filter((g) => g.key !== 'needsYou'),
  }
}

/**
 * The lanes a project can land you in (decision 4), in the rail's own order.
 * Up next, Drafts, Shipped and Archived are deliberately absent: entering a project used
 * to open `list.data[0]` — newest-created, lane-blind — which is how a parked
 * draft or a shipped feature's retrospective became the first thing you saw
 * (findings F10.4).
 */
const LANDING_LANES: readonly TriageKey[] = ['needsYou', 'agentWorking', 'inProgress']

/**
 * The feature to land on when entering a project with nothing stored, or `null`
 * for the project home — which is where a project with only drafts, shipped and
 * archived features lands, because none of those is work in motion.
 *
 * The rail already answers "what should I look at": this reads the same triage
 * order over the same list, so the workspace opens on the row the eye lands on.
 * A stored selection still wins over this, and a URL naming a feature wins over
 * both — both of those are decided by the caller.
 */
export function landingFeature(features: FeatureListItem[]): FeatureListItem | null {
  for (const lane of LANDING_LANES) {
    const first = features.find((f) => triageOf(f) === lane)
    if (first) return first
  }
  return null
}

// --- pipeline (sidebar mini-map + workspace stepper) -----------------------
