import { useEffect, useReducer, useRef } from 'react'
import type { EventRow } from '@runcastle/core'
import {
  deckReducer,
  noticeFor,
  type ChatNoticeKind,
  type ChatNoticeTarget,
  type NoticeTicket,
} from '../../lib/chat-notices'
import { NoticeDeck } from './NoticeDeck'

/**
 * The notice deck over a feature's Chat tab (one-chat-layout-everywhere
 * decisions 3, 4, 10), fed from the feature's event log.
 *
 * Only events that happen while the tab is in front raise a notice: on any
 * other tab the page already updates live, and nothing that happened before
 * the tab came to front — a reload on the Chat tab included — replays. "Before"
 * is by the event's own time, not by what the log has loaded yet, because the
 * log fills in its whole history on mount.
 *
 * Cards never expire. They leave by their action, which switches to the tab
 * that shows the change, or by ✕.
 */
export function FeatureNoticeDeck({
  events,
  tickets,
  active,
  onView,
}: {
  /** The feature's event log, oldest first (`useEventLog`). */
  events: readonly EventRow[]
  /** The feature's tickets — how a `ticket.done` is recognised as a review pass. */
  tickets: readonly NoticeTicket[]
  /** The Chat tab is in front. */
  active: boolean
  /** Switch the feature to the tab a notice points at. */
  onView: (target: ChatNoticeTarget) => void
}) {
  const [deck, dispatch] = useReducer(deckReducer, [])
  // When the tab came to front, or null while another tab is.
  const frontSince = useRef<number | null>(null)
  // The newest event already run through the mapping, so none raises twice.
  const handled = useRef(0)

  useEffect(() => {
    if (!active) {
      frontSince.current = null
      return
    }
    const since = (frontSince.current ??= Date.now())
    for (const event of events) {
      if (event.id <= handled.current) continue
      handled.current = event.id
      if (event.ts < since) continue
      const notice = noticeFor(event, tickets)
      if (notice) dispatch({ type: 'push', notice })
    }
  }, [active, events, tickets])

  const act = (kind: ChatNoticeKind) => {
    const notice = deck.find((n) => n.kind === kind)
    dispatch({ type: 'act', kind })
    if (notice) onView(notice.target)
  }

  return (
    <NoticeDeck
      notices={deck}
      onAct={act}
      onDismiss={(kind) => dispatch({ type: 'dismiss', kind })}
    />
  )
}
