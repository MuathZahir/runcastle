import { useState, type CSSProperties, type FocusEvent, type ReactNode } from 'react'
import { IconAlert, IconArrowRight, IconX, PHASE_NAME, PhaseIcon } from '../../icons'
import { BARE_BUTTON, cx, IconButton } from '../../ui'
import type { ChatNotice, ChatNoticeHue, ChatNoticeKind } from '../../lib/chat-notices'

/**
 * How many older cards peek behind the front one while the deck is collapsed,
 * and how far each one sits above the card in front of it.
 */
const PEEKING = 2
const PEEK_OFFSET_PX = 9

/**
 * Each hue's classes, spelled whole so Tailwind can see them. The card itself
 * stays neutral; the hue is on the icon chip, the eyebrow, the count, the
 * action and a faint glow from the top-left corner. The action is hand-rolled
 * rather than a `Button` because its tint changes per card, and no `Button`
 * variant carries a phase hue.
 */
const HUE: Record<ChatNoticeHue, { text: string; chip: string; tint: string; action: string; glow: string }> = {
  planning: {
    text: 'text-phase-planning',
    chip: 'bg-phase-planning/15 ring-phase-planning/30',
    tint: 'bg-phase-planning/15',
    action: 'bg-phase-planning/15 hover:bg-phase-planning/25',
    glow: 'from-phase-planning/10',
  },
  tickets: {
    text: 'text-phase-tickets',
    chip: 'bg-phase-tickets/15 ring-phase-tickets/30',
    tint: 'bg-phase-tickets/15',
    action: 'bg-phase-tickets/15 hover:bg-phase-tickets/25',
    glow: 'from-phase-tickets/10',
  },
  building: {
    text: 'text-phase-building',
    chip: 'bg-phase-building/15 ring-phase-building/30',
    tint: 'bg-phase-building/15',
    action: 'bg-phase-building/15 hover:bg-phase-building/25',
    glow: 'from-phase-building/10',
  },
  review: {
    text: 'text-phase-review',
    chip: 'bg-phase-review/15 ring-phase-review/30',
    tint: 'bg-phase-review/15',
    action: 'bg-phase-review/15 hover:bg-phase-review/25',
    glow: 'from-phase-review/10',
  },
  danger: {
    text: 'text-danger',
    chip: 'bg-danger/15 ring-danger/30',
    tint: 'bg-danger/15',
    action: 'bg-danger/15 hover:bg-danger/25',
    glow: 'from-danger/10',
  },
}

/** The eyebrow: the phase a notice belongs to. Both danger notices are the build's. */
const EYEBROW: Record<ChatNoticeHue, string> = {
  planning: PHASE_NAME.planning,
  tickets: PHASE_NAME.tickets,
  building: PHASE_NAME.building,
  review: PHASE_NAME.review,
  danger: PHASE_NAME.building,
}

function hueIcon(hue: ChatNoticeHue): ReactNode {
  return hue === 'danger' ? <IconAlert size={16} /> : <PhaseIcon phase={hue} label="" />
}

export interface NoticeDeckProps {
  /** Newest first, as `deckReducer` keeps them. */
  notices: readonly ChatNotice[]
  /** The card's action: the caller switches to the notice's target tab. */
  onAct: (kind: ChatNoticeKind) => void
  onDismiss: (kind: ChatNoticeKind) => void
}

/**
 * The Chat tab's notifications as one deck in the bottom-right corner of its
 * (relative) parent (decision 10). Collapsed, only the newest card is readable
 * and up to two older ones peek as edges behind it; hovering the deck, or
 * moving keyboard focus into it, fans every card out, newest at the bottom.
 * Cards never expire — they leave by their action or by ✕.
 */
