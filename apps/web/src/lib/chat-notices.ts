import type { EventRow, Ticket } from '@runcastle/core'

/**
 * Chat notices (one-chat-layout-everywhere decisions 3, 4, 10): while a
 * feature's Chat tab is in front, the few changes elsewhere in that feature
 * worth looking up for raise a card that offers a way to the tab showing them.
 * Pure — the mapping from an event to a notice, and the deck those notices
 * collapse into. The Chat tab owns when to feed it.
 */

/** The collapse key: a repeat of the same kind counts up on one card. */
export type ChatNoticeKind = 'spec' | 'tickets' | 'ticket-failed' | 'run' | 'review' | 'drive'

/** The phase hue a notice wears (the `--color-phase-*` token), or danger. */
export type ChatNoticeHue = 'planning' | 'tickets' | 'building' | 'review' | 'danger'

/** The feature view tab a notice's action switches to. */
export type ChatNoticeTarget = 'overview' | 'tickets'

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
}

/** What `noticeFor` needs to know about a ticket to recognise a review pass. */
export type NoticeTicket = Pick<Ticket, 'id' | 'kind' | 'passKind' | 'title'>

const TICKET_EVENTS = new Set(['tickets.stored', 'ticket.edited', 'ticket.cancelled'])

/** `ticket 4 failed: typecheck failed` → seq 4, headline "typecheck failed". */
const TICKET_FAILED = /^ticket (\d+) failed(?::\s*(.*))?$/s

/** The burner's run headline counts: `5/6 tickets done`. */
const TICKETS_DONE = /(\d+)\/(\d+) tickets done/

/**
 * The notice an event raises in the Chat tab, or `null` for every event that
 * is not worth pulling the operator out of the conversation for — each locked
 * decision, notes, worktree and chat housekeeping, and the phase
 * moves the human made themselves (Burn, Merge).
 *
 * "Review ready" is the lap's review pass *finishing*: a `ticket.done` whose
 * ticket is a review-kind ticket on its review pass (not a verification pass).
 * `review.agentic-minted` is deliberately not it — that fires when the pass is
 * created, before any review has happened. `ticket.done` does not carry the
 * ticket's kind, so the caller passes the feature's tickets to tell a review
 * pass from an ordinary landing.
 */
export function noticeFor(event: EventRow, tickets: readonly NoticeTicket[] = []): ChatNotice | null {
  const notice = (n: Omit<ChatNotice, 'count' | 'eventId'>): ChatNotice => ({
    ...n,
    count: 1,
    eventId: event.id,
  })

  if (event.type === 'docs.changed') {
    if (!docsFiles(event).some((file) => file === 'spec.md' || file.endsWith('/spec.md'))) return null
    return notice({
      kind: 'spec',
      hue: 'planning',
      title: 'Spec written',
      subtitle: 'spec.md',
      actionLabel: 'View spec',
      target: 'overview',
    })
  }

  if (TICKET_EVENTS.has(event.type)) {
    return notice({
      kind: 'tickets',
      hue: 'tickets',
      title: 'Tickets updated',
      subtitle: event.message,
      actionLabel: 'View tickets',
      target: 'tickets',
    })
  }

  if (event.type === 'ticket.failed') {
    const match = TICKET_FAILED.exec(event.message)
    return notice({
      kind: 'ticket-failed',
      hue: 'danger',
      title: match ? `Ticket #${match[1]} failed` : 'Ticket failed',
      subtitle: match?.[2]?.trim() || event.message,
      actionLabel: 'View run',
      target: 'overview',
    })
  }

  if (event.type === 'run.finished') {
    const data = (event.data ?? {}) as { status?: unknown; summary?: unknown }
    const failed = data.status !== 'succeeded'
    const summary = typeof data.summary === 'string' ? data.summary : event.message
    const counts = TICKETS_DONE.exec(summary)
    return notice({
      kind: 'run',
      hue: failed ? 'danger' : 'building',
      title: failed ? 'Run finished with failures' : 'Run finished',
      subtitle: counts ? `${counts[1]} of ${counts[2]} landed` : summary,
      actionLabel: 'View run',
      target: 'overview',
    })
  }

  if (event.type === 'ticket.done') {
    const ticket = tickets.find((t) => t.id === event.ticketId)
    if (ticket?.kind !== 'review' || ticket.passKind === 'verification') return null
    return notice({
      kind: 'review',
      hue: 'review',
      title: 'Review ready',
      subtitle: ticket.title,
      actionLabel: 'View review',
      target: 'overview',
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
      target: 'overview',
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
