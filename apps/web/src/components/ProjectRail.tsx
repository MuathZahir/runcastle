import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactNode, RefObject } from 'react'
import { IconPlus, LogoMark } from '../icons'
import type { FeatureListItem, Project } from '../lib/api'
import { mutationErrorMessage } from '../lib/mutation-errors'
import { altShortcut } from '../lib/platform'
import { moveInList, railShortcutIndex, railTiles, type RailTile } from '../lib/project-rail'
import { pushToast } from '../lib/toast'
import type { ProjectNavApi } from '../lib/use-project-nav'
import { trpc } from '../trpc'
import { cx, Tooltip } from '../ui'

/**
 * The project rail (docs/features/a-better-way-to-move-between-projects,
 * decisions 2–6; its look reworked by epics-that-look-alive decision 7): a
 * narrow column at the sidebar's left with a neutral tile per open project —
 * the card's fill and hairline, the project's letters. The project in front
 * wears the strong fill and a firmer edge, and a short bar on the window's edge
 * marks it, gliding from tile to tile on a switch. The only colour is amber,
 * a dot on the corner of a project that needs the human. Hovering a tile names
 * the project and its Alt+digit in the app's own tooltip. The runcastle mark
 * sits on top, level with the sidebar's head, as the brand only; the "All
 * projects" grid tile sits just below it, and "Open a project", a dotted tile,
 * follows the last project. On a phone the same tiles run across the top of
 * the list as a row, the marker under the tile.
 *
 * Tiles keep the order the human sets by dragging (press and drag; on a touch
 * screen, hold first), saved through `project.reorder`. Alt+1…9 enters the nth.
 *
 * The data is the shell's, through {@link ProjectRailProvider}: the open
 * projects in rail order and the feature lists the tab title already polls.
 */

export interface ProjectRailApi {
  tiles: RailTile[]
  /** The project in front; null on All projects. */
  currentId: string | null
  enter: (projectId: string) => void
  goHome: () => void
  /** The existing open-a-project flow. */
  open: () => void
  /** Save a new order: every open project id, once. */
  reorder: (projectIds: string[]) => void
}

/** Exported for component tests, which hand the rail a plain value. */
export const ProjectRailContext = createContext<ProjectRailApi | null>(null)

/** The rail's data and actions, or null outside the shell (a screen mounted alone). */
export function useProjectRail(): ProjectRailApi | null {
  return useContext(ProjectRailContext)
}

/** `before` in `ids`' order, positions renumbered: the optimistic answer to a reorder. */
function reordered(before: Project[], ids: string[]): Project[] {
  const byId = new Map(before.map((p) => [p.id, p]))
  return ids.flatMap((id, position) => {
    const p = byId.get(id)
    return p ? [{ ...p, position }] : []
  })
}

/**
 * The rail's data for the whole shell, and its one window-level shortcut:
 * Alt+1…9 (by physical key, so macOS Option works) enters the nth project,
 * wherever the focus is — a chat's terminal swallows the chord for it
 * (`mapTerminalKey`) rather than sending ESC+digit to the session.
 */
