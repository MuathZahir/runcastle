import { useLayoutEffect, useRef, useState } from 'react'
import type { ReactElement, ReactNode, RefObject } from 'react'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import { cx, Tooltip } from '../../src/ui'
import { IconPlus } from '../../src/icons'
import type { MockProject } from './data'
import { IconGrid, RailTile, TILE_BUTTON, TILE_REST } from './tile'

/**
 * The project rail (decisions 2 and 3): a narrow column at the sidebar's left, on the
 * sidebar's own ground, with a quiet tile per project. Tiles at rest recede
 * (dim, nudged toward the window edge); the current one is the only thing
 * that stands out: full-strength letters on the one selection surface, which
 * glides from tile to tile on a switch. The only mark is amber, for a project
 * that needs the human. Hovering a tile names the project in the app's own
 * tooltip, to the tile's right, and nothing more.
 * "All projects" sits on top, level with the sidebar's head; "Open a project"
 * follows the last tile. On a phone the same tiles run across the top of the
 * list as a strip, the surface gliding sideways.
 */

const ALL = '__all'

/** Glide: one surface, moved by transform; no transition on the first placing. */
const GLIDE = 'transition-transform duration-(--dur-3) ease-(--ease-out-app) motion-reduce:transition-none'

/**
 * Where the selection surface sits: under the `[data-slot]` whose key is
 * `current`, measured in the container's own coordinates (so it scrolls with
 * the tiles). `animate` stays off until the first placing has painted.
 */
function useSurface(container: RefObject<HTMLElement | null>, current: string, axis: 'x' | 'y', deps: unknown[]) {
  const [at, setAt] = useState<{ pos: number; animate: boolean } | null>(null)
  useLayoutEffect(() => {
    const el = container.current?.querySelector<HTMLElement>(`[data-slot="${current}"]`)
    if (!el) return
    const pos = axis === 'y' ? el.offsetTop + el.offsetHeight / 2 : el.offsetLeft + el.offsetWidth / 2
    setAt((prev) => ({ pos, animate: prev !== null }))
  }, [current, axis, ...deps])
  return at
}

export function Rail({
  projects,
  currentId,
  onPick,
  hoverFirst,
}: {
  projects: MockProject[]
  /** The project in front; null on All projects. */
  currentId: string | null
  onPick: (id: string | null) => void
  /** A project shown hovered from the start, its name tooltip open (the "mid-switch" state). */
  hoverFirst?: string
}) {
  const nav = useRef<HTMLElement>(null)
  const current = currentId ?? ALL
  const surface = useSurface(nav, current, 'y', [projects.map((p) => p.id).join()])
  const [held, setHeld] = useState(hoverFirst)
  const onHome = currentId === null
  return (
    <nav ref={nav} aria-label="Projects" className="relative flex h-full w-[52px] shrink-0 flex-col overflow-y-auto py-2 [scrollbar-width:none]">
      {/* The one selection surface: 36px, nudged 3px right of centre like the current tile. */}
      {surface && (
        <span
          aria-hidden
          style={{ transform: `translateY(${surface.pos - 18}px)` }}
          className={cx('card pointer-events-none absolute top-0 left-1/2 -ml-[15px] size-9 rounded-lg', surface.animate && GLIDE)}
        />
      )}
      {/* Level with the sidebar's 40px head. */}
      <Slot id={ALL} className="h-10 items-center">
        <Tooltip label="All projects" side="right">
          <button
            type="button"
            aria-label="All projects"
            aria-current={onHome || undefined}
            onClick={() => onPick(null)}
            className={cx(
              'inline-flex size-9 cursor-pointer items-center justify-center rounded-lg focus-visible:outline-offset-1!',
              'transition-[translate,color] duration-(--dur-3) ease-(--ease-out-app) motion-reduce:transition-none',
              onHome ? 'translate-x-[3px] text-text' : cx(TILE_REST, '-translate-x-1 hover:-translate-x-0.5 hover:text-text-tertiary'),
            )}
          >
            <IconGrid />
          </button>
        </Tooltip>
      </Slot>
      <div className="mt-3 flex flex-col gap-2 pb-1">
        {projects.map((p) => (
          <Slot key={p.id} id={p.id}>
            <NameTip label={p.name} shown={held === p.id} onHide={() => setHeld(undefined)}>
              <button
                type="button"
                data-rail-tile={p.id}
                aria-label={p.name}
                aria-current={p.id === currentId || undefined}
                onClick={() => onPick(p.id)}
                className={TILE_BUTTON}
              >
                <RailTile project={p} size="md" current={p.id === currentId} lit={held === p.id} />
              </button>
            </NameTip>
          </Slot>
        ))}
        <Slot id="__open">
          <Tooltip label="Open a project" side="right">
            <button
              type="button"
              aria-label="Open a project"
              className={cx(
                'inline-flex size-9 -translate-x-1 cursor-pointer items-center justify-center rounded-lg transition-[translate,color] duration-(--dur-2) ease-(--ease-out-app) hover:-translate-x-0.5 focus-visible:outline-offset-1!',
                TILE_REST,
                'hover:text-text-tertiary',
              )}
            >
              <IconPlus size={16} />
            </button>
          </Tooltip>
        </Slot>
      </div>
    </nav>
  )
}

