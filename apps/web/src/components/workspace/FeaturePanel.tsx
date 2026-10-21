import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import {
  INITIAL_PANEL,
  isPanelView,
  panelReducer,
  type PanelAction,
  type PanelState,
  type PanelView,
} from '../../lib/feature-ui/panel'
import { useRailWidth, type RailWidthSpec } from '../../lib/rail-width'
import type { FeatureView } from '../../lib/routes'
import { Button, IconButton, cx } from '../../ui'
import { SELECT_GHOST, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select'
import { IconArrowLeft, IconChevronRight, IconEye, IconInfo, IconList, IconPen, IconPlay, IconX } from '../../icons'

/**
 * The feature page's one panel (design-mode decisions 4, 5): the split it
 * shares with the chat, the divider between them, and the panel's own header.
 * What the views say is `panel.ts`; which view is open is the shell's, so the
 * address bar names it.
 */

/** Every view leads with an icon (DESIGN.md principle 7). */
export const PANEL_VIEW_ICON: Record<PanelView, ReactNode> = {
  body: <IconList />,
  preview: <IconEye />,
  design: <IconPen />,
  drive: <IconPlay />,
  details: <IconInfo />,
}

/**
 * The panel's share of the row, in thousandths so the rail-width machinery's
 * integer clamp holds it. A screen preference like every rail width, so one
 * key for the whole browser.
 */
export const PANEL_SHARE: RailWidthSpec = { key: 'runcastle.feature.panel', min: 0, max: 1000, default: 500 }

export interface PanelApi {
  state: PanelState
  dispatch: (action: PanelAction) => void
}

/**
 * The panel's state: the open view is `view` (the shell's), everything else
 * — the size, the fold, the design path and who opened it — is held here, the
 * size remembered per browser. A dispatch that changes the view hands it back
 * through `onViewChange`, `chat` for the panel closed.
 */
export function usePanel(view: PanelView | null, onViewChange: (view: FeatureView) => void): PanelApi {
  const { width, setWidth } = useRailWidth(PANEL_SHARE)
  const [rest, setRest] = useState<Pick<PanelState, 'path' | 'origin' | 'collapsed'>>({
    collapsed: INITIAL_PANEL.collapsed,
  })
  const state: PanelState = { ...rest, view, share: width / PANEL_SHARE.max }

  // Read through a ref so `dispatch` is stable: the stream handler and the
  // mutation callbacks that call it outlive the render they were made in.
  const current = useRef({ state, onViewChange })
  current.current = { state, onViewChange }

  const dispatch = useCallback(
    (action: PanelAction) => {
      const before = current.current.state
      const { view: nextView, share, path, origin, collapsed } = panelReducer(before, action)
      setRest({ collapsed, ...(path !== undefined ? { path } : {}), ...(origin ? { origin } : {}) })
      if (share !== before.share) setWidth(share * PANEL_SHARE.max)
      if (nextView !== before.view) current.current.onViewChange(nextView ?? 'chat')
    },
    [setWidth],
  )
  return { state, dispatch }
}

/** Below this much content width the panel floats over the chat instead of beside it. */
const OVERLAY = '@max-[1100px]'

/**
 * The row the chat and the panel share. The chat is the same element whether
 * the panel is open or not, so opening one never remounts the terminal. The
 * divider drags either side down to nothing and its double-click toggles an
 * even split and the panel full; folded, the panel is a strip at the edge.
 * Under ~1100px of content width the panel floats over the chat
 * (`shadow-dialog`) — a container query, so it answers to the content panel.
 */
export function PanelSplit({
  chat,
  panel,
  share,
  collapsed,
  strip,
  onResize,
  onToggleFull,
}: {
  chat: ReactNode
  /** The open panel, or a falsy value for the chat alone. */
  panel: ReactNode
  /** The panel's share of the row, 0..1. */
  share: number
  collapsed: boolean
  /** What the folded strip holds. */
  strip?: ReactNode
  onResize: (share: number) => void
  onToggleFull: () => void
}) {
  const row = useRef<HTMLDivElement>(null)
  const open = !(panel === null || panel === undefined || panel === false)
  return (
    <div ref={row} className="@container relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">{chat}</div>
      {open &&
        (collapsed ? (
          <div className="flex w-10 shrink-0 flex-col items-center gap-1 border-l border-border bg-surface py-2">
            {strip}
          </div>
        ) : (
          <div
            data-panel
            style={{ width: `${share * 100}%` }}
            className={cx(
              'relative flex min-h-0 min-w-0 shrink-0 flex-col border-l border-border bg-surface',
              `${OVERLAY}:absolute ${OVERLAY}:inset-y-0 ${OVERLAY}:right-0 ${OVERLAY}:z-20 ${OVERLAY}:shadow-dialog`,
            )}
          >
            <PanelDivider share={share} row={row} onResize={onResize} onToggleFull={onToggleFull} />
            {panel}
          </div>
        ))}
    </div>
  )
}

/**
 * The divider, on the panel's left edge — `RailResizeHandle`'s drag (a delta
 * from the grab, mouse only, text selection suspended), measured as a share of
 * the row rather than in pixels, so either side can reach nothing.
 */
function PanelDivider({
  share,
  row,
  onResize,
  onToggleFull,
}: {
  share: number
  row: RefObject<HTMLDivElement | null>
  onResize: (share: number) => void
  onToggleFull: () => void
}) {
  const [dragging, setDragging] = useState(false)
  const origin = useRef({ x: 0, share, width: 0 })

  useEffect(() => {
    if (!dragging) return
    const onMove = (e: MouseEvent) => {
      const { x, share: from, width } = origin.current
      if (width > 0) onResize(from + (x - e.clientX) / width)
    }
    const onUp = () => setDragging(false)
    const previousUserSelect = document.body.style.userSelect
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.body.style.userSelect = previousUserSelect
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
  }, [dragging, onResize])

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the panel"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(share * 100)}
      title="Drag to resize · double-click: half or full"
      className={cx(
        'absolute top-0 -left-[3px] z-10 h-full w-1.5 cursor-col-resize transition-colors duration-(--dur-1) ease-app hover:bg-border-strong',
        dragging && 'bg-border-strong',
      )}
      onMouseDown={(e) => {
        e.preventDefault()
        origin.current = { x: e.clientX, share, width: row.current?.getBoundingClientRect().width ?? 0 }
        setDragging(true)
      }}
      onDoubleClick={onToggleFull}
    />
  )
}

