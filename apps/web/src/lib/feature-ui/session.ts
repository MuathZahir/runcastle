import type { EventRow } from '@runcastle/core'
import type { FeatureFull } from '../api'
import { activeSession } from './gates'

// --- the Chat tab -------------------------------------------------------------

/**
 * The feature's one conversation by its session rows (one-chat-layout-everywhere
 * decision 5): the chat that is up, or — with none up — the newest chat row.
 * The chat column falls back on it for the main chat's thread while the thread
 * list cannot be read.
 *
 * `undefined` is a feature nobody has talked to yet: an empty thread.
 */
export function featureChat(sessions: FeatureFull['sessions']): FeatureFull['sessions'][number] | undefined {
  const chats = sessions.filter((s) => s.kind === 'chat')
  const ordered = [...chats].reverse()
  return ordered.find((s) => s.status !== 'ended') ?? ordered[0]
}

/**
 * A self-planning run (features-plan-themselves decision 9): the feature's chat
 * launched unattended, with nobody to answer its asks. The
 * bar, the Chat tab and the Chat door all key on this one reading.
 */
export function isSelfPlanRun(session: Pick<FeatureFull['sessions'][number], 'kind' | 'purpose'>): boolean {
  return session.kind === 'chat' && session.purpose === 'self-plan'
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
 * (one-chat-layout-everywhere decision 7): "● Chat live", with Open
 * chat — which switches to the Chat tab, where every session kind lives — and
 * End session. An ended session says nothing, and neither does a self-planning
 * run: the bar above already says it is working by itself with Stop as its one
 * control (features-plan-themselves decision 11).
 */
export interface LiveSessionLine {
  sessionId: string
  /** "Chat live" — what is up. */
  text: string
}

export function liveSessionLine(sessions: FeatureFull['sessions']): LiveSessionLine | null {
  const live = activeSession(sessions)
  if (!live || isSelfPlanRun(live)) return null
  return { sessionId: live.id, text: `${sessionKindName(live)} live` }
}

/**
 * A session named in plain words (decision 13) — `Chat`, `Drive fix`. The session strip leads with it and a pinned phase's session list
 * repeats it, so it lives here rather than in either of them.
 */
export function sessionKindName(
  session: Pick<FeatureFull['sessions'][number], 'kind'>,
): string {
  switch (session.kind) {
    case 'chat':
      return 'Agent'
    case 'drive-fix':
      return 'Drive fix'
    case 'prepare':
      return 'Preparation'
    case 'project':
      return 'Project'
    case 'scenario':
      return 'Scenario'
    case 'side':
      return 'Side session'
  }
}
