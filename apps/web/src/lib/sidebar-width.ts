import { clampRailWidth, readRailWidth, useRailWidth, type RailWidth, type RailWidthSpec } from './rail-width'

/**
 * How wide the features rail is (decision 10).
 *
 * The rail used to be a fixed 252px, at which five features all called
 * "Flow redesign: …" truncated to the same string. It is wider by default now
 * and the human can drag it, because how much room a title needs depends on the
 * project's naming habits rather than on anything the app can know.
 *
 * The clamp and the persistence are {@link useRailWidth}'s — shared with the
 * review page's notes rail, which drags the same way.
 */

/** Narrow enough that the rail is still a rail; the prototype's lower clamp. */
export const SIDEBAR_MIN_W = 240
/** Wide enough for a long title on two lines, before the rail eats the body. */
export const SIDEBAR_MAX_W = 420
/** The prototype's approved default (decision 14), up from the old 252. */
export const SIDEBAR_DEFAULT_W = 300

const SIDEBAR: RailWidthSpec = {
  key: 'runcastle.sidebar.w',
  min: SIDEBAR_MIN_W,
  max: SIDEBAR_MAX_W,
  default: SIDEBAR_DEFAULT_W,
}

/** A width in pixels, held inside the clamp. Non-finite input reads as the default. */
export function clampSidebarWidth(px: number): number {
  return clampRailWidth(SIDEBAR, px)
}

/** The stored width, or the default — always inside the clamp. */
export function readSidebarWidth(): number {
  return readRailWidth(SIDEBAR)
}

export type SidebarWidth = RailWidth

/** The rail's width as state, read from storage on mount and written back on change. */
export function useSidebarWidth(): SidebarWidth {
  return useRailWidth(SIDEBAR)
}
