import { useState, type ReactNode } from 'react'
import { IconAlert, IconX, PhaseIcon } from '../../icons'
import { BARE_BUTTON, Button, cx, IconButton } from '../../ui'
import type { ChatNotice, ChatNoticeHue, ChatNoticeKind, StandingNotice } from '../../lib/chat-notices'
import { RAISED } from './thread/surfaces'

/**
 * Each hue's glyph colour, spelled whole so Tailwind can see it. The strip
 * itself stays neutral: the phase shows by the glyph's shape first, its hue
 * second (DESIGN.md principles 2 and 3).
 */
const HUE: Record<ChatNoticeHue, string> = {
  planning: 'text-phase-planning',
  tickets: 'text-phase-tickets',
  building: 'text-phase-building',
  review: 'text-phase-review',
  danger: 'text-danger',
}

function hueIcon(hue: ChatNoticeHue): ReactNode {
  return hue === 'danger' ? <IconAlert size={16} /> : <PhaseIcon phase={hue} label="" />
}

export interface NoticeStripProps {
  /** Newest first, as `deckReducer` keeps them. */
  notices: readonly ChatNotice[]
  /** The warnings that hold while their condition does, above the notices and never folded. */
  standing?: readonly StandingNotice[]
  /** The notice's action: the caller opens the panel view it points at. */
  onAct: (kind: ChatNoticeKind) => void
  onDismiss: (kind: ChatNoticeKind) => void
}

const DIVIDED = 'border-b border-border-subtle'

/**
 * What happened while you were in the chat (a round finished, a ticket
 * failed, the plan is ready), on the composer's top edge where your eye
 * already is (the-chat-looks-the-part decision 18), never over the messages.
 * One line: the newest notice with its action; older ones fold behind
 * "+N more" and open above it, oldest at the top. A notice leaves by its
 * action, by ✕, or — a confirmation of your own click — by itself.
 *
 * Above them, the standing rows (the-feature-s-right-panel decision 21): a
 * merge conflict, a refused review drive. Each shows while its condition
 * holds and goes when it ends, so none folds and none has a ✕ unless it can
 * be waved away.
 */
export function NoticeStrip({ notices, standing = [], onAct, onDismiss }: NoticeStripProps) {
  const [open, setOpen] = useState(false)
  if (notices.length === 0 && standing.length === 0) return null
  const [newest, ...older] = notices
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Chat notifications"
      className={cx(RAISED, 'flex flex-col overflow-hidden animate-rise-in')}
    >
      {standing.map((row, i) => (
        <NoticeRow
          key={row.key}
          hue={row.hue}
          title={row.title}
          subtitle={row.subtitle}
          {...(row.tooltip ? { tooltip: row.tooltip } : {})}
          {...(row.action ? { action: row.action } : {})}
          {...(row.onDismiss ? { onDismiss: row.onDismiss } : {})}
          {...(newest || i < standing.length - 1 ? { className: DIVIDED } : {})}
        />
      ))}
      {open &&
        [...older].reverse().map((n) => (
          <EventRow key={`${n.kind}-${n.eventId}`} notice={n} onAct={onAct} onDismiss={onDismiss} className={DIVIDED} />
        ))}
      {newest && (
        <EventRow
          // A bump re-keys the row, so it rises in again.
          key={`${newest.kind}-${newest.eventId}`}
          notice={newest}
          onAct={onAct}
          onDismiss={onDismiss}
          aside={
            older.length > 0 && (
              <button
                type="button"
                aria-expanded={open}
                onClick={() => setOpen(!open)}
                className={cx(
                  BARE_BUTTON,
                  'h-6 shrink-0 cursor-pointer rounded-md px-1.5 text-xs tabular-nums text-text-tertiary',
                  'transition-colors duration-(--dur-1) ease-app hover:bg-surface-hover hover:text-text-secondary',
                )}
              >
                {open ? 'Show less' : `+${older.length} more`}
              </button>
            )
          }
        />
      )}
    </div>
  )
}

/** An event's notice: always its action and its ✕, both answered by kind. */
function EventRow({
  notice,
  onAct,
  onDismiss,
  aside,
  className,
}: {
  notice: ChatNotice
  onAct: (kind: ChatNoticeKind) => void
  onDismiss: (kind: ChatNoticeKind) => void
  /** Before the action: the strip's "+N more". */
  aside?: ReactNode
  className?: string
}) {
  return (
    <NoticeRow
      hue={notice.hue}
      title={notice.title}
      count={notice.count}
      subtitle={notice.subtitle}
      aside={aside}
      action={{ label: notice.actionLabel, onClick: () => onAct(notice.kind) }}
      onDismiss={() => onDismiss(notice.kind)}
      {...(className ? { className } : {})}
    />
  )
}

function NoticeRow({
  hue,
  title,
  count = 1,
  subtitle,
  tooltip,
  aside,
  action,
  onDismiss,
  className,
}: {
  hue: ChatNoticeHue
  title: string
  count?: number
  subtitle: string
  tooltip?: string
  aside?: ReactNode
  action?: StandingNotice['action']
  onDismiss?: () => void
  className?: string
}) {
  return (
    <article
      data-hue={hue}
      title={tooltip}
      className={cx('flex h-11 min-w-0 items-center gap-2.5 pr-2 pl-3.5 text-sm animate-fade-in', className)}
    >
      <span aria-hidden="true" className={cx('grid shrink-0 place-items-center', HUE[hue])}>
        {hueIcon(hue)}
      </span>
      <span className="shrink-0 font-medium text-text">{title}</span>
      {count > 1 && (
        <span aria-label={`${count} times`} className="shrink-0 text-xs tabular-nums text-text-tertiary">
          ×{count}
        </span>
      )}
      <span className="min-w-0 flex-1 truncate text-text-secondary">{subtitle}</span>
      {aside}
      {action && (
        <Button size="sm" disabled={action.disabled} onClick={action.onClick} className="shrink-0">
          {action.label}
        </Button>
      )}
      {onDismiss && <IconButton label="Dismiss" size="sm" icon={<IconX size={12} />} onClick={onDismiss} />}
    </article>
  )
}
