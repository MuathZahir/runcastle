import { useCallback, useEffect, useState } from 'react'

/**
 * How wide a draggable rail is, for every rail that drags.
 *
 * Two do: the features rail (decision 10) and the review page's notes rail. They
 * want the same three things — a clamp a hand-edited value cannot escape, a
 * storage key, and state that writes itself back — and differ only in the
 * numbers, so the numbers are the argument and this is the machinery.
 *
 * A width is a *screen* preference, not a project fact, so every key here is a
 * global one — the same choice `runcastle.inspector.collapsed` and
 * `runcastle.maprail.collapsed` already make.
 */
export interface RailWidthSpec {
  /** The storage key this rail's width persists under. */
  key: string
  /** Narrow enough that the rail is still a rail. */
  min: number
  /** Wide enough to be worth dragging to, before the rail eats the body. */
  max: number
  default: number
}

/** A width in pixels, held inside the spec's clamp. Non-finite input reads as the default. */
export function clampRailWidth(spec: RailWidthSpec, px: number): number {
  if (!Number.isFinite(px)) return spec.default
  return Math.min(spec.max, Math.max(spec.min, Math.round(px)))
}

/**
 * The stored width, or the default. Anything unparseable — an absent key, a
 * hand-edited value, a width from before the clamp existed — comes back inside
 * the clamp rather than as a rail nobody can drag back into view.
 */
export function readRailWidth(spec: RailWidthSpec): number {
  let stored: string | null = null
  try {
    stored = localStorage.getItem(spec.key)
  } catch {
    return spec.default // storage unavailable (private mode)
  }
  if (stored === null) return spec.default
  const px = Number(stored)
  return Number.isFinite(px) ? clampRailWidth(spec, px) : spec.default
}

function writeRailWidth(spec: RailWidthSpec, px: number): void {
  try {
    localStorage.setItem(spec.key, String(px))
  } catch {
    // storage unavailable — the drag still works for this session
  }
}

export interface RailWidth {
  /** The rail's width in pixels, always inside the clamp. */
  width: number
  /** Set it from a raw drag measurement; clamps and persists. */
  setWidth: (px: number) => void
}

/**
 * The rail's width as state, read from storage on mount and written back on
 * change. `spec` is expected to be a module constant — it is a dependency of
 * both the write and the setter.
 */
export function useRailWidth(spec: RailWidthSpec): RailWidth {
  const [width, setState] = useState(() => readRailWidth(spec))

  useEffect(() => {
    writeRailWidth(spec, width)
  }, [spec, width])

  const setWidth = useCallback((px: number) => setState(clampRailWidth(spec, px)), [spec])

  return { width, setWidth }
}
