import { useCallback, useEffect, useState } from 'react'

/**
 * How wide the features rail is (decision 10).
 *
 * The rail used to be a fixed 252px, at which five features all called
 * "Flow redesign: …" truncated to the same string. It is wider by default now
 * and the human can drag it, because how much room a title needs depends on the
 * project's naming habits rather than on anything the app can know.
 *
 * The width is a *screen* preference, not a project fact, so it persists under
 * one global key — the same choice `runcastle.inspector.collapsed` and
 * `runcastle.maprail.collapsed` already make.
 */
const SIDEBAR_WIDTH_KEY = 'runcastle.sidebar.w'

/** Narrow enough that the rail is still a rail; the prototype's lower clamp. */
export const SIDEBAR_MIN_W = 240
/** Wide enough for a long title on two lines, before the rail eats the body. */
export const SIDEBAR_MAX_W = 420
/** The prototype's approved default (decision 14), up from the old 252. */
export const SIDEBAR_DEFAULT_W = 300

/** A width in pixels, held inside the clamp. Non-finite input reads as the default. */
export function clampSidebarWidth(px: number): number {
  if (!Number.isFinite(px)) return SIDEBAR_DEFAULT_W
  return Math.min(SIDEBAR_MAX_W, Math.max(SIDEBAR_MIN_W, Math.round(px)))
}

/**
 * The stored width, or the default. Anything unparseable — an absent key, a
 * hand-edited value, a width from before the clamp existed — comes back inside
 * the clamp rather than as a rail nobody can drag back into view.
 */
export function readSidebarWidth(): number {
  let stored: string | null = null
  try {
    stored = localStorage.getItem(SIDEBAR_WIDTH_KEY)
  } catch {
    return SIDEBAR_DEFAULT_W // storage unavailable (private mode)
  }
  if (stored === null) return SIDEBAR_DEFAULT_W
  const px = Number(stored)
  return Number.isFinite(px) ? clampSidebarWidth(px) : SIDEBAR_DEFAULT_W
}

function writeSidebarWidth(px: number): void {
  try {
    localStorage.setItem(SIDEBAR_WIDTH_KEY, String(px))
  } catch {
    // storage unavailable — the drag still works for this session
  }
}

export interface SidebarWidth {
  /** The rail's width in pixels, always inside the clamp. */
  width: number
  /** Set it from a raw drag measurement; clamps and persists. */
  setWidth: (px: number) => void
}

/** The rail's width as state, read from storage on mount and written back on change. */
export function useSidebarWidth(): SidebarWidth {
  const [width, setState] = useState(readSidebarWidth)

  useEffect(() => {
    writeSidebarWidth(width)
  }, [width])

  const setWidth = useCallback((px: number) => setState(clampSidebarWidth(px)), [])

  return { width, setWidth }
}
