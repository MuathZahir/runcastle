import { describe, expect, it } from 'vitest'
import {
  cropRect,
  isCapturable,
  selectionRect,
  tabCaptureSupported,
  type Rect,
} from '../src/lib/capture'

/**
 * The drive panel's capture geometry (decision 39). The stream itself needs
 * `getDisplayMedia`, which no test environment has — so the arithmetic between
 * the drag and the PNG is extracted here and pinned with known-good literals.
 */
describe('selectionRect', () => {
  it('normalises a drag in either direction to the same rectangle', () => {
    const forward = selectionRect({ x: 10, y: 20 }, { x: 110, y: 80 })
    const backward = selectionRect({ x: 110, y: 80 }, { x: 10, y: 20 })
    expect(forward).toEqual({ x: 10, y: 20, width: 100, height: 60 })
    expect(backward).toEqual(forward)
  })
})

describe('isCapturable', () => {
  it('rejects a click and a hairline drag, accepts a real region', () => {
    expect(isCapturable({ x: 0, y: 0, width: 0, height: 0 })).toBe(false)
    expect(isCapturable({ x: 0, y: 0, width: 200, height: 4 })).toBe(false)
    expect(isCapturable({ x: 0, y: 0, width: 8, height: 8 })).toBe(true)
  })
})

describe('cropRect', () => {
  const selection: Rect = { x: 40, y: 30, width: 500, height: 300 }

  it('offsets the panel-relative selection into viewport pixels at 1:1', () => {
    expect(cropRect(selection, { left: 100, top: 60 }, 1440, 1440)).toEqual({
      x: 140,
      y: 90,
      width: 500,
      height: 300,
    })
  })

  it('absorbs devicePixelRatio through the videoWidth / innerWidth ratio', () => {
    // A 2× display captures 2880 stream pixels across a 1440 CSS-px viewport.
    expect(cropRect(selection, { left: 100, top: 60 }, 2880, 1440)).toEqual({
      x: 280,
      y: 180,
      width: 1000,
      height: 600,
    })
  })

  it('rounds to whole stream pixels', () => {
    // 1.5× — every edge lands on a half pixel and must not reach the canvas.
    expect(cropRect({ x: 1, y: 1, width: 3, height: 3 }, { left: 0, top: 0 }, 1500, 1000)).toEqual({
      x: 2,
      y: 2,
      width: 5,
      height: 5,
    })
  })

  it('falls back to 1:1 rather than a NaN when the viewport has no width yet', () => {
    expect(cropRect(selection, { left: 0, top: 0 }, 0, 0)).toEqual(selection)
  })
})

describe('tabCaptureSupported', () => {
  it('is true only for a Chromium that exposes getDisplayMedia', () => {
    expect(tabCaptureSupported({ mediaDevices: { getDisplayMedia: () => undefined }, userAgentData: {} } as never)).toBe(true)
  })

  it('is false without getDisplayMedia, and false off Chromium', () => {
    expect(tabCaptureSupported({ mediaDevices: {}, userAgentData: {} } as never)).toBe(false)
    expect(tabCaptureSupported({ mediaDevices: { getDisplayMedia: () => undefined } })).toBe(false)
    expect(tabCaptureSupported(undefined)).toBe(false)
  })
})
