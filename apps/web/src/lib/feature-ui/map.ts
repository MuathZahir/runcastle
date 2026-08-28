import type { FeatureFull } from '../api'

export function mapDocPath(full: FeatureFull): string | undefined {
  if (!full.feature.mapped) return undefined
  return full.docs.find((d) => d.relPath.endsWith('map.md'))?.relPath
}

/**
 * Split a doc into a `{ heading: body }` map keyed by its `## ` sections —
 * `map.md`'s frontier prose, and `spec.md`'s deferred scope ({@link
 * deferredScope}).
 */
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
export function isTerminal(w: Waypoint): boolean {
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
