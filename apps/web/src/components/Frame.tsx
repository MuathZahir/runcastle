import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { IconPanelLeft } from '../icons'
import { clampSidebarWidth, useSidebarWidth } from '../lib/sidebar-width'
import { shortcut } from '../lib/platform'
import { cx, IconButton } from '../ui'
import { RailResizeHandle } from './RailResizeHandle'

/**
 * The frame every screen sits in (DESIGN.md §Frame): `canvas` | the sidebar |
 * the content panel (`surface`, hairline, `rounded-lg`, inset 8px). There is no
 * global title bar and no status bar — the sidebar's head and foot carry what
 * those used to.
 *
 * The sidebar's width and its collapsed state are screen preferences, kept for
 * the whole app rather than per project, so they live in a provider the root
 * mounts once ({@link FrameProvider}); the portfolio home and every project
 * shell render the same {@link Frame} and read the same two values.
 */

/** localStorage key for the collapsed sidebar. */
const COLLAPSED_KEY = 'runcastle.sidebar.collapsed'

/** The collapsed sidebar's width: a strip of canvas holding the way back. */
const RAIL_W = 44

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

export interface FrameApi {
  width: number
  setWidth: (px: number) => void
  collapsed: boolean
  toggleSidebar: () => void
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

/** Holds the sidebar's width + collapsed state, and answers Ctrl/⌘+B. */
export function FrameProvider({ notices, children }: { notices?: ReactNode; children: ReactNode }) {
  const { width, setWidth } = useSidebarWidth()
  const [collapsed, setCollapsed] = useState(readCollapsed)

  const toggleSidebar = useCallback(() => {
    setCollapsed((was) => {
      const next = !was
      try {
        localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0')
      } catch {
        // No storage: the toggle still works for this session.
      }
      return next
    })
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
    () => ({ width, setWidth, collapsed, toggleSidebar, notices: notices ?? null }),
    [width, setWidth, collapsed, toggleSidebar, notices],
  )
  return <FrameContext.Provider value={api}>{children}</FrameContext.Provider>
}

/**
 * The frame's state. Outside a provider (a component test mounting one screen)
 * it falls back to an expanded default-width sidebar that cannot collapse.
 */
export function useFrame(): FrameApi {
  return (
    useContext(FrameContext) ?? {
      width: clampSidebarWidth(Number.NaN),
      setWidth: () => undefined,
      collapsed: false,
      toggleSidebar: () => undefined,
      notices: null,
    }
  )
}

/** The sidebar's own collapse button, for its head row. */
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

/**
 * canvas | sidebar | content panel. `sidebar` is the full sidebar; while it is
 * collapsed a 44px strip of canvas holds the expand button (and `rail`, any
 * further one-icon doors the screen wants to keep in reach — search).
 *
 * Collapse animates the column's width (240ms, ease-out) while the sidebar
 * fades out and the strip fades in. A drag on the resize handle skips the
 * transition, so the edge follows the pointer instead of trailing it.
 */
export function Frame({
  sidebar,
  rail,
  children,
}: {
  sidebar?: ReactNode
  rail?: ReactNode
  children: ReactNode
}) {
  const { width, setWidth, collapsed, toggleSidebar, notices } = useFrame()
  const [resizing, setResizing] = useState(false)
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (settle.current) clearTimeout(settle.current)
  }, [])

  const onResize = (px: number) => {
    setResizing(true)
    if (settle.current) clearTimeout(settle.current)
    settle.current = setTimeout(() => setResizing(false), 160)
    setWidth(px)
  }

  const hasSidebar = sidebar !== undefined

  return (
    <div
      className="flex h-full min-h-0 bg-canvas text-text"
      style={{ '--sidebar-w': `${width}px` } as CSSProperties}
    >
      {hasSidebar && (
        <div
          data-sidebar={collapsed ? 'collapsed' : 'expanded'}
          className={cx(
            'relative h-full shrink-0 overflow-hidden',
            !resizing && 'transition-[width] duration-(--dur-3) ease-out-app motion-reduce:transition-none',
          )}
          style={{ width: collapsed ? RAIL_W : width }}
        >
          <div
            inert={collapsed}
            aria-hidden={collapsed || undefined}
            className={cx(
              'absolute inset-y-0 left-0 flex w-(--sidebar-w) flex-col',
              'transition-opacity duration-(--dur-2) ease-app',
              collapsed ? 'pointer-events-none opacity-0' : 'opacity-100',
            )}
          >
            {sidebar}
          </div>
          <div
            inert={!collapsed}
            aria-hidden={!collapsed || undefined}
            className={cx(
              'absolute inset-y-0 left-0 flex w-11 flex-col items-center gap-1 pt-4',
              'transition-[opacity,translate] duration-(--dur-3) ease-out-app',
              collapsed ? 'translate-x-0 opacity-100 delay-75' : 'pointer-events-none -translate-x-2 opacity-0',
            )}
          >
            <IconButton
              label="Show sidebar"
              kbd={shortcut('B')}
              icon={<IconPanelLeft />}
              tooltipSide="right"
              onClick={toggleSidebar}
            />
            {rail}
          </div>
          {!collapsed && (
            <RailResizeHandle
              width={width}
              side="left"
              label="Resize the sidebar"
              clamp={clampSidebarWidth}
              onResize={onResize}
            />
          )}
        </div>
      )}
      <main
        className={cx(
          'my-2 mr-2 flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-surface',
          !hasSidebar && 'ml-2',
        )}
      >
        {notices}
        <div className="flex min-h-0 min-w-0 flex-1">{children}</div>
      </main>
    </div>
  )
}
