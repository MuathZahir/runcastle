import { useState } from 'react'
import type { ReactNode } from 'react'
import { INVOLVEMENT_HINT, INVOLVEMENT_LABEL, INVOLVEMENT_LEVELS, INVOLVEMENT_NAME, type Involvement } from '@runcastle/core'
import { IconArrowLeft, IconChevronDown, IconMore, IconPlus } from '../../icons'
import type { PanelView } from '../../lib/feature-ui/panel'
import { sidebarThreadOrder, useSidebarThreads } from '../../lib/sidebar-threads'
import { cx, IconButton, Sheet, SheetRow, StatusDot } from '../../ui'
import { ThreadGlyph } from '../SidebarParts'
import { PANEL_VIEW_ICON } from '../workspace/FeaturePanel'
import { LevelMark } from '../involvement/Involvement'

/**
 * A chat on the phone (docs/features/runcastle-on-your-phone decisions 1, 3):
 * the bar over it, the sheets it opens, and the full-screen views behind its
 * "…". The look is `apps/web/preview/phone.tsx`'s.
 */

/** What the chat bar says under its title: the words, and whether it waits on you or works. */
export interface PhoneChatStatus {
  words: string
  tone: 'waiting' | 'working' | 'quiet'
}

/** One line of the "…" sheet: a view the chat offers, with a hint of what it holds. */
export interface PhoneViewChoice {
  view: PanelView
  label: string
  hint?: string
}

/** A feature's "Involve me in" on the phone: the level, and the pick that saves a new one. */
export interface PhoneInvolvement {
  value: Involvement
  onChange: (level: Involvement) => void
  /** A save is in flight: the sheet still lists the levels, and a pick waits for it. */
  disabled?: boolean
}

/**
 * The phone's chat bar: Back to the list, the title — a sheet of the page's
 * threads, with New thread — the status words, and
 * "…" when the chat offers views or a feature's "Involve me in". The threads
 * are what the open page publishes, the same list the desktop sidebar draws.
 * The bar has no room for the header's picker, so "Involve me in" is a line
 * of the "…" sheet that opens a sheet of the four levels
 * (how-involved-am-i decision 3).
 */
export function PhoneChatBar({
  title,
  status,
  views = [],
  onView,
  onBack,
  involvement,
}: {
  title: string
  status?: PhoneChatStatus
  /** What its "…" opens; none, and there is no "…". */
  views?: readonly PhoneViewChoice[]
  onView?: (view: PanelView) => void
  onBack: () => void
  /** A feature's level, changeable from the "…" sheet; none, and the sheet has no such line. */
  involvement?: PhoneInvolvement
}) {
  const [sheet, setSheet] = useState<'threads' | 'views' | 'involvement' | null>(null)
  const published = useSidebarThreads()
  const threads = published ? sidebarThreadOrder(published.threads) : []
  // The sheet is also where New thread lives, so a lone chat opens it too.
  const switches = threads.length > 0
  const close = () => setSheet(null)
  const after = (act: () => void) => () => {
    close()
    act()
  }
  const titleBody = (
    <>
      <span className="flex min-w-0 items-center gap-1">
        <span className="truncate text-md font-medium text-text">{title}</span>
        {switches && <IconChevronDown size={14} className="shrink-0 text-icon" />}
      </span>
      {status && (
        <span className="flex items-center gap-1.5 text-xs text-text-tertiary">
          {status.tone === 'waiting' && <StatusDot tone="warning" />}
          <span className={cx('truncate', status.tone === 'working' && 'text-shimmer')}>{status.words}</span>
        </span>
      )}
    </>
  )
  return (
    <header className="flex h-13 shrink-0 items-center gap-1 border-b border-border-subtle bg-surface px-1.5">
      <IconButton label="Back to the list" size="lg" icon={<IconArrowLeft />} onClick={onBack} />
      {switches ? (
        <button
          type="button"
          aria-label={`${title} — switch chat`}
          onClick={() => setSheet('threads')}
          className="flex min-w-0 flex-1 cursor-pointer flex-col px-1 text-left"
        >
          {titleBody}
        </button>
      ) : (
        <div className="flex min-w-0 flex-1 flex-col px-1">{titleBody}</div>
      )}
      {(views.length > 0 || involvement) && <IconButton label="More" size="lg" icon={<IconMore />} onClick={() => setSheet('views')} />}
      {published && (
        <Sheet open={sheet === 'threads'} onClose={close} title={'featureId' in published.scope ? 'Chats' : 'Epics'}>
          {/* First, so it never needs a scroll however long the list (phone-fixes decision 1). */}
          {/* On a feature its threads are the lead's and its workers', so "+" is a new worker (interactive-workers decision 7). */}
          <SheetRow icon={<IconPlus />} label={'featureId' in published.scope ? 'New worker' : 'New epic'} onClick={after(published.newThread)} />
          {threads.map((t) => (
            <SheetRow
              key={t.id}
              icon={<ThreadGlyph state={t.state} />}
              label={t.title}
              current={t.id === published.current}
              onClick={after(() => published.pick(t.id))}
            />
          ))}
        </Sheet>
      )}
      <Sheet open={sheet === 'views'} onClose={close} label="Views">
        {views.map((v) => (
          <SheetRow key={v.view} icon={PANEL_VIEW_ICON[v.view]} label={v.label} {...(v.hint ? { hint: v.hint } : {})} onClick={after(() => onView?.(v.view))} />
        ))}
        {involvement && (
          <SheetRow
            icon={<LevelMark level={involvement.value} />}
            label={INVOLVEMENT_NAME}
            hint={INVOLVEMENT_LABEL[involvement.value]}
            onClick={() => setSheet('involvement')}
          />
        )}
      </Sheet>
      {involvement && (
        <Sheet open={sheet === 'involvement'} onClose={close} title={INVOLVEMENT_NAME}>
          {INVOLVEMENT_LEVELS.map((level) => (
            <SheetRow
              key={level}
              icon={<LevelMark level={level} />}
              label={INVOLVEMENT_LABEL[level]}
              hint={INVOLVEMENT_HINT[level]}
              current={level === involvement.value}
              onClick={after(() => {
                if (!involvement.disabled && level !== involvement.value) involvement.onChange(level)
              })}
            />
          ))}
        </Sheet>
      )}
    </header>
  )
}

/**
 * One of a chat's views at the phone's whole width (decision 3): a bar with
 * the way back to the chat, what it is and whose, then the view itself.
 */
export function PhoneViewScreen({
  title,
  sub,
  onBack,
  trailing,
  children,
}: {
  title: string
  sub?: string
  onBack: () => void
  /** A control at the bar's right edge, for the view's own choice. */
  trailing?: ReactNode
  children: ReactNode
}) {
  return (
    <section aria-label={title} className="flex min-h-0 min-w-0 flex-1 flex-col bg-surface">
      <header className="flex h-13 shrink-0 items-center gap-1 border-b border-border-subtle bg-surface px-1.5">
        <IconButton label="Back to the chat" size="lg" icon={<IconArrowLeft />} onClick={onBack} />
        <div className="flex min-w-0 flex-1 flex-col px-1">
          <span className="truncate text-md font-medium text-text">{title}</span>
          {sub && <span className="truncate text-xs text-text-tertiary">{sub}</span>}
        </div>
        {trailing}
      </header>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">{children}</div>
    </section>
  )
}