/**
 * A tile's name: the app's `Tooltip`, to the right. In the "mid-switch" state
 * one tile starts hovered, so its tip starts open; that needs Radix's
 * `defaultOpen`, which the app's wrapper doesn't pass, so this mirrors the
 * wrapper's Content exactly. It closes like any tip once the pointer moves.
 */
function NameTip({ label, shown, onHide, children }: { label: string; shown: boolean; onHide: () => void; children: ReactElement }) {
  if (!shown) return <Tooltip label={label} side="right">{children}</Tooltip>
  return (
    <TooltipPrimitive.Root defaultOpen onOpenChange={(open) => !open && onHide()}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side="right"
          sideOffset={6}
          collisionPadding={8}
          className="z-[400] flex max-w-72 items-center gap-2 rounded-md bg-surface-raised px-2 py-1 text-xs text-text shadow-popover select-none animate-pop-in"
        >
          {label}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  )
}

function Slot({ id, className, children }: { id: string; className?: string; children: ReactNode }) {
  return (
    <div data-slot={id} className={cx('group/tile relative flex shrink-0 justify-center', className)}>
      {children}
    </div>
  )
}

/** The phone's strip: the same quiet tiles in one scrolling row; the selection surface glides along it. */
export function PhoneStrip({
  projects,
  currentId,
  onPick,
}: {
  projects: MockProject[]
  currentId: string | null
  onPick: (id: string | null) => void
}) {
  const strip = useRef<HTMLElement>(null)
  const current = currentId ?? ALL
  const surface = useSurface(strip, current, 'x', [projects.map((p) => p.id).join()])
  const onHome = currentId === null
  return (
    <nav ref={strip} aria-label="Projects" className="relative -mx-2 flex shrink-0 items-center gap-2 overflow-x-auto px-3 pt-1.5 pb-3 [scrollbar-width:none]">
      {surface && (
        <span
          aria-hidden
          style={{ transform: `translateX(${surface.pos - 20}px)` }}
          className={cx('card pointer-events-none absolute top-1.5 left-0 size-10 rounded-lg', surface.animate && GLIDE)}
        />
      )}
      <span data-slot={ALL} className="relative inline-flex shrink-0">
        <button
          type="button"
          aria-label="All projects"
          aria-current={onHome || undefined}
          onClick={() => onPick(null)}
          className={cx(
            'inline-flex size-10 cursor-pointer items-center justify-center rounded-lg focus-visible:outline-offset-1! transition-colors duration-(--dur-3) ease-(--ease-out-app)',
            onHome ? 'text-text' : TILE_REST,
          )}
        >
          <IconGrid size={18} />
        </button>
      </span>
      {projects.map((p) => (
        <span key={p.id} data-slot={p.id} className="relative inline-flex shrink-0">
          <button type="button" aria-label={p.name} aria-current={p.id === currentId || undefined} onClick={() => onPick(p.id)} className={TILE_BUTTON}>
            <RailTile project={p} size="lg" current={p.id === currentId} nudge={false} />
          </button>
        </span>
      ))}
      <button type="button" aria-label="Open a project" className={cx('inline-flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-lg focus-visible:outline-offset-1!', TILE_REST)}>
        <IconPlus size={18} />
      </button>
    </nav>
  )
}
