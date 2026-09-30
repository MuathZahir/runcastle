import type { EventRow } from '@runcastle/core'
import type { FeatureFull } from '../api'
import { activeSession } from './gates'

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
 * (decision 9): "Chat · lap 2", "Drive fix".
 */
export function chatContextLine(session: Pick<FeatureFull['sessions'][number], 'kind' | 'lap'>): string {
  return session.kind === 'chat' ? `Chat · lap ${session.lap}` : sessionKindName(session)
}

// --- the shipped body's chat terminal ---------------------------------------

/**
 * The sessions the shipped body's terminal panel should consider — the feature's
 * chat, and only when it is worth a panel at all.
 *
 * Chat is the shipped bar's action, so the conversation it resumes belongs in
 * the shipped body. Everything *else* on a shipped feature is a spent pipeline
 * session (a drive fix), which has no door here — hence
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
 * A session named in plain words (decision 13) — `Chat`, `Drive fix`. The session strip leads with it and a pinned phase's session list
 * repeats it, so it lives here rather than in either of them.
 */
export function sessionKindName(
  session: Pick<FeatureFull['sessions'][number], 'kind' | 'lap'>,
): string {
  switch (session.kind) {
    case 'chat':
      return 'Chat'
    // retired kind — removed with the enum by the contract ticket
    case 'converge':
    case 'waypoint':
      return 'Chat'
    case 'drive-fix':
      return 'Drive fix'
    case 'prepare':
      return 'Preparation'
    case 'project':
      return 'Project'
  }
}