export function ProjectRailProvider({
  nav,
  lists,
  children,
}: {
  nav: ProjectNavApi
  /** `nav.projects`' feature lists, in the same order (the tab title's queries). */
  lists: readonly (FeatureListItem[] | undefined)[]
  children: ReactNode
}) {
  const projects = nav.projects
  const currentId = nav.currentProjectId
  const tiles = useMemo(() => railTiles(projects ?? [], lists, currentId), [projects, lists, currentId])

  const utils = trpc.useUtils()
  // What the list was before the drop in flight, to put back if the server refuses it.
  const rollback = useRef<Project[] | null>(null)
  const { mutate } = trpc.project.reorder.useMutation({
    onError: (error) => {
      if (rollback.current) utils.project.list.setData(undefined, rollback.current)
      pushToast(mutationErrorMessage(error))
    },
    onSettled: () => {
      rollback.current = null
      void utils.project.list.invalidate()
    },
  })
  // The new order is written to the cache in the same tick as the drop, so the
  // tiles never flash back to the old order while the request is out.
  const reorder = useCallback(
    (projectIds: string[]) => {
      const before = utils.project.list.getData()
      if (!before) return
      void utils.project.list.cancel()
      rollback.current = before
      utils.project.list.setData(undefined, reordered(before, projectIds))
      mutate({ projectIds })
    },
    [utils, mutate],
  )

  const { enterProject, goHome, showOpen } = nav
  const latest = useRef({ tiles, currentId, view: nav.view, enterProject })
  latest.current = { tiles, currentId, view: nav.view, enterProject }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const i = railShortcutIndex(e)
      if (i === null) return
      const { tiles, currentId, view, enterProject } = latest.current
      const tile = tiles[i]
      if (!tile) return
      // Taken either way, so Option+digit never types its composed character.
      e.preventDefault()
      if (e.repeat || (view === 'project' && tile.id === currentId)) return
      enterProject(tile.id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const api = useMemo<ProjectRailApi>(
    () => ({ tiles, currentId, enter: enterProject, goHome, open: showOpen, reorder }),
    [tiles, currentId, enterProject, goHome, showOpen, reorder],
  )
  return <ProjectRailContext.Provider value={api}>{children}</ProjectRailContext.Provider>
}

const ALL = '__all'

/** Glide: one marker, moved by transform; no transition on the first placing. */
const GLIDE = 'transition-transform duration-(--dur-3) ease-(--ease-out-app) motion-reduce:transition-none'

const SIZE = {
  /** On the rail: 36px. */
  md: 'size-9 rounded-lg text-sm',
  /** On the phone row: 40px. */
  lg: 'size-10 rounded-lg text-md',
} as const

/**
 * The app's focus outline (2px, the focus-ring colour), drawn on the tile inside
 * a `group/btn` button so it hugs the tile's radius; keyboard only. The
 * button's own outline is turned off by the rail's one exception to the global
 * focus rule (styles.css, `[data-rail] button`).
 */
const FOCUS_ON_TILE = 'group-focus-visible/btn:outline-2 group-focus-visible/btn:outline-offset-1 group-focus-visible/btn:outline-focus-ring'
/** The button that holds a tile; long-press on a phone must not select or call out. */
const TILE_BUTTON = 'group/btn cursor-pointer rounded-lg select-none [-webkit-touch-callout:none]'
const TILE_EASE = 'transition-[background-color,color,box-shadow,border-color] duration-(--dur-2) ease-app motion-reduce:transition-none'
/**
 * A tile at rest (epics-that-look-alive decision 7): the card's faint fill and
 * hairline, its letters in the muted grey. Neutral on every project — no
 * colour per project on the rail.
 */
const TILE_REST =
  'bg-fill-card text-text-tertiary shadow-[inset_0_0_0_1px_var(--color-border-subtle)] group-hover/btn:bg-fill-well group-hover/btn:text-text-secondary'
/** Carried in a drag: lifted, as if hovered. */
const TILE_LIT = 'bg-fill-well text-text-secondary shadow-[inset_0_0_0_1px_var(--color-border-subtle)]'
/** The project in front: the strong fill, a firmer edge with the raised top light, full-strength letters. */
const TILE_CURRENT =
  'bg-fill-well text-text shadow-[inset_0_0_0_1px_var(--color-border-strong),inset_0_1px_0_color-mix(in_oklab,var(--color-text)_10%,transparent)]'

/**
 * A project's tile: its letters on the neutral tile. The amber dot sits on the
 * tile's corner, cut out of the rail's ground; the current project carries none.
 */
function RailTileFace({ tile, size, current, lit }: { tile: RailTile; size: keyof typeof SIZE; current: boolean; lit: boolean }) {
  return (
    <span
      className={cx(
        'relative inline-flex shrink-0 items-center justify-center font-medium tracking-tight select-none',
        TILE_EASE,
        SIZE[size],
        FOCUS_ON_TILE,
        current ? TILE_CURRENT : lit ? TILE_LIT : TILE_REST,
      )}
    >
      {tile.initials}
      {!current && tile.needsYou && (
        <span role="img" aria-label="Needs you" className="absolute -top-0.5 -right-0.5 size-2.5 animate-fade-in rounded-full bg-warning ring-2 ring-canvas" />
      )}
    </span>
  )
}

/** "All projects": the grid glyph on a neutral tile; the current tile while on All projects. */
function AllProjectsFace({ size, current }: { size: keyof typeof SIZE; current: boolean }) {
  return (
    <span className={cx('inline-flex shrink-0 items-center justify-center', TILE_EASE, SIZE[size], FOCUS_ON_TILE, current ? TILE_CURRENT : TILE_REST)}>
      <IconGrid size={size === 'lg' ? 18 : 16} />
    </span>
  )
}

/** "Open a project": a dotted tile, the same dotted edge as the epic list's "New epic". */
function RailOpenFace({ size }: { size: keyof typeof SIZE }) {
  return (
    <span
      className={cx(
        'inline-flex shrink-0 items-center justify-center border border-dashed border-border-strong text-text-tertiary',
        'group-hover/btn:border-[color-mix(in_oklab,var(--color-text-tertiary)_60%,transparent)] group-hover/btn:bg-surface-hover group-hover/btn:text-text-secondary',
        TILE_EASE,
        SIZE[size],
        FOCUS_ON_TILE,
      )}
    >
      <IconPlus size={size === 'lg' ? 18 : 16} />
    </span>
  )
}

/**
 * The runcastle mark, top of the rail: the brand, not a button (epics-that-look-alive
 * decision 7). On the rail it takes a tile's square; on the phone's row only its own
 * width, so the row keeps its room for projects.
 */
function RailLogo({ size }: { size: keyof typeof SIZE }) {
  return (
    <span aria-hidden className={cx('inline-flex shrink-0 items-center justify-center text-text-secondary', size === 'lg' ? 'h-10 w-6' : SIZE[size])}>
      <LogoMark size={size === 'lg' ? 24 : 22} />
    </span>
  )
}

/** A 16px grid of four squares: "every project". */
export function IconGrid({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden>
      <rect x="2.25" y="2.25" width="4.5" height="4.5" rx="1.25" />
      <rect x="9.25" y="2.25" width="4.5" height="4.5" rx="1.25" />
      <rect x="2.25" y="9.25" width="4.5" height="4.5" rx="1.25" />
      <rect x="9.25" y="9.25" width="4.5" height="4.5" rx="1.25" />
    </svg>
  )
}

/** The open project's marker on the rail: a short bar on the window's edge, level with its tile. */
const RAIL_MARKER = 'pointer-events-none absolute top-0 left-0 h-5 w-[3px] rounded-r-full bg-text'

/**
 * Where the selection surface sits: under the `[data-slot]` whose key is
 * `current`, measured in the container's own coordinates (so it scrolls with
 * the tiles). `animate` stays off until the first placing has painted.
 */
function useSurface(container: RefObject<HTMLElement | null>, current: string, axis: 'x' | 'y', order: string) {
  const [at, setAt] = useState<{ pos: number; animate: boolean } | null>(null)
  useLayoutEffect(() => {
    const el = container.current?.querySelector<HTMLElement>(`[data-slot="${current}"]`)
    if (!el) {
      setAt(null)
      return
    }
    const pos = axis === 'y' ? el.offsetTop + el.offsetHeight / 2 : el.offsetLeft + el.offsetWidth / 2
    setAt((prev) => (prev && prev.pos === pos ? prev : { pos, animate: prev !== null }))
  }, [container, current, axis, order])
  return at
}

/** A pointer travels this far before a press becomes a drag (mouse, pen). */
const DRAG_SLOP = 4
/** A touch held this long, still, picks the tile up. */
const LONG_PRESS_MS = 400
/** A touch that moves this far before the hold completes is a scroll. */
const TOUCH_SLOP = 8

/**
 * Drag to reorder, with pointer events. A mouse or pen press becomes a drag
 * once it travels a few pixels; a touch has to be held still first, so a swipe
 * still scrolls the row. While dragging, the tiles take their new order live
 * (`drag.order`); the drop hands that order to `onDrop` when it changed, and
 * Escape puts everything back. A press that never became a drag is a click.
 */
function useRailDrag(container: RefObject<HTMLElement | null>, axis: 'x' | 'y', ids: string[], onDrop: (ids: string[]) => void) {
  const [drag, setDrag] = useState<{ id: string; order: string[] } | null>(null)
  const latest = useRef({ ids, onDrop })
  latest.current = { ids, onDrop }
  const stop = useRef<(() => void) | null>(null)
  const swallowClick = useRef(false)
  useEffect(() => () => stop.current?.(), [])

  const onPointerDown = useCallback(
    (id: string) => (e: ReactPointerEvent) => {
      if (e.button !== 0 || stop.current || e.ctrlKey || e.metaKey) return
      const touch = e.pointerType === 'touch'
      const base = [...latest.current.ids]
      const start = { x: e.clientX, y: e.clientY }
      let active = false
      let order = base
      let centers: number[] = []
      let timer: ReturnType<typeof setTimeout> | null = null
      const previousUserSelect = document.body.style.userSelect

      const activate = () => {
        active = true
        if (timer) clearTimeout(timer)
        const tiles = container.current?.querySelectorAll<HTMLElement>('[data-rail-tile]') ?? []
        centers = [...tiles].map((el) => {
          const r = el.getBoundingClientRect()
          return axis === 'y' ? r.top + r.height / 2 : r.left + r.width / 2
        })
        document.body.style.userSelect = 'none'
        setDrag({ id, order })
      }
      const onMove = (ev: PointerEvent) => {
        if (ev.pointerId !== e.pointerId) return
        if (!active) {
          const dist = Math.hypot(ev.clientX - start.x, ev.clientY - start.y)
          if (touch) {
            if (dist > TOUCH_SLOP) finish(false)
            return
          }
          if (dist < DRAG_SLOP) return
          activate()
        }
        const at = axis === 'y' ? ev.clientY : ev.clientX
        let to = 0
        centers.forEach((c, i) => {
          if (Math.abs(c - at) < Math.abs(centers[to]! - at)) to = i
        })
        const next = moveInList(base, id, to)
        if (next.join() !== order.join()) {
          order = next
          setDrag({ id, order })
        }
      }
      const onUp = (ev: PointerEvent) => ev.pointerId === e.pointerId && finish(true)
      const onCancel = (ev: PointerEvent) => ev.pointerId === e.pointerId && finish(false)
      const onKey = (ev: KeyboardEvent) => {
        if (ev.key !== 'Escape' || !active) return
        ev.preventDefault()
        finish(false)
      }
      // Once a held touch has picked the tile up, the finger drags it rather than the page.
      const noScroll = (ev: TouchEvent) => active && ev.preventDefault()
      // A long press is also the system's cue for a context menu.
      const noMenu = (ev: Event) => touch && ev.preventDefault()

      function finish(commit: boolean) {
        stop.current = null
        if (timer) clearTimeout(timer)
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onCancel)
        window.removeEventListener('keydown', onKey, true)
        window.removeEventListener('contextmenu', noMenu, true)
        document.removeEventListener('touchmove', noScroll)
        if (!active) return
        document.body.style.userSelect = previousUserSelect
        // The click that follows the drop is not a switch.
        swallowClick.current = true
        setTimeout(() => {
          swallowClick.current = false
        }, 0)
        setDrag(null)
        if (commit && order.join() !== base.join()) latest.current.onDrop(order)
      }

      if (touch) timer = setTimeout(activate, LONG_PRESS_MS)
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onCancel)
      window.addEventListener('keydown', onKey, true)
      window.addEventListener('contextmenu', noMenu, true)
      document.addEventListener('touchmove', noScroll, { passive: false })
      stop.current = () => finish(false)
    },
    [axis, container],
  )

  const onClickCapture = useCallback((e: ReactMouseEvent) => {
    if (!swallowClick.current) return
    e.preventDefault()
    e.stopPropagation()
  }, [])

  return { drag, onPointerDown, onClickCapture }
}

