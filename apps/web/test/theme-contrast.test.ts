import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The light palette holds two WCAG floors (DESIGN.md §Colour): a word painted
 * in a colour clears 4.5:1 against every ground it sits on, and a mark — a dot,
 * glyph, icon, ring — clears the non-text floor of 3:1. Each hue therefore has
 * a `-text` peer for words, so the hue itself is free to be as light as a mark
 * allows. The dark theme's peers equal their hues, so dark renders as before.
 */
const css = readFileSync(join(import.meta.dirname, '../src/theme.css'), 'utf8')

/** The body of the first block opened by `selector`, comments stripped. */
function block(selector: string): string {
  const open = css.indexOf(selector)
  if (open === -1) throw new Error(`theme.css has no ${selector} block`)
  let depth = 0
  const start = css.indexOf('{', open)
  for (let i = start; i < css.length; i++) {
    if (css[i] === '{') depth++
    else if (css[i] === '}' && --depth === 0) {
      return css.slice(start + 1, i).replace(/\/\*[\s\S]*?\*\//g, '')
    }
  }
  throw new Error(`unterminated ${selector} block`)
}

/** Every `--color-<name>: <value>;` in a block, keyed by `<name>`. */
function colours(body: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [, name, value] of body.matchAll(/--color-([\w-]+):\s*([^;]+);/g)) {
    out[name!] = value!.trim()
  }
  return out
}

const dark = colours(block('@theme static'))
/** The light block overrides the dark one; whatever it does not restate is shared. */
const light = { ...dark, ...colours(block(':root[data-theme="light"]')) }

/** A token's value with every `var(--color-…)` hop followed. */
function resolve(theme: Record<string, string>, name: string): string {
  let value = theme[name]
  for (let hops = 0; value !== undefined && hops < 10; hops++) {
    const ref = /^var\(--color-([\w-]+)\)$/.exec(value)
    if (!ref) return value.toLowerCase()
    value = theme[ref[1]!]
  }
  throw new Error(`--color-${name} does not resolve to a value`)
}

function channels(hex: string): [number, number, number] {
  if (!/^#[0-9a-f]{6}$/.test(hex)) throw new Error(`${hex} is not #rrggbb`)
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number]
}

/** WCAG 2 relative luminance of a #rrggbb colour. */
function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((v) => {
    const c = v / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

/** `share` of `hue` over `ground`, blended in sRGB — what a `bg-<hue>/15` wash paints. */
function wash(hue: string, ground: string, share: number): string {
  const g = channels(ground)
  return `#${channels(hue)
    .map((v, i) => Math.round(share * v + (1 - share) * g[i]!).toString(16).padStart(2, '0'))
    .join('')}`
}

function expectContrast(fg: string, bg: string, floor: number): void {
  const a = resolve(light, fg)
  const ratio = contrast(a, bg.startsWith('#') ? bg : resolve(light, bg))
  expect(ratio, `${fg} (${a}) on ${bg} is ${ratio.toFixed(2)}:1, under ${floor}:1`).toBeGreaterThanOrEqual(floor)
}

const WORDS = [
  'success-text',
  'warning-text',
  'danger-text',
  'accent-text',
  'phase-ideation-text',
  'phase-spec-text',
  'phase-implementation-text',
  'text',
  'text-secondary',
  'text-tertiary',
]

/** Each coloured word peer beside the hue its washes are made from. */
const PEERS: [peer: string, hue: string][] = [
  ['success-text', 'success'],
  ['warning-text', 'warning'],
  ['danger-text', 'danger'],
  ['accent-text', 'accent'],
  ['phase-ideation-text', 'phase-ideation'],
  ['phase-spec-text', 'phase-spec'],
  ['phase-implementation-text', 'phase-implementation'],
]

const MARKS = [
  'success',
  'warning',
  'danger',
  'accent',
  'phase-ideation',
  'phase-spec',
  'phase-implementation',
  'icon',
  'focus-ring',
]

/** The light marks before the retune — each must have got lighter. */
const LIGHT_MARKS_BEFORE: Record<string, string> = {
  success: '#1e8e53',
  warning: '#a86a06',
  danger: '#c42828',
  accent: '#2f6fe4',
  'phase-ideation': '#c13d7e',
  'phase-spec': '#0b7f78',
  'phase-implementation': '#b44f0c',
  icon: '#6a7185',
}

describe('the light palette holds its contrast floors', () => {
  it.each(WORDS)('%s clears 4.5:1 as words on the surface and the canvas', (word) => {
    expectContrast(word, 'surface', 4.5)
    expectContrast(word, 'canvas', 4.5)
  })

  it('error and accent words clear 4.5:1 on their subtle grounds', () => {
    expectContrast('danger-text', 'danger-subtle', 4.5)
    expectContrast('accent-text', 'accent-subtle', 4.5)
  })

  it('white numbers on a solid accent-text fill clear 4.5:1', () => {
    expectContrast('on-primary', resolve(light, 'accent-text'), 4.5)
  })

  // Tailwind mixes a `/15` wash in oklab, not sRGB, so hold a small margin.
  it.each(PEERS)('%s clears 4.5:1 on a 15%% wash of %s', (peer, hue) => {
    expectContrast(peer, wash(resolve(light, hue), resolve(light, 'surface'), 0.15), 4.6)
  })

  it.each(MARKS)('%s clears 3:1 as a mark on every ground', (mark) => {
    for (const ground of ['surface', 'canvas', 'surface-hover', 'surface-selected']) {
      expectContrast(mark, ground, 3)
    }
  })

  it.each(Object.entries(LIGHT_MARKS_BEFORE))('%s is lighter than before the retune (%s)', (mark, before) => {
    const now = resolve(light, mark)
    expect(luminance(now), `${mark} ${now} is no lighter than ${before}`).toBeGreaterThan(luminance(before))
  })
})

describe('the dark palette is unchanged by the word peers', () => {
  it.each([
    ['success-text', 'success'],
    ['warning-text', 'warning'],
    ['danger-text', 'danger'],
    ['phase-ideation-text', 'phase-ideation'],
    ['phase-spec-text', 'phase-spec'],
    ['phase-implementation-text', 'phase-implementation'],
    ['phase-planning-text', 'phase-planning'],
    ['phase-tickets-text', 'phase-tickets'],
    ['phase-building-text', 'phase-building'],
    ['phase-shipped-text', 'phase-shipped'],
  ])('%s equals %s', (peer, hue) => {
    expect(resolve(dark, peer)).toBe(resolve(dark, hue))
  })

  it('phase-review-text follows accent-text, which already differs from its hue', () => {
    expect(resolve(dark, 'phase-review-text')).toBe(resolve(dark, 'accent-text'))
  })
})
