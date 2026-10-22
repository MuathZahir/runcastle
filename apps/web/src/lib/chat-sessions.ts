import { conversationTitle } from './conversation-title'
import { relTime } from './format'

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
  /**
   * A side session up behind it finished its turn and waits on the human — its
   * row's amber dot (several-sessions-per-feature decision 12).
   */
  waiting?: boolean
  /** A side session's entry: a conversation of its own beside the feature chat. */
  side?: boolean
}

/** One of the feature's side sessions, as `feature.sessions` lists it. */
export interface SideSessionRow {
  id: string
  title: string
  status: string
  awaitingInput: boolean
  createdAt: number | null
  endedAt?: number | null
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
 * up when that is not the chat itself (a lead, a revisit); the scenario chat
 * while a drive errand's session is live; then the feature's side sessions
 * (several-sessions-per-feature decision 10), live ones before ended ones, an
 * ended one carrying its age as the project's past chats do.
 */
export function featureChatEntries({
  featureLive,
  scenario,
  sides = [],
  now = Date.now(),
}: {
  /** The feature's own session, or null when nothing is up. */
  featureLive: { label: string } | null
  /** The drive errand's live session, while it is listed. */
  scenario: { sessionId: string; errand: ScenarioErrand } | null
  /** The feature's side sessions, in `feature.sessions`' order. */
  sides?: readonly SideSessionRow[]
  now?: number
}): ChatSessionEntry[] {
  const up = sides.filter((s) => s.status !== 'ended')
  const ended = sides.filter((s) => s.status === 'ended')
  const age = (s: SideSessionRow): number | null => s.endedAt ?? s.createdAt
  return [
    { id: FEATURE_CHAT, label: featureLive?.label ?? 'Feature chat', live: !!featureLive },
    ...(scenario ? [{ id: scenario.sessionId, label: scenarioChatLabel(scenario.errand), live: true }] : []),
    ...up.map((s) => ({ id: s.id, label: s.title, live: true, waiting: s.awaitingInput, side: true })),
    ...ended.map((s) => {
      const at = age(s)
      return { id: s.id, label: at === null ? s.title : `${s.title} · ${relTime(at, now)}`, live: false, side: true }
    }),
  ]
}

/**
 * The project page's entries (design-mode decision 11): the live project chat
 * first, then every ended one in the list's own order (newest first), each
 * opening its transcript. The conversation list carries the live one too; it
 * is listed once. A past chat carries its age, as the resting list shows it,
 * so a run of "Untitled chat"s still tells apart.
 */
export function projectChatEntries({
  liveId,
  conversations,
  now = Date.now(),
}: {
  liveId: string | null
  conversations: readonly { id: string; title: string | null; status: string; createdAt: number | null }[]
  now?: number
}): ChatSessionEntry[] {
  const live = conversations.find((c) => c.id === liveId)
  const ended = conversations.filter((c) => c.status === 'ended' && c.id !== liveId)
  const pastLabel = (c: (typeof ended)[number]) =>
    c.createdAt === null ? conversationTitle(c.title) : `${conversationTitle(c.title)} · ${relTime(c.createdAt, now)}`
  return [
    ...(liveId ? [{ id: liveId, label: conversationTitle(live?.title), live: true }] : []),
    ...ended.map((c) => ({ id: c.id, label: pastLabel(c), live: false })),
  ]
}

/**
 * The entry on show: the one picked while it is still listed, otherwise the
 * first — so a session that ends or is closed hands the column back.
 */
export function shownSession(entries: readonly ChatSessionEntry[], picked: string | null): ChatSessionEntry | undefined {
  return entries.find((e) => e.id === picked) ?? entries[0]
}