/**
 * The open panel: a header with the view switcher (the views this state
 * offers), the design view's path, fold and close — then the view itself,
 * scrolling on its own.
 */
export function FeaturePanel({
  view,
  views,
  label,
  path,
  onSwitch,
  onCollapse,
  onClose,
  children,
}: {
  view: PanelView
  views: readonly PanelView[]
  label: (view: PanelView) => string
  path?: string
  onSwitch: (view: PanelView) => void
  onCollapse: () => void
  onClose: () => void
  children: ReactNode
}) {
  return (
    <section aria-label={label(view)} className="flex min-h-0 min-w-0 flex-1 flex-col animate-fade-in">
      <div className="flex h-(--topbar-h) shrink-0 items-center gap-2 border-b border-border-subtle pr-2 pl-3">
        <Select value={view} onValueChange={(next) => isPanelView(next) && onSwitch(next)}>
          <SelectTrigger aria-label="Panel view" className={cx(SELECT_GHOST, 'text-sm text-text')}>
            <span className="shrink-0 text-icon">{PANEL_VIEW_ICON[view]}</span>
            <SelectValue>{label(view)}</SelectValue>
          </SelectTrigger>
          <SelectContent align="start" aria-label="Panel view">
            {views.map((v) => (
              <SelectItem key={v} value={v}>
                {label(v)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {view === 'design' && path && (
          <span className="min-w-0 truncate font-mono text-xs text-text-tertiary">{path}</span>
        )}
        <span className="flex-1" />
        <IconButton label="Fold the panel" size="sm" icon={<IconChevronRight />} onClick={onCollapse} />
        <IconButton label="Close the panel" size="sm" icon={<IconX />} onClick={onClose} />
      </div>
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">{children}</div>
    </section>
  )
}

/** The folded panel's strip: unfold, or close. */
export function PanelStrip({ label, onExpand, onClose }: { label: string; onExpand: () => void; onClose: () => void }) {
  return (
    <>
      <IconButton label={`Unfold ${label.toLowerCase()}`} size="sm" icon={<IconArrowLeft />} onClick={onExpand} />
      <IconButton label="Close the panel" size="sm" icon={<IconX />} onClick={onClose} />
    </>
  )
}

/**
 * The topbar's door to each view this state offers (decision 5): a click opens
 * that view, or closes it when it is the one open. The details are not among
 * them: they keep the aside toggle's old glyph and place, after the "…".
 */
export function PanelButtons({
  views,
  open,
  label,
  onToggle,
}: {
  views: readonly PanelView[]
  open: PanelView | null
  label: (view: PanelView) => string
  onToggle: (view: PanelView) => void
}) {
  return (
    <>
      {views
        .filter((v) => v !== 'details')
        .map((v) => (
          <Button
            key={v}
            size="sm"
            variant={open === v ? 'secondary' : 'ghost'}
            icon={PANEL_VIEW_ICON[v]}
            aria-pressed={open === v}
            className="mr-1"
            onClick={() => onToggle(v)}
          >
            {label(v)}
          </Button>
        ))}
    </>
  )
}