export function NoticeDeck({ notices, onAct, onDismiss }: NoticeDeckProps) {
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const open = hovered || focused

  function onBlur(e: FocusEvent<HTMLDivElement>) {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false)
  }

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Chat notifications"
      data-open={open || undefined}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={onBlur}
      className="absolute right-4 bottom-4 z-20 w-[360px] max-w-[calc(100%-2rem)]"
    >
      {!open && notices.length > 1 && (
        <p className="m-0 mb-1 text-right text-xs text-text-tertiary">{notices.length} notifications</p>
      )}
      <ol
        className={cx(
          'm-0 list-none p-0',
          open ? 'flex flex-col-reverse gap-2' : 'relative',
          !open && notices.length > 1 && 'mt-[18px]',
        )}
      >
        {notices.map((notice, index) => {
          const behind = !open && index > 0
          const style: CSSProperties | undefined = behind
            ? { transform: `translateY(${-index * PEEK_OFFSET_PX}px) scale(${1 - index * 0.05})`, zIndex: -index }
            : undefined
          return (
            <li
              // A bump re-keys the card, so it rises in again at the front.
              key={`${notice.kind}-${notice.eventId}`}
              aria-hidden={behind || undefined}
              style={style}
              className={cx(
                'origin-bottom transition-[transform,opacity] duration-(--dur-3) ease-out-app',
                'motion-reduce:transition-none',
                behind && 'absolute inset-0',
                behind && index > PEEKING && 'opacity-0',
              )}
            >
              <NoticeCard notice={notice} hidden={behind} onAct={onAct} onDismiss={onDismiss} />
            </li>
          )
        })}
      </ol>
    </div>
  )
}

function NoticeCard({
  notice,
  hidden,
  onAct,
  onDismiss,
}: {
  notice: ChatNotice
  /** A peeking edge: the card's ground shows, its content does not. */
  hidden: boolean
  onAct: (kind: ChatNoticeKind) => void
  onDismiss: (kind: ChatNoticeKind) => void
}) {
  const hue = HUE[notice.hue]
  const content = cx('transition-opacity duration-(--dur-2) ease-app', hidden && 'invisible opacity-0')
  return (
    <article
      data-hue={notice.hue}
      // The entry motion lives here, not on the <li>: its `both` fill would pin
      // the transform the <li> uses to peek.
      className="relative grid h-full animate-rise-in grid-cols-[32px_1fr_24px] gap-x-3 overflow-hidden rounded-lg bg-surface-raised py-3 pr-3 pl-3.5 text-sm shadow-popover motion-reduce:animate-none"
    >
      <span
        aria-hidden="true"
        className={cx(
          'pointer-events-none absolute inset-0 bg-radial-[120%_90%_at_0%_0%] to-transparent to-60%',
          hue.glow,
        )}
      />
      <span
        aria-hidden="true"
        className={cx('relative grid size-8 place-items-center rounded-lg ring-1 ring-inset', hue.chip, hue.text, content)}
      >
        {hueIcon(notice.hue)}
      </span>
      <div className={cx('relative flex min-w-0 flex-col gap-px', content)}>
        <span className={cx('text-xs font-semibold tracking-wide uppercase', hue.text)}>{EYEBROW[notice.hue]}</span>
        <span className="flex items-center gap-2 font-semibold text-text">
          {notice.title}
          {notice.count > 1 && (
            <span
              aria-label={`${notice.count} times`}
              className={cx('rounded-full px-1.5 text-xs font-semibold tabular-nums', hue.tint, hue.text)}
            >
              ×{notice.count}
            </span>
          )}
        </span>
        <span className="text-xs [overflow-wrap:anywhere] text-text-secondary">{notice.subtitle}</span>
        <button
          type="button"
          onClick={() => onAct(notice.kind)}
          className={cx(
            BARE_BUTTON,
            'mt-2 inline-flex cursor-pointer items-center gap-1.5 self-start rounded-md px-2.5 py-1 text-xs font-semibold',
            'transition-colors duration-(--dur-1) ease-app',
            hue.action,
            hue.text,
          )}
        >
          {notice.actionLabel}
          <IconArrowRight size={12} />
        </button>
      </div>
      <IconButton
        label="Dismiss"
        size="sm"
        icon={<IconX size={12} />}
        onClick={() => onDismiss(notice.kind)}
        className={cx('relative', content)}
      />
    </article>
  )
}
