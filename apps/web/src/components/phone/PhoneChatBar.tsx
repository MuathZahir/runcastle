import { useState } from 'react'
import type { ReactNode } from 'react'
import { IconArrowLeft, IconChevronDown, IconMore, IconPlus } from '../../icons'
import type { PanelView } from '../../lib/feature-ui/panel'
import { sidebarThreadOrder, useSidebarThreads } from '../../lib/sidebar-threads'
import { cx, IconButton, Sheet, SheetRow, StatusDot } from '../../ui'
import { ThreadGlyph } from '../SidebarParts'
import { PANEL_VIEW_ICON } from '../workspace/FeaturePanel'

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

/**
 * The phone's chat bar: Back to the list, the title — a sheet of the page's
 * threads when it has more than one, with New thread — the status words, and
 * "…" when the chat offers views. The threads are what the open page
 * publishes, the same list the desktop sidebar draws.
 */
export function PhoneChatBar({
  title,
  status,
  views = [],
  onView,
  onBack,
}: {
  title: string
  status?: PhoneChatStatus
  /** What its "…" opens; none, and there is no "…". */
  views?: readonly PhoneViewChoice[]
  onView?: (view: PanelView) => void
  onBack: () => void
}) {
  const [sheet, setSheet] = useState<'threads' | 'views' | null>(null)
  const published = useSidebarThreads()
  const threads = published ? sidebarThreadOrder(published.threads) : []
  const switches = threads.length > 1
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
          aria-label={`${title} — switch thread`}
          onClick={() => setSheet('threads')}
          className="flex min-w-0 flex-1 cursor-pointer flex-col px-1 text-left"
        >
          {titleBody}
        </button>
      ) : (
        <div className="flex min-w-0 flex-1 flex-col px-1">{titleBody}</div>
      )}
      {views.length > 0 && <IconButton label="More" size="lg" icon={<IconMore />} onClick={() => setSheet('views')} />}
      {published && (
        <Sheet open={sheet === 'threads'} onClose={close} title="Threads">
          {threads.map((t) => (
            <SheetRow
              key={t.id}
              icon={<ThreadGlyph state={t.state} />}
              label={t.title}
              current={t.id === published.current}
              onClick={after(() => published.pick(t.id))}
            />
          ))}
          <SheetRow icon={<IconPlus />} label="New thread" onClick={after(published.newThread)} />
        </Sheet>
      )}
      <Sheet open={sheet === 'views'} onClose={close} label="Views">
        {views.map((v) => (
          <SheetRow key={v.view} icon={PANEL_VIEW_ICON[v.view]} label={v.label} {...(v.hint ? { hint: v.hint } : {})} onClick={after(() => onView?.(v.view))} />
        ))}
      </Sheet>
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
