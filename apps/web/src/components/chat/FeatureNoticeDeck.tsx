import { useEffect, useReducer, useRef } from 'react'
import type { EventRow } from '@runcastle/core'
import {
  deckReducer,
  noticeFor,
  type ChatNoticeKind,
  type ChatNoticeTarget,
  type NoticeTicket,
  type StandingNotice,
} from '../../lib/chat-notices'
import { NoticeStrip } from './NoticeStrip'

/**
 * The feature chat's notices (one-chat-layout-everywhere decisions 3, 4, 10),
 * fed from the feature's event log and shown as the strip on the composer's
 * top edge (the-chat-looks-the-part decision 18).
 *
 * Only events that happen while the tab is in front raise a notice: on any
 * other tab the page already updates live, and nothing that happened before
 * the tab came to front — a reload on the Chat tab included — replays. "Before"
 * is by the event's own time, not by what the log has loaded yet, because the
 * log fills in its whole history on mount.
 *
 * Notices leave by their action, which switches to the tab that shows the
 * change, or by ✕ — and one that only confirms the human's own click ("Test
 * drive running") by itself, after its `expiresAfterMs`.
 */
export function FeatureNoticeDeck({
  events,
  tickets,
  standing = [],
  active,
  onView,
}: {
  /** The feature's event log, oldest first (`useEventLog`). */
  events: readonly EventRow[]
  /** The feature's tickets — how a `ticket.done` is recognised as a review pass. */
  tickets: readonly NoticeTicket[]
  /** The warnings that stand above the event notices while their condition holds. */
  standing?: readonly StandingNotice[]
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

  // A card with a lifetime leaves by itself. Any change to the deck restarts
  // the countdowns, so a burst that bumps the card gives it its full time again.
  useEffect(() => {
    const timers = deck.flatMap((n) =>
      n.expiresAfterMs === undefined
        ? []
        : [setTimeout(() => dispatch({ type: 'dismiss', kind: n.kind }), n.expiresAfterMs)],
    )
    return () => timers.forEach(clearTimeout)
  }, [deck])

  const act = (kind: ChatNoticeKind) => {
    const notice = deck.find((n) => n.kind === kind)
    dispatch({ type: 'act', kind })
    if (notice) onView(notice.target)
  }

  return (
    <NoticeStrip
      notices={deck}
      standing={standing}
      onAct={act}
      onDismiss={(kind) => dispatch({ type: 'dismiss', kind })}
    />
  )
}
