import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  frameSize,
  parsePreviewWidth,
  previewWidthLabel,
  readPreviewWidth,
  writePreviewWidth,
} from '../src/lib/preview-width'

/**
 * The previewed page lays out at a real screen width and is scaled to fit the
 * pane (design-mode ticket 19): the frame's size and scale, the menu's label,
 * and the remembered choice.
 */
describe('frameSize', () => {
  it('shrinks a width wider than the pane to the pane, tall enough to fill it once scaled', () => {
    expect(frameSize(1440, { width: 720, height: 600 })).toEqual({ width: 1440, height: 1200, scale: 0.5, left: 0 })
  })

  it('keeps a width narrower than the pane at scale 1, centred', () => {
    expect(frameSize(390, { width: 870, height: 600 })).toEqual({ width: 390, height: 600, scale: 1, left: 240 })
  })

  it('fills the pane at Fit', () => {
    expect(frameSize('fit', { width: 870, height: 600 })).toEqual({ width: 870, height: 600, scale: 1, left: 0 })
  })

  it('scales by 1 while the pane is not laid out yet', () => {
    expect(frameSize(1440, { width: 0, height: 0 })).toEqual({ width: 1440, height: 0, scale: 1, left: 0 })
  })
})

describe('previewWidthLabel', () => {
  it('names the width and the scale, or Fit', () => {
    expect(previewWidthLabel(1440, 870 / 1440)).toBe('1440 · 60%')
    expect(previewWidthLabel(390, 1)).toBe('390 · 100%')
    expect(previewWidthLabel('fit', 1)).toBe('Fit')
  })
})

describe('the remembered width', () => {
  afterEach(() => vi.unstubAllGlobals())

  const memoryStorage = () => {
    const items = new Map<string, string>()
    return {
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => void items.set(key, value),
    }
  }

  it('defaults to Desktop 1440 and remembers a choice across reloads', () => {
    vi.stubGlobal('localStorage', memoryStorage())
    expect(readPreviewWidth()).toBe(1440)
    writePreviewWidth(390)
    expect(readPreviewWidth()).toBe(390)
    writePreviewWidth('fit')
    expect(readPreviewWidth()).toBe('fit')
  })

  it('survives a storage that throws', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('denied')
      },
    })
    expect(() => writePreviewWidth(768)).not.toThrow()
    expect(readPreviewWidth()).toBe(1440)
  })

  it('reads a hand-mangled value as the default', () => {
    for (const bad of ['wide', '-5', '12.5', '', null]) expect(parsePreviewWidth(bad), String(bad)).toBeNull()
    expect(parsePreviewWidth('768')).toBe(768)
  })
})
