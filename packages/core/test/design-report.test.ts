import { describe, expect, it } from 'vitest'
import { parseDesignReport } from '../src/designs'

/** What a design page may post (agents-see-the-tweaks-you-picked decisions 5, 10). */
describe('parseDesignReport', () => {
  it('keeps a good report as it was posted', () => {
    const report = { type: 'runcastle:design', state: 'full', tweaks: { accent: 'teal', compact: true, columns: 3 } }
    expect(parseDesignReport(report)).toEqual(report)
  })

  it('keeps a partial report: a single-state page, an empty set, a missing tweaks field', () => {
    expect(parseDesignReport({ type: 'runcastle:design', state: null, tweaks: {} })).toEqual({
      type: 'runcastle:design',
      state: null,
      tweaks: {},
    })
    const silent = parseDesignReport({ type: 'runcastle:design', state: 'empty' })
    expect(silent).toEqual({ type: 'runcastle:design', state: 'empty' })
    expect(silent).not.toHaveProperty('tweaks')
  })

  it('trims an oversized report to 12 tweaks and 80 characters, never dropping it', () => {
    const tweaks: Record<string, string | number> = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`k${i}`, i]))
    tweaks['k0'] = 'v'.repeat(200)
    const long = 'x'.repeat(200)
    const report = parseDesignReport({ type: 'runcastle:design', state: long, tweaks: { [long]: long, ...tweaks } })
    expect(report).not.toBeNull()
    expect(report!.state).toHaveLength(80)
    const entries = Object.entries(report!.tweaks!)
    expect(entries).toHaveLength(12)
    expect(entries[0]).toEqual(['x'.repeat(80), 'x'.repeat(80)])
    expect(entries[1]).toEqual(['k0', 'v'.repeat(80)])
    expect(entries[2]).toEqual(['k1', 1])
  })

  it('returns null for a foreign or malformed message', () => {
    expect(parseDesignReport('hello')).toBeNull()
    expect(parseDesignReport(null)).toBeNull()
    expect(parseDesignReport({ type: 'webpackOk' })).toBeNull()
    expect(parseDesignReport({ type: 'runcastle:design' })).toBeNull()
    expect(parseDesignReport({ type: 'runcastle:design', state: 3 })).toBeNull()
    expect(parseDesignReport({ type: 'runcastle:design', state: null, tweaks: { a: { nested: 1 } } })).toBeNull()
    expect(parseDesignReport({ type: 'runcastle:design', state: null, tweaks: ['teal'] })).toBeNull()
  })
})
