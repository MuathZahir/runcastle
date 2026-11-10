import { cx } from '../../src/ui'
import { statsOf, type MockProject } from './data'

/**
 * A project's mark: its initials in a quiet square, monochrome like the rest of
 * the sidebar. Colour stays free for what it tells: amber means "needs you".
 */

/** "JanaLearn_Updated" → "JL", "runcastle-demo" → "RD", "runcastle" → "R". */
export function initialsOf(name: string): string {
  const words = name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[\s_\-.]+/)
    .filter(Boolean)
  if (words.length >= 2) return (words[0]![0]! + words[1]![0]!).toUpperCase()
  return (words[0]?.[0] ?? '?').toUpperCase()
}

const SIZE = {
  /** Beside a name in a row: 20px. */
  sm: 'size-5 rounded-sm text-xs',
  /** On the rail: 36px. */
  md: 'size-9 rounded-lg text-sm',
  /** On the phone strip: 40px. */
  lg: 'size-10 rounded-lg text-md',
} as const

/**
 * A tile on the All projects page. `outline` sits in a row beside the name (a
 * hairline square, the letters in the muted grey); `well` sits inside a card
 * that already has an edge (the small fill well).
 */
export function ProjectTile({
  project,
  size,
  tone = 'outline',
  className,
}: {
  project: MockProject
  size: keyof typeof SIZE
  tone?: 'outline' | 'well'
  className?: string
}) {
  return (
    <span
      aria-hidden
      className={cx(
        'inline-flex shrink-0 items-center justify-center font-medium tracking-tight select-none',
        SIZE[size],
        tone === 'outline' && 'text-text-tertiary ring-1 ring-border ring-inset',
        tone === 'well' && 'bg-fill-well text-text-secondary',
        className,
      )}
    >
      {initialsOf(project.name)}
    </span>
  )
}

/**
 * A rail tile: just its letters, no surface of its own (the rail's one
 * selection surface glides under the current tile). At rest a tile recedes:
 * dimmer than the sidebar's muted grey and nudged toward the window edge;
 * hovered it comes partway back; the current one sits out, at full strength.
 * Position and colour ease together, so a switch slides the old tile back as
 * the new one comes out. The one mark is the amber needs-you dot, which never
 * dims with its tile; the current project carries none (its sidebar says it).
 * Running is not shown on the rail. The keyboard's focus outline is drawn on
 * this tile (inside a `group/btn` button), so it fits the tile's radius and
 * moves with it, rather than sitting on the button's unmoved box.
 */
export function RailTile({
  project,
  size,
  current,
  lit = false,
  nudge = true,
}: {
  project: MockProject
  size: 'md' | 'lg'
  current: boolean
  /** Shown as hovered (the design page's "mid-switch" state, where no pointer is). */
  lit?: boolean
  /** Slide sideways with the state (the rail); the phone's strip only dims. */
  nudge?: boolean
}) {
  const s = statsOf(project)
  const needs = `${s.needsYou} need${s.needsYou === 1 ? 's' : ''} you`
  return (
    <span
      className={cx(
        'relative inline-flex shrink-0 items-center justify-center font-medium tracking-tight select-none',
        'transition-[translate,color] duration-(--dur-3) ease-(--ease-out-app) motion-reduce:transition-none',
        SIZE[size],
        FOCUS_ON_TILE,
        current
          ? cx('text-text', nudge && 'translate-x-[3px]')
          : lit
            ? cx(TILE_LIT, nudge && '-translate-x-0.5')
            : cx(TILE_REST, 'group-hover/tile:text-text-tertiary group-focus-visible/btn:text-text-tertiary', nudge && '-translate-x-1 group-hover/tile:-translate-x-0.5 group-focus-visible/btn:-translate-x-0.5'),
      )}
    >
      {initialsOf(project.name)}
      {!current && s.needsYou > 0 && <span role="img" aria-label={needs} className="absolute top-1 right-1 size-1.5 animate-fade-in rounded-full bg-warning" />}
    </span>
  )
}

/** The app's focus outline (2px, the focus-ring colour), on the tile, hugging its radius; keyboard only. */
export const FOCUS_ON_TILE = 'group-focus-visible/btn:outline-2 group-focus-visible/btn:outline-offset-1 group-focus-visible/btn:outline-focus-ring'
/**
 * The button that holds a tile: its own outline gives way to the tile's. The
 * app's focus rule is unlayered (styles.css), so only an important utility
 * can turn it off here.
 */
export const TILE_BUTTON = 'group/btn cursor-pointer rounded-lg focus-visible:outline-none!'

/** A rail tile at rest: the muted grey, dimmed again — still legible, clearly below the sidebar's own muted text. */
export const TILE_REST = 'text-[color-mix(in_oklab,var(--color-text-tertiary)_58%,transparent)]'
/** Hovered: back up to the sidebar's muted grey. */
export const TILE_LIT = 'text-text-tertiary'

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
