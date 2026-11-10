import type { FeatureListItem, Project } from './api'
import { projectNeedsYou } from './projects'

/**
 * The project rail's pure half (docs/features/a-better-way-to-move-between-projects):
 * what each tile shows, where a dragged tile lands, and which tile Alt+digit
 * names. The rail component, the phone row and the window's shortcut handler
 * all read these, so the three can never disagree about the order.
 */

/** One tile on the rail, in rail order. */
export interface RailTile {
  id: string
  name: string
  /** Two letters from the name's first two words; one for a one-word name. */
  initials: string
  /** A feature here waits on the human (never true for the project in front). */
  needsYou: boolean
  /** The Alt+digit that reaches it (1–9), or null past the ninth tile. */
  shortcut: number | null
}

/** How many tiles have a shortcut: Alt+1 … Alt+9. */
export const RAIL_SHORTCUTS = 9

/**
 * A name's initials: "JanaLearn_Updated" → "JL", "runcastle-demo" → "RD",
 * "runcastle" → "R". Words split on `-`, `_`, `.`, whitespace and camelCase.
 */
export function initialsOf(name: string): string {
  const words = name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[\s_\-.]+/)
    .filter(Boolean)
  if (words.length >= 2) return (words[0]![0]! + words[1]![0]!).toUpperCase()
  return (words[0]?.[0] ?? '?').toUpperCase()
}

/**
 * The rail's tiles. `featureLists[i]` is `projects[i]`'s feature list (empty
 * while it loads); a project needs you by the same rule as the sidebar's
 * Needs-you section and the tab title, except the one in front, whose sidebar
 * already says so.
 */
export function railTiles(
  projects: readonly Project[],
  featureLists: readonly (readonly FeatureListItem[] | undefined)[],
  currentProjectId: string | null,
): RailTile[] {
  return projects.map((p, i) => ({
    id: p.id,
    name: p.name,
    initials: initialsOf(p.name),
    needsYou: p.id !== currentProjectId && projectNeedsYou(featureLists[i] ?? []),
    shortcut: i < RAIL_SHORTCUTS ? i + 1 : null,
  }))
}

/**
 * `ids` with `id` moved to `toIndex` (clamped to the list), the rest keeping
 * their order. An id not in the list, or a move to where it already is,
 * returns the list unchanged.
 */
export function moveInList<T extends string>(ids: readonly T[], id: T, toIndex: number): T[] {
  const from = ids.indexOf(id)
  if (from < 0) return [...ids]
  const to = Math.max(0, Math.min(ids.length - 1, toIndex))
  if (to === from) return [...ids]
  const rest = ids.filter((_, i) => i !== from)
  rest.splice(to, 0, id)
  return rest
}

/** The minimal subset of `KeyboardEvent` {@link railShortcutIndex} reads. */
export interface RailShortcutEvent {
  code: string
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
}

/**
 * Alt+1 … Alt+9 → the tile index 0 … 8; anything else → null. Read from the
 * physical key (`code`), since macOS Option composes the digit into another
 * character. With Ctrl, Meta or Shift held the chord is someone else's (and
 * Ctrl+Alt is AltGr on Windows), so it is left alone; Alt+0 names no tile.
 */
export function railShortcutIndex(ev: RailShortcutEvent): number | null {
  if (!ev.altKey || ev.ctrlKey || ev.metaKey || ev.shiftKey) return null
  const m = /^Digit([1-9])$/.exec(ev.code)
  return m ? Number(m[1]) - 1 : null
}

/** The hint a tile's tooltip shows beside its name: "Alt+2" (⌥2 on a Mac). */
export function railShortcutLabel(n: number, mac: boolean): string {
  return mac ? `⌥${n}` : `Alt+${n}`
}
