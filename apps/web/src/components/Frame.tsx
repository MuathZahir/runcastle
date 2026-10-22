import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { IconPanelLeft } from '../icons'
import { clampSidebarWidth, SIDEBAR_MAX_W, SIDEBAR_MIN_W, useSidebarWidth } from '../lib/sidebar-width'
import { shortcut } from '../lib/platform'
import { cx, IconButton, SidebarDoorContext } from '../ui'
import { RailResizeHandle } from './RailResizeHandle'

/**
 * The frame every screen sits in (DESIGN.md §Frame): `canvas` | the sidebar |
 * the content panel (`surface`, hairline, `rounded-lg`, inset 8px). There is no
 * global title bar and no status bar — the sidebar's head and foot carry what
 * those used to.
 *
 * The sidebar's width and whether it is closed are screen preferences, kept for
 * the whole app rather than per project, so they live in a provider the root
 * mounts once ({@link FrameProvider}); the portfolio home and every project
 * shell render the same {@link Frame} and read the same two values.
 */

/**
 * localStorage key for the closed sidebar. The name is the old collapsed
 * state's: a browser that left the sidebar collapsed (to the icon rail, since
 * retired — design-mode decision 12) opens with it closed.
 */
const CLOSED_KEY = 'runcastle.sidebar.collapsed'

/** A drag that takes the sidebar under half its minimum closes it rather than stopping at the minimum. */
const CLOSE_BELOW_W = SIDEBAR_MIN_W / 2

function readClosed(): boolean {
  try {
    return localStorage.getItem(CLOSED_KEY) === '1'
  } catch {
    return false
  }
}

function writeClosed(closed: boolean): void {
  try {
    localStorage.setItem(CLOSED_KEY, closed ? '1' : '0')
  } catch {
    // No storage: the toggle still works for this session.
  }
}

export interface FrameApi {
  width: number
  setWidth: (px: number) => void
  /** The sidebar is closed: no rail, no width — the page header holds the way back. */
  closed: boolean
  toggleSidebar: () => void
  closeSidebar: () => void
  /** App-wide notices (update, setup check), drawn at the top of the panel. */
  notices: ReactNode
}

const FrameContext = createContext<FrameApi | null>(null)

/**
 * A focused terminal owns its keys: Ctrl+B is readline's "back one character"
 * (and tmux's prefix), so the sidebar chord never fires from inside xterm.
 */
function insideTerminal(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('.xterm') !== null
}

/** Holds the sidebar's width + closed state, and answers Ctrl/⌘+B. */
export function FrameProvider({ notices, children }: { notices?: ReactNode; children: ReactNode }) {
  const { width, setWidth } = useSidebarWidth()
  const [closed, setClosed] = useState(readClosed)

  const toggleSidebar = useCallback(() => {
    setClosed((was) => {
      writeClosed(!was)
      return !was
    })
  }, [])
  const closeSidebar = useCallback(() => {
    writeClosed(true)
    setClosed(true)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.shiftKey) return
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'b') return
      if (insideTerminal(e.target)) return
      e.preventDefault()
      toggleSidebar()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggleSidebar])

  const api = useMemo<FrameApi>(
    () => ({ width, setWidth, closed, toggleSidebar, closeSidebar, notices: notices ?? null }),
    [width, setWidth, closed, toggleSidebar, closeSidebar, notices],
  )
  return <FrameContext.Provider value={api}>{children}</FrameContext.Provider>
}

/**
 * The frame's state. Outside a provider (a component test mounting one screen)
 * it falls back to an open default-width sidebar that cannot close.
 */
export function useFrame(): FrameApi {
  return (
    useContext(FrameContext) ?? {
      width: clampSidebarWidth(Number.NaN),
      setWidth: () => undefined,
      closed: false,
      toggleSidebar: () => undefined,
      closeSidebar: () => undefined,
      notices: null,
    }
  )
}

/** The sidebar's own close button, for its head row. */
export function CollapseSidebarButton() {
  const { toggleSidebar } = useFrame()
  return (
    <IconButton
      label="Hide sidebar"
      kbd={shortcut('B')}
      size="sm"
      icon={<IconPanelLeft />}
      tooltipSide="bottom"
      onClick={toggleSidebar}
    />
  )
}

/** The way back while the sidebar is closed: the page header's first control. */
function ShowSidebarButton({ onClick }: { onClick: () => void }) {
  return (
    <IconButton
      label="Show sidebar"
      kbd={shortcut('B')}
      size="sm"
      icon={<IconPanelLeft />}
      tooltipSide="bottom"
      onClick={onClick}
    />
  )
}

/** Clamps the top only: under the minimum, the drag is measured so it can close. */
const clampDrag = (px: number) => Math.min(px, SIDEBAR_MAX_W)

/**
 * canvas | sidebar | content panel. The sidebar has one other state: closed
 * (design-mode decision 12) — zero width, nothing left of the content panel,
 * and the page header's {@link ShowSidebarButton} (through
 * {@link SidebarDoorContext}) the way back, beside Ctrl/⌘+B.
 *
 * Closing animates the column's width (240ms, ease-out) while the sidebar
 * fades out. A drag on the resize handle skips the transition, so the edge
 * follows the pointer instead of trailing it; a drag under half the minimum
 * width closes it.
 */
export function Frame({ sidebar, children }: { sidebar?: ReactNode; children: ReactNode }) {
  const { width, setWidth, closed, toggleSidebar, closeSidebar, notices } = useFrame()
  const [resizing, setResizing] = useState(false)
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (settle.current) clearTimeout(settle.current)
  }, [])

  const onResize = (px: number) => {
    if (px < CLOSE_BELOW_W) {
      setResizing(false)
      closeSidebar()
      return
    }
    setResizing(true)
    if (settle.current) clearTimeout(settle.current)
    settle.current = setTimeout(() => setResizing(false), 160)
    setWidth(px)
  }

  const hasSidebar = sidebar !== undefined
  const door = hasSidebar && closed ? <ShowSidebarButton onClick={toggleSidebar} /> : null

  return (
    <div
      className="flex h-full min-h-0 bg-canvas text-text"
      style={{ '--sidebar-w': `${width}px` } as CSSProperties}
    >
      {hasSidebar && (
        <div
          data-sidebar={closed ? 'closed' : 'open'}
          className={cx(
            'relative h-full shrink-0 overflow-hidden',
            !resizing && 'transition-[width] duration-(--dur-3) ease-out-app motion-reduce:transition-none',
          )}
          style={{ width: closed ? 0 : width }}
        >
          <div
            inert={closed}
            aria-hidden={closed || undefined}
            className={cx(
              'absolute inset-y-0 left-0 flex w-(--sidebar-w) flex-col',
              'transition-opacity duration-(--dur-2) ease-app',
              closed ? 'pointer-events-none opacity-0' : 'opacity-100',
            )}
          >
            {sidebar}
          </div>
          {!closed && (
            <RailResizeHandle width={width} side="left" label="Resize the sidebar" clamp={clampDrag} onResize={onResize} />
          )}
        </div>
      )}
      <main
        className={cx(
          'my-2 mr-2 flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-surface',
          (!hasSidebar || closed) && 'ml-2',
        )}
      >
        {notices}
        <SidebarDoorContext.Provider value={door}>
          <div className="flex min-h-0 min-w-0 flex-1">{children}</div>
        </SidebarDoorContext.Provider>
      </main>
    </div>
  )
}
