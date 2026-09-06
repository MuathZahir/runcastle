/**
 * Tab self-capture geometry for the Open-app drive panel (decision 39).
 *
 * The panel embeds the dev server in a plain cross-origin iframe, so nothing in
 * the page can read its pixels. What can is the tab's own capture stream:
 * `getDisplayMedia({ preferCurrentTab: true })` hands back a video of THIS
 * viewport, composited — the iframe's live state included, which is the whole
 * point (a server-side screenshot cannot see where the human navigated to).
 *
 * The stream frame is the whole viewport at the compositor's resolution, and a
 * selection is a rectangle in CSS pixels inside the panel. Turning one into the
 * other is the only arithmetic here, and it is kept pure so it can be tested:
 * `getDisplayMedia` does not exist in happy-dom, so the rest of the chain is
 * proven by the spike (`prototypes/capture-spike/VERDICT.md`) rather than by a
 * unit test.
 */

/** A rectangle, in whatever pixel space its caller is working in. */
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** The rectangle two drag points describe, in either drag direction. */
export function selectionRect(anchor: { x: number; y: number }, point: { x: number; y: number }): Rect {
  return {
    x: Math.min(anchor.x, point.x),
    y: Math.min(anchor.y, point.y),
    width: Math.abs(point.x - anchor.x),
    height: Math.abs(point.y - anchor.y),
  }
}

/**
 * Where a selection drawn inside the panel lands in the capture stream's own
 * pixels.
 *
 * `selection` is relative to the panel; `panel` is the panel's own position in
 * the viewport (its `getBoundingClientRect()`), in the same CSS pixels. Adding
 * the two puts the selection in viewport coordinates, which is exactly what the
 * stream frames — `preferCurrentTab` guarantees the captured surface IS this
 * viewport, so the mapping is exact rather than approximate.
 *
 * The one scale factor is `videoWidth / innerWidth`. It absorbs
 * `devicePixelRatio` generically: whatever ratio the compositor captures at
 * shows up in `videoWidth`, so nothing here needs to know the ratio's value.
 *
 * A degenerate selection (a click, not a drag) is the caller's to reject — this
 * returns the rectangle it was given, scaled, and never invents one.
 */
export function cropRect(
  selection: Rect,
  panel: { left: number; top: number },
  videoWidth: number,
  innerWidth: number,
): Rect {
  // A viewport of no width means the page is not laid out yet; 1:1 is the only
  // honest answer, and it keeps a NaN out of the canvas call downstream.
  const scale = innerWidth > 0 && videoWidth > 0 ? videoWidth / innerWidth : 1
  return {
    x: Math.round((selection.x + panel.left) * scale),
    y: Math.round((selection.y + panel.top) * scale),
    width: Math.round(selection.width * scale),
    height: Math.round(selection.height * scale),
  }
}

/** How small a drag is still a click — under this, there is nothing to capture. */
export const MIN_SELECTION_PX = 8

/** Whether a drag described a region worth grabbing. */
export function isCapturable(selection: Rect): boolean {
  return selection.width >= MIN_SELECTION_PX && selection.height >= MIN_SELECTION_PX
}

/**
 * Whether this browser can capture its own tab (decision 39's Chromium-only
 * constraint).
 *
 * `preferCurrentTab` and `selfBrowserSurface` are Chromium options on an options
 * bag, so there is nothing to feature-detect on them directly: passing them to
 * Firefox or Safari silently gets the full picker instead of the one-click "share
 * this tab", which is a worse experience than the honest fallback. `navigator.
 * userAgentData` is Chromium-only and is the narrowest proxy available, so the
 * two together are the gate.
 */
export function tabCaptureSupported(
  nav: { mediaDevices?: { getDisplayMedia?: unknown } } | undefined,
): boolean {
  if (!nav) return false
  return typeof nav.mediaDevices?.getDisplayMedia === 'function' && 'userAgentData' in nav
}
