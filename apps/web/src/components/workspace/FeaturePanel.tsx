import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import {
  INITIAL_PANEL,
  panelReducer,
  type PanelAction,
  type PanelState,
  type PanelView,
} from '../../lib/feature-ui/panel'
import { useRailWidth, type RailWidthSpec } from '../../lib/rail-width'
import type { FeatureView } from '../../lib/routes'
import { IconButton, Tabs, cx } from '../../ui'
import {
  IconArrowLeft,
  IconChevronRight,
  IconDoc,
  IconInfo,
  IconList,
  IconPanelRight,
  IconPen,
  IconPlay,
  IconX,
} from '../../icons'

/**
 * The feature page's one panel (design-mode decisions 4, 5): the split it
 * shares with the chat, the divider between them, and the panel's own header.
 * What the views say is `panel.ts`; which view is open is the shell's, so the
 * address bar names it.
 */

/** Every view leads with an icon (DESIGN.md principle 7). */
export const PANEL_VIEW_ICON: Record<PanelView, ReactNode> = {
  plan: <IconDoc />,
  work: <IconList />,
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

/** The open doc, with the view it was opened in. */
interface Reading {
  doc: string
  view: PanelView
}

export interface PanelApi {
  state: PanelState
  dispatch: (action: PanelAction) => void
}

/**
 * The panel's state: the open view is `view` (the shell's), everything else
 * — the size, the fold, the design path, who opened it and the doc being
 * read — is held here, the
 * size remembered per browser. A dispatch that changes the view hands it back
 * through `onViewChange`, `chat` for the panel closed.
 */
export function usePanel(view: PanelView | null, onViewChange: (view: FeatureView) => void): PanelApi {
  const { width, setWidth } = useRailWidth(PANEL_SHARE)
  const [rest, setRest] = useState<Pick<PanelState, 'path' | 'origin' | 'collapsed' | 'last'> & { reading?: Reading }>({
    collapsed: INITIAL_PANEL.collapsed,
  })
  const { reading, ...held } = rest
  // A doc is read in the view it was opened from; once the shell shows
  // another (the address bar, history), the doc stays behind.
  const state: PanelState = {
    ...held,
    view,
    share: width / PANEL_SHARE.max,
    ...(reading && reading.view === view ? { doc: reading.doc } : {}),
  }
  // …for good: coming back to that view shows the view, not the doc.
  useEffect(() => {
    if (reading && reading.view !== view) setRest(({ reading: _left, ...kept }) => kept)
  }, [reading, view])

  // Read through a ref so `dispatch` is stable: the stream handler and the
  // mutation callbacks that call it outlive the render they were made in.
  const current = useRef({ state, onViewChange })
  current.current = { state, onViewChange }

  const dispatch = useCallback(
    (action: PanelAction) => {
      const before = current.current.state
      const { view: nextView, share, path, origin, collapsed, last, doc } = panelReducer(before, action)
      setRest({
        collapsed,
        ...(path !== undefined ? { path } : {}),
        ...(origin ? { origin } : {}),
        ...(last ? { last } : {}),
        ...(doc && nextView ? { reading: { doc, view: nextView } } : {}),
      })
      if (share !== before.share) setWidth(share * PANEL_SHARE.max)
      if (nextView !== before.view) current.current.onViewChange(nextView ?? 'chat')
    },
    [setWidth],
  )
  return { state, dispatch }
}

/**
 * Below ~1100px of content width the panel floats over the chat instead of
 * beside it: docked right, full height, above the chat. Every class is a whole
 * literal — Tailwind only generates what it can read in source, so a variant
 * built at runtime (`${prefix}:inset-y-0`) never reaches the CSS.
 */
const PANEL_OVERLAY =
  '@max-[1100px]:absolute @max-[1100px]:inset-y-0 @max-[1100px]:right-0 @max-[1100px]:z-20 @max-[1100px]:shadow-dialog'

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
              PANEL_OVERLAY,
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
    <section aria-label={label(view)} className="@container/panel flex min-h-0 min-w-0 flex-1 flex-col animate-fade-in">
      <div className="flex h-(--topbar-h) shrink-0 items-center gap-2 border-b border-border-subtle pr-2 pl-3">
        {/* The views as tabs (decision 3). A narrow panel keeps the open tab's
            word and only the icons of the others, each named by its tooltip. */}
        <Tabs
          items={views.map((v) => ({
            id: v,
            label: <span className={cx(v !== view && '@max-[520px]/panel:sr-only')}>{label(v)}</span>,
            icon: PANEL_VIEW_ICON[v],
            ...(v !== view ? { tooltip: label(v) } : {}),
          }))}
          value={view}
          onChange={onSwitch}
          label="Panel views"
          className="-ml-1 min-w-0"
        />
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
 * The header's one door to the panel (decision 12), last in the row: it opens
 * the panel at its last view, or closes it. Which view is on show is the
 * panel header's own switcher — the page has no button per view.
 */
export function PanelToggle({
  open,
  views,
  badge,
  onToggle,
}: {
  open: boolean
  /** The views on offer; with none, there is no panel to open. */
  views: readonly PanelView[]
  /** A count waiting inside (the project's open notes). */
  badge?: number
  onToggle: () => void
}) {
  if (views.length === 0) return null
  return (
    <IconButton
      label={open ? 'Hide the panel' : 'Show the panel'}
      icon={<IconPanelRight />}
      active={open}
      {...(badge ? { badge } : {})}
      onClick={onToggle}
    />
  )
}
