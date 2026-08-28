import type { FeatureFull, FeatureListItem } from '../api'
import { relTime } from '../format'

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