/** The tiles in the order to draw them: the drag's live order while one is under way. */
function useShownTiles(rail: ProjectRailApi | null, container: RefObject<HTMLElement | null>, axis: 'x' | 'y') {
  const tiles = rail?.tiles ?? []
  const ids = tiles.map((t) => t.id)
  const reorder = rail?.reorder
  // The dropped order, held until the list it was written into renders (the
  // query cache tells its readers a tick later), so the old order never flashes.
  const [held, setHeld] = useState<string[] | null>(null)
  const onDrop = useCallback(
    (order: string[]) => {
      setHeld(order)
      reorder?.(order)
    },
    [reorder],
  )
  const order = ids.join()
  useEffect(() => setHeld(null), [order])
  useEffect(() => {
    if (!held) return
    const t = setTimeout(() => setHeld(null), 1500)
    return () => clearTimeout(t)
  }, [held])
  const { drag, onPointerDown, onClickCapture } = useRailDrag(container, axis, ids, onDrop)
  const byId = new Map(tiles.map((t) => [t.id, t]))
  const pinned = drag?.order ?? held
  const shown = pinned ? pinned.flatMap((id) => byId.get(id) ?? []) : tiles
  return { shown, dragging: drag?.id ?? null, onPointerDown, onClickCapture }
}

function Slot({ id, className, children }: { id: string; className?: string; children: ReactNode }) {
  return (
    <div data-slot={id} className={cx('group/tile relative flex shrink-0 justify-center', className)}>
      {children}
    </div>
  )
}

