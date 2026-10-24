import type { FeatureFull, FeatureListItem } from '../api'
import { relTime } from '../format'
import { blockerList, blockers, isWaiting } from './dependencies'

/**
 * Why a feature needs me: its chat stopped for my `input`, or it is `waiting`
 * with a reason — the agent's own words, 'stopped', or 'ready to test'.
 */
export type NeedsMeKind = 'input' | 'waiting'

export interface NeedsMe {
  kind: NeedsMeKind
  label: string
}

/** The waiting reason `declare_ready` sets (tickets-and-review decision 7). */
export const READY_TO_TEST = 'ready to test'

/**
 * An open terminal whose agent is mid-turn — the HITL twin of `activeRun`.
 * A terminal still launching counts: nothing has stopped for anyone yet.
 */
function agentMidTurn(f: FeatureListItem): boolean {
  return !!f.liveSession && !f.liveSession.awaitingInput
}

/**
 * Which features need me, from facts alone (tickets-and-review decision 7):
 * a running round or an agent mid-turn wants nothing from me; a chat stopped
 * for my answer does; so does a waiting reason — the agent asked, the human
 * pressed Stop, the provider halted, or the agent declared ready. Neither the
 * phase nor failed tickets count: failures are the agent's to handle after the
 * round wakes it, and it asks when it can't.
 */
export function needsMe(f: FeatureListItem): NeedsMe | null {
  // A parked draft claims no attention until the human clicks Start (decision 9).
  if (f.status === 'draft') return null
  if (f.status === 'shipped' || f.status === 'archived') return null
  if (f.activeRun) return null // a round running: shown as working, not a needs-me dot
  // An agent mid-turn is working, whatever reason it left earlier.
  if (f.liveSession && !f.liveSession.awaitingInput) return null
  // The reason outranks the bare "chat is waiting": an agent that declared ready
  // or asked a question ends its turn, so its chat is awaiting input too.
  if (f.waitingReason) return { kind: 'waiting', label: f.waitingReason }
  if (f.liveSession?.awaitingInput) return { kind: 'input', label: 'the chat is waiting on you' }
  return null
}

/**
 * The feature's ticket progress as a share, 0..1: done over every ticket not
 * cancelled — all of the feature's tickets, which simply accumulate. 0 with none.
 */
export function ticketShare(f: FeatureListItem): number {
  const { total, done, cancelled } = f.ticketCounts
  const counted = total - cancelled
  return counted > 0 ? done / counted : 0
}

/** The state a feature's `ProgressIcon` wears: draft ring, shipped check, else the pie. */
export function progressState(f: FeatureListItem): 'draft' | 'active' | 'shipped' {
  if (f.status === 'draft') return 'draft'
  if (f.status === 'shipped') return 'shipped'
  return 'active'
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
  // One that waits on unmerged work says what it waits on (ADR-0013 decision 6).
  if (f.status === 'draft') {
    const open = blockers(f.dependsOn)
    if (open.length === 0)
      return { kind: 'draft', text: 'In the backlog', title: 'parked — click Start to cut its branch' }
    const text = open.length === 1 ? `Waits on ${open[0]!.slug}` : `Waits on ${open.length}`
    return { kind: 'draft', text, title: `waits on ${blockerList(f.dependsOn)}` }
  }
  const text = relTime(f.lastActivityAt, now)
  return { kind: 'age', text, title: `last activity ${text === 'now' ? 'just now' : `${text} ago`}` }
}

/**
 * A feature's ticket progress as the row's words ("3/7"), or null when it has
 * no tickets: done over every ticket not cancelled, the share the glyph's pie
 * draws. A tight row writes counts as fractions (DESIGN.md §Content); null
 * rather than "0/0", because a figure about nothing is noise.
 */
export function ticketProgress(f: FeatureListItem): string | null {
  const { total, done, cancelled } = f.ticketCounts
  const counted = total - cancelled
  return counted > 0 ? `${done}/${counted}` : null
}

/** Stable sort by a rank, lowest first — ties keep their incoming order. */
function stableByRank(features: FeatureListItem[], rank: (f: FeatureListItem) => number): FeatureListItem[] {
  return [...features]
    .map((f, i) => ({ f, i }))
    .sort((a, b) => rank(a.f) - rank(b.f) || a.i - b.i)
    .map((x) => x.f)
}

/** Within the drafts, the startable ones above those still waiting (ADR-0013). */
const draftRank = (f: FeatureListItem): number => (isWaiting(f) ? 1 : 0)

/** Sidebar sort: needs-me first, then active, then parked drafts (ready before
 *  waiting), then shipped (both dimmed). Stable within groups (the server
 *  returns newest-first). */
export function sortForSidebar(features: FeatureListItem[]): FeatureListItem[] {
  return stableByRank(features, (f) => {
    if (f.status === 'shipped') return 4
    // Parked ideas sit below work in motion and above shipped history
    // (decision 9) — more alive than a merged branch, not in the pipeline.
    if (f.status === 'draft') return 2 + draftRank(f)
    if (needsMe(f)) return 0
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
 * incoming order within each lane (the server returns newest-first) — except
 * that ready drafts sort above waiting ones in theirs (ADR-0013). Empty lanes
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
  buckets.drafts = stableByRank(buckets.drafts, draftRank)

  const order: { key: TriageKey; label: string }[] = [
    { key: 'needsYou', label: 'Needs you' },
    { key: 'agentWorking', label: 'Agent working' },
    { key: 'inProgress', label: 'In progress' },
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
 * Drafts, Shipped and Archived are deliberately absent: entering a project used
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
