/**
 * The width a previewed page lays out at (design-mode ticket 19).
 *
 * The design view and the drive show a page in a pane far narrower than the
 * screen it was built for, and a page laid out at the pane's width wraps where
 * it never would on that screen. So the frame is given a real device width and
 * scaled down to fit — the page lays out exactly as on that screen, only
 * smaller. `fit` is the old behaviour: the frame fills the pane.
 *
 * Pure: the sizing arithmetic, the menu's words, and the stored choice. A width
 * is a screen preference, so one global key holds it — as `rail-width.ts`'s do.
 */

/** A device width in CSS pixels, or `fit`: the frame takes the pane's own width. */
export type PreviewWidth = number | 'fit'

/** What the width menu offers, widest first. */
export const PREVIEW_WIDTHS: readonly { width: PreviewWidth; name: string }[] = [
  { width: 1440, name: 'Desktop' },
  { width: 1280, name: 'Laptop' },
  { width: 768, name: 'Tablet' },
  { width: 390, name: 'Mobile' },
  { width: 'fit', name: 'Fit' },
]

/** Where a fresh browser starts: the desktop a landing page is usually built for. */
export const DEFAULT_PREVIEW_WIDTH: PreviewWidth = 1440

export const PREVIEW_WIDTH_KEY = 'runcastle.preview.width'

/** How the frame sits in its pane: its own size, the scale it is drawn at, and its left edge. */
export interface FrameSize {
  /** The frame's layout width, the width the page sees. */
  width: number
  /** The frame's layout height: tall enough that, scaled, it fills the pane. */
  height: number
  /** 1 or less — a frame is shrunk to fit, never blown up. */
  scale: number
  /** The scaled frame's left edge in the pane: a narrow width is centred. */
  left: number
}

/**
 * The frame's size for a chosen width in a pane of `pane` pixels. Wider than
 * the pane, it shrinks to the pane's width; narrower, it keeps scale 1 and is
 * centred. `fit` fills the pane. A pane not laid out yet scales by 1 rather
 * than by zero or infinity.
 */
export function frameSize(chosen: PreviewWidth, pane: { width: number; height: number }): FrameSize {
  if (chosen === 'fit') return { width: pane.width, height: pane.height, scale: 1, left: 0 }
  const scale = pane.width > 0 ? Math.min(1, pane.width / chosen) : 1
  return {
    width: chosen,
    height: pane.height / scale,
    scale,
    left: Math.max(0, (pane.width - chosen) / 2),
  }
}

/** The menu's closed label: `1440 · 61%`, or `Fit`. */
export function previewWidthLabel(chosen: PreviewWidth, scale: number): string {
  return chosen === 'fit' ? 'Fit' : `${chosen} · ${Math.round(scale * 100)}%`
}

/** A width the frame can lay out at: a whole, positive number of pixels, or `fit`. */
export function parsePreviewWidth(value: unknown): PreviewWidth | null {
  if (value === 'fit') return 'fit'
  const px = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
  return typeof px === 'number' && Number.isInteger(px) && px > 0 ? px : null
}

/** The stored choice, or the default — for a missing, unreadable or hand-mangled value alike. */
export function readPreviewWidth(): PreviewWidth {
  try {
    return parsePreviewWidth(localStorage.getItem(PREVIEW_WIDTH_KEY)) ?? DEFAULT_PREVIEW_WIDTH
  } catch {
    return DEFAULT_PREVIEW_WIDTH // storage unavailable (private mode)
  }
}

export function writePreviewWidth(chosen: PreviewWidth): void {
  try {
    localStorage.setItem(PREVIEW_WIDTH_KEY, String(chosen))
  } catch {
    // storage unavailable — the choice still holds for this session
  }
}