/** The desktop rail, left of the sidebar. Renders nothing outside the shell's {@link ProjectRailProvider}. */
export function DesktopRail() {
  const rail = useProjectRail()
  const nav = useRef<HTMLElement>(null)
  const { shown, dragging, onPointerDown, onClickCapture } = useShownTiles(rail, nav, 'y')
  const current = rail?.currentId ?? ALL
  const surface = useSurface(nav, current, 'y', shown.map((t) => t.id).join())
  if (!rail) return null
  const onHome = rail.currentId === null
  return (
    <nav
      ref={nav}
      aria-label="Switch project"
      data-rail
      onClickCapture={onClickCapture}
      className={cx(
        'relative flex h-full w-[52px] shrink-0 flex-col overflow-y-auto py-2 [scrollbar-width:none]',
        dragging && 'cursor-grabbing',
      )}
    >
      {/* The open project's marker: one bar on the window's edge, gliding from tile to tile. */}
      {surface && (
        <span aria-hidden style={{ transform: `translateY(${surface.pos - 10}px)` }} className={cx(RAIL_MARKER, surface.animate && GLIDE)} />
      )}
      {/* The runcastle mark, level with the sidebar's 40px head; All projects sits just below it. */}
      <div className="flex h-10 shrink-0 items-center justify-center">
        <RailLogo size="md" />
      </div>
      <Slot id={ALL} className="mt-1.5">
        <Tooltip label="All projects" side="right">
          <button type="button" aria-label="All projects" aria-current={onHome || undefined} onClick={rail.goHome} className={TILE_BUTTON}>
            <AllProjectsFace size="md" current={onHome} />
          </button>
        </Tooltip>
      </Slot>
      <span aria-hidden className="mx-auto mt-2 h-px w-5 shrink-0 bg-border" />
      <div className="mt-2.5 flex flex-col gap-2 pb-1">
        {shown.map((t) => (
          <Slot key={t.id} id={t.id}>
            <Tooltip label={t.name} kbd={t.shortcut ? altShortcut(String(t.shortcut)) : undefined} side="right">
              <button
                type="button"
                data-rail-tile={t.id}
                aria-label={t.name}
                aria-current={t.id === rail.currentId || undefined}
                onPointerDown={onPointerDown(t.id)}
                onClick={() => t.id !== rail.currentId && rail.enter(t.id)}
                className={cx(TILE_BUTTON, dragging && 'cursor-grabbing')}
              >
                <RailTileFace tile={t} size="md" current={t.id === rail.currentId} lit={dragging === t.id} />
              </button>
            </Tooltip>
          </Slot>
        ))}
        <Slot id="__open">
          <Tooltip label="Open a project" side="right">
            <button type="button" aria-label="Open a project" onClick={rail.open} className={TILE_BUTTON}>
              <RailOpenFace size="md" />
            </button>
          </Tooltip>
        </Slot>
      </div>
    </nav>
  )
}

