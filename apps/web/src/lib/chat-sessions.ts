import { conversationTitle } from './conversation-title'

/**
 * The chat column's sessions (design-mode decision 9): one column shows one
 * conversation at a time, and the switcher in its header lists the ones it can
 * show. Pure — the entries a page offers, and which of them is on show. A list
 * rather than a two-way toggle, so side sessions (*Several sessions per
 * feature*) join it without another layout change.
 */

/** One conversation the column can show. */
export interface ChatSessionEntry {
  id: string
  label: string
  /** A session is up behind it, rather than a transcript to read back. */
  live: boolean
}

/** The feature chat's entry id: the feature's one session, whichever it is. */
export const FEATURE_CHAT = 'feature'

/** What a scenario chat was opened for: ＋ New scenario, or Fix it on one. */
export type ScenarioErrand = { kind: 'new' } | { kind: 'fix'; name: string }

export function scenarioChatLabel(errand: ScenarioErrand): string {
  return `Scenario chat · ${errand.kind === 'fix' ? `Fix ${errand.name}` : 'New scenario'}`
}

/**
 * The feature page's entries: the feature chat always, named for the session
 * up when that is not the chat itself (a lead, a revisit); and the scenario
 * chat while a drive errand's session is live.
 */
export function featureChatEntries({
  featureLive,
  scenario,
}: {
  /** The feature's own session, or null when nothing is up. */
  featureLive: { label: string } | null
  /** The drive errand's live session, while it is listed. */
  scenario: { sessionId: string; errand: ScenarioErrand } | null
}): ChatSessionEntry[] {
  return [
    { id: FEATURE_CHAT, label: featureLive?.label ?? 'Feature chat', live: !!featureLive },
    ...(scenario ? [{ id: scenario.sessionId, label: scenarioChatLabel(scenario.errand), live: true }] : []),
  ]
}

/**
 * The project page's entries (design-mode decision 11): the live project chat
 * first, then every ended one in the list's own order (newest first), each
 * opening its transcript. The conversation list carries the live one too; it
 * is listed once.
 */
export function projectChatEntries({
  liveId,
  conversations,
}: {
  liveId: string | null
  conversations: readonly { id: string; title: string | null; status: string }[]
}): ChatSessionEntry[] {
  const live = conversations.find((c) => c.id === liveId)
  const ended = conversations.filter((c) => c.status === 'ended' && c.id !== liveId)
  return [
    ...(liveId ? [{ id: liveId, label: conversationTitle(live?.title), live: true }] : []),
    ...ended.map((c) => ({ id: c.id, label: conversationTitle(c.title), live: false })),
  ]
}

/**
 * The entry on show: the one picked while it is still listed, otherwise the
 * first — so a session that ends or is closed hands the column back.
 */
export function shownSession(entries: readonly ChatSessionEntry[], picked: string | null): ChatSessionEntry | undefined {
  return entries.find((e) => e.id === picked) ?? entries[0]
}
