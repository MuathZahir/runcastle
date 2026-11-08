import { type EventRow, PREVIEW_FILE } from '@runcastle/core'
import type { PanelView } from './feature-ui/panel'

/**
 * Chat notices (one-chat-layout-everywhere decisions 3, 4, 10): while a
 * feature's chat is on screen, the few changes elsewhere in that feature
 * worth looking up for raise a card that offers to open the panel view
 * showing them. Pure — the mapping from an event to a notice, and the deck
 * those notices collapse into. The chat owns when to feed it.
 */

/** The collapse key: a repeat of the same kind counts up on one card. */
export type ChatNoticeKind = 'preview' | 'spec' | 'history' | 'drive'

/** The phase hue a notice wears (the `--color-phase-*` token), or danger. */
export type ChatNoticeHue = 'planning' | 'tickets' | 'building' | 'review' | 'danger'

/** The panel view a notice's action opens beside the chat (design-mode decision 5). */
export type ChatNoticeTarget = Extract<PanelView, 'plan' | 'work' | 'drive'>

export interface ChatNotice {
  kind: ChatNoticeKind
  hue: ChatNoticeHue
  title: string
  subtitle: string
  actionLabel: string
  target: ChatNoticeTarget
  /** How many events this card stands for (a burst counts up). */
  count: number
  /** The newest event behind the card. */
  eventId: number
  /** A card that only confirms the human's own click leaves by itself after this long. */
  expiresAfterMs?: number
}

/**
 * A row on the strip that stands while its condition holds and goes when it
 * ends (the-feature-s-right-panel decision 21) — a merge conflict, a refused
 * review drive — rather than one an event raised. It has an action only where
 * the warning has one, and a ✕ only where it can be waved away.
 */
export interface StandingNotice {
  key: string
  hue: ChatNoticeHue
  title: string
  subtitle: string
  /** What a one-liner cannot hold: a conflict's file list, a refusal's raw message. */
  tooltip?: string
  action?: { label: string; onClick: () => void; disabled?: boolean }
  onDismiss?: () => void
}

/** How long "Test drive running" stays:the human just started it, and the drive opens beside the chat. */
export const DRIVE_NOTICE_MS = 5000

/**
 * The frozen ticket and round history's events (burns-become-workers decision
 * 19): nothing emits them any more, and nothing about them can be acted on.
 */
const HISTORY_EVENTS = new Set(['tickets.stored', 'ticket.edited', 'ticket.cancelled', 'ticket.failed', 'run.finished'])

/**
 * The notice an event raises over the chat, or `null` for every event that
 * is not worth pulling the operator out of the conversation for — each locked
 * decision, notes, worktree and chat housekeeping, and the phase
 * moves the human made themselves (Merge).
 *
 * An old ticket or round event reads as a plain history note that opens the
 * History view, the event's own words its subtitle: it never offers a round
 * to act on.
 */
export function noticeFor(event: EventRow): ChatNotice | null {
  const notice = (n: Omit<ChatNotice, 'count' | 'eventId'>): ChatNotice => ({
    ...n,
    count: 1,
    eventId: event.id,
  })

  if (event.type === 'docs.changed') {
    const files = docsFiles(event)
    const names = (name: string) => files.some((file) => file === name || file.endsWith(`/${name}`))
    // The preview first: the session asks the human to look at it, and a write
    // that also touched the spec is still the preview they were asked about.
    if (names(PREVIEW_FILE)) {
      return notice({
        kind: 'preview',
        hue: 'planning',
        title: 'Preview ready',
        subtitle: PREVIEW_FILE,
        actionLabel: 'View preview',
        target: 'plan',
      })
    }
    if (!names('spec.md')) return null
    return notice({
      kind: 'spec',
      hue: 'planning',
      title: 'Spec written',
      subtitle: 'spec.md',
      actionLabel: 'View spec',
      target: 'plan',
    })
  }

  if (HISTORY_EVENTS.has(event.type)) {
    return notice({
      kind: 'history',
      hue: 'tickets',
      title: 'Ticket history',
      subtitle: event.message,
      actionLabel: 'View history',
      target: 'work',
    })
  }

  if (event.type === 'testdrive.url') {
    const data = (event.data ?? {}) as { url?: unknown }
    return notice({
      kind: 'drive',
      hue: 'review',
      title: 'Test drive running',
      subtitle: typeof data.url === 'string' ? data.url : event.message,
      actionLabel: 'Open',
      target: 'drive',
      expiresAfterMs: DRIVE_NOTICE_MS,
    })
  }

  return null
}

/** The files a `docs.changed` names (docs-watch's `data.files`). */
function docsFiles(event: EventRow): string[] {
  const files = (event.data as { files?: unknown } | undefined)?.files
  return Array.isArray(files) ? files.filter((f): f is string => typeof f === 'string') : []
}

/** The most cards the deck holds; a push past it drops the oldest. */
export const DECK_CAP = 4

export type DeckAction =
  | { type: 'push'; notice: ChatNotice }
  | { type: 'dismiss'; kind: ChatNoticeKind }
  | { type: 'act'; kind: ChatNoticeKind }

/**
 * The deck, newest first. A push of a kind already held is a burst: that card
 * counts up, takes the new subtitle and moves to the front. A new kind goes in
 * front and, past `DECK_CAP`, the oldest falls out. Dismiss (✕) and act (the
 * card's button) both take the card away.
 */
export function deckReducer(state: readonly ChatNotice[], action: DeckAction): ChatNotice[] {
  switch (action.type) {
    case 'push': {
      const held = state.find((n) => n.kind === action.notice.kind)
      const front = held ? { ...action.notice, count: held.count + action.notice.count } : action.notice
      return [front, ...state.filter((n) => n.kind !== action.notice.kind)].slice(0, DECK_CAP)
    }
    case 'dismiss':
    case 'act':
      return state.filter((n) => n.kind !== action.kind)
  }
}