/**
 * The phone's row, across the top of the list screen: the same quiet tiles in
 * one scrolling row; the selection surface glides along it. A tile is held,
 * then dragged, to move it. Renders nothing outside the shell's provider.
 */
export function PhoneRail() {
  const rail = useProjectRail()
  const strip = useRef<HTMLElement>(null)
  const { shown, dragging, onPointerDown, onClickCapture } = useShownTiles(rail, strip, 'x')
  const current = rail?.currentId ?? ALL
  const surface = useSurface(strip, current, 'x', shown.map((t) => t.id).join())
  if (!rail) return null
  const onHome = rail.currentId === null
  return (
    <nav
      ref={strip}
      aria-label="Switch project"
      data-rail
      onClickCapture={onClickCapture}
      className="relative -mx-2 flex shrink-0 items-center gap-2 overflow-x-auto px-3 pt-1.5 pb-3 [scrollbar-width:none]"
    >
      {/* The open project's marker: a short bar under its tile, gliding along the row. */}
      {surface && (
        <span
          aria-hidden
          style={{ transform: `translateX(${surface.pos - 8}px)` }}
          className={cx('pointer-events-none absolute bottom-1 left-0 h-[3px] w-4 rounded-full bg-text', surface.animate && GLIDE)}
        />
      )}
      <RailLogo size="lg" />
      <span data-slot={ALL} className="relative inline-flex shrink-0">
        <button type="button" aria-label="All projects" aria-current={onHome || undefined} onClick={rail.goHome} className={TILE_BUTTON}>
          <AllProjectsFace size="lg" current={onHome} />
        </button>
      </span>
      <span aria-hidden className="h-5 w-px shrink-0 bg-border" />
      {shown.map((t) => (
        <span key={t.id} data-slot={t.id} className="relative inline-flex shrink-0">
          <button
            type="button"
            data-rail-tile={t.id}
            aria-label={t.name}
            aria-current={t.id === rail.currentId || undefined}
            onPointerDown={onPointerDown(t.id)}
            onClick={() => t.id !== rail.currentId && rail.enter(t.id)}
            className={TILE_BUTTON}
          >
            <RailTileFace tile={t} size="lg" current={t.id === rail.currentId} lit={dragging === t.id} />
          </button>
        </span>
      ))}
      <button type="button" aria-label="Open a project" onClick={rail.open} className={cx(TILE_BUTTON, 'shrink-0')}>
        <RailOpenFace size="lg" />
      </button>
    </nav>
  )
}
