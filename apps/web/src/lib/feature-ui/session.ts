import type { EventRow } from '@runcastle/core'
import type { FeatureFull } from '../api'
import { activeSession } from './gates'
import { isTerminal, type Waypoint } from './map'

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
  return qa.some((s) => s.status !== 'ended' || !!s.ccSessionId || s.transcriptMissing) ? qa : []
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

/**
 * A session named in plain words (decision 13) — `Ideation`, `Converge`,
 * `Lap 3`. The session strip leads with it and a pinned phase's session list
 * repeats it, so it lives here rather than in either of them.
 */
export function sessionKindName(
  session: Pick<FeatureFull['sessions'][number], 'kind' | 'lap'>,
): string {
  switch (session.kind) {
    case 'ideation':
      return 'Ideation'
    case 'converge':
      return 'Converge'
    case 'revisit':
      return session.lap > 1 ? `Lap ${session.lap}` : 'Revisit'
    case 'qa':
      return 'Question'
    case 'waypoint':
      return 'Waypoint'
    case 'drive-fix':
      return 'Drive fix'
    case 'prepare':
      return 'Preparation'
    case 'project':
      return 'Project'
  }
}
