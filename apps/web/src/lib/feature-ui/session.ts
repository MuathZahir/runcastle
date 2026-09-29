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

// --- the Chat tab -------------------------------------------------------------

/**
 * The feature's one conversation, as the Chat tab reads it back when nothing is
 * live (one-chat-layout-everywhere decision 5): the chat that is up, or — with
 * none up — the newest chat row, whose transcript is what Resume picks up.
 *
 * `undefined` is a feature nobody has talked to yet, which the tab answers with
 * Start rather than an empty transcript.
 */
export function featureChat(sessions: FeatureFull['sessions']): FeatureFull['sessions'][number] | undefined {
  const chats = sessions.filter((s) => s.kind === 'chat')
  const ordered = [...chats].reverse()
  return ordered.find((s) => s.status !== 'ended') ?? ordered[0]
}

/**
 * The Chat tab strip's context line for whichever session is live
 * (decision 9): "Chat · lap 2", "Waypoint · <title>", "Converge", "Drive fix".
 * A waypoint session is named by the waypoint it holds — its claim while open,
 * its `lastSessionId` once resolved — and by its kind alone when it holds none.
 */
export function chatContextLine(
  session: Pick<FeatureFull['sessions'][number], 'id' | 'kind' | 'lap'>,
  waypoints: readonly Waypoint[],
): string {
  switch (session.kind) {
    case 'chat':
      return `Chat · lap ${session.lap}`
    case 'waypoint': {
      const held = waypoints.find((w) => w.claimedBy === session.id || w.lastSessionId === session.id)
      return held ? `Waypoint · ${held.title}` : 'Waypoint'
    }
    default:
      return sessionKindName(session)
  }
}

// --- the shipped body's chat terminal ---------------------------------------

/**
 * The sessions the shipped body's terminal panel should consider — the feature's
 * chat, and only when it is worth a panel at all.
 *
 * Chat is the shipped bar's action, so the conversation it resumes belongs in
 * the shipped body. Everything *else* on a shipped feature is a spent pipeline
 * session (a converge, a waypoint, a drive fix), which has no door here — hence
 * chat only. It reports nothing unless some chat session is live/launching or
 * ended with its conversation still on disk (a `ccSessionId`, which only a
 * session that reached live recorded — the launcher's own resume test), so a
 * shipped feature nobody has talked to stays the plain hero instead of growing
 * an empty box.
 */
export function shippedChatSessions(sessions: FeatureFull['sessions']): FeatureFull['sessions'] {
  const chats = sessions.filter((s) => s.kind === 'chat')
  return chats.some((s) => s.status !== 'ended' || !!s.ccSessionId || s.transcriptMissing)
    ? chats
    : []
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
 * The one line a live session gets on Overview, in every state
 * (one-chat-layout-everywhere decision 7): "● Chat live · lap 2", with Open
 * chat — which switches to the Chat tab, where every session kind lives — and
 * End session. An ended session says nothing.
 */
export interface LiveSessionLine {
  sessionId: string
  /** "Chat live · lap 1" — what is up, and the lap it opened in. */
  text: string
}

export function liveSessionLine(sessions: FeatureFull['sessions']): LiveSessionLine | null {
  const live = activeSession(sessions)
  if (!live) return null
  return { sessionId: live.id, text: `${sessionKindName(live)} live · lap ${live.lap}` }
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
    case 'chat':
      return 'Chat'
    case 'converge':
      return 'Converge'
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
