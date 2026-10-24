/**
 * What the palette preview compares: today's light values (the "Today" column
 * of the values table in docs/features/lighten-the-light-theme-s-colours/
 * spec.md, held here so the page still shows them after theme.css moves on),
 * the coloured tokens it lays out, the grounds it lays them on, and the WCAG
 * contrast arithmetic it measures them with.
 */

/** Today's light literals, before the retune. */
const TODAY = {
  success: '#1e8e53',
  warning: '#a86a06',
  danger: '#c42828',
  accent: '#2f6fe4',
  accentText: '#2463d6',
  ideation: '#c13d7e',
  spec: '#0b7f78',
  implementation: '#b44f0c',
} as const

/**
 * Today's light theme as inline custom properties. Every reference token is
 * restated too, not just the literals: a custom property holding a `var()` is
 * resolved where it is declared (`:root`), so overriding `--color-phase-spec`
 * on a wrapper would leave `--color-phase-planning` on the new value. Today
 * every word peer equalled its hue, so the peers are the hues.
 */
export const TODAY_LIGHT: Record<`--color-${string}`, string> = {
  '--color-success': TODAY.success,
  '--color-warning': TODAY.warning,
  '--color-danger': TODAY.danger,
  '--color-accent': TODAY.accent,
  '--color-accent-text': TODAY.accentText,
  '--color-phase-ideation': TODAY.ideation,
  '--color-phase-spec': TODAY.spec,
  '--color-phase-implementation': TODAY.implementation,
  '--color-phase-planning': TODAY.spec,
  '--color-phase-tickets': TODAY.warning,
  '--color-phase-building': TODAY.implementation,
  '--color-phase-review': TODAY.accent,
  '--color-phase-shipped': TODAY.success,
  '--color-focus-ring': TODAY.accent,
  '--color-text-secondary': '#4c5366',
  '--color-text-tertiary': '#5c6377',
  '--color-icon': '#6a7185',
  '--color-success-text': TODAY.success,
  '--color-warning-text': TODAY.warning,
  '--color-danger-text': TODAY.danger,
  '--color-phase-ideation-text': TODAY.ideation,
  '--color-phase-spec-text': TODAY.spec,
  '--color-phase-implementation-text': TODAY.implementation,
  '--color-phase-planning-text': TODAY.spec,
  '--color-phase-tickets-text': TODAY.warning,
  '--color-phase-building-text': TODAY.implementation,
  '--color-phase-review-text': TODAY.accent,
  '--color-phase-shipped-text': TODAY.success,
}

/** The grounds a coloured word or mark sits on, palest to darkest. */
export const GROUNDS = ['surface', 'canvas', 'surface-hover', 'surface-selected'] as const
export type Ground = (typeof GROUNDS)[number]

/** WCAG AA: words at 4.5:1, marks you only need to see at 3:1 (decision 2). */
export const WORD_FLOOR = 4.5
export const MARK_FLOOR = 3

export interface PaletteToken {
  /** The token name after `--color-`. */
  name: string
  /** The mark's colour, or null for a grey that only paints words. */
  mark: string | null
  /** The words' colour, or null for a grey that only paints marks. */
  word: string | null
  /** Words that got a shade deeper rather than lighter (decision 5). */
  deeper?: boolean
}

/**
 * A hue's word peer, falling back to the hue itself while the `-text` peers
 * do not exist yet (before the theme ticket lands, or on a branch without it).
 */
function peer(name: string): string {
  return `var(--color-${name}-text, var(--color-${name}))`
}

export const TOKENS: PaletteToken[] = [
  { name: 'success', mark: 'var(--color-success)', word: peer('success'), deeper: true },
  { name: 'warning', mark: 'var(--color-warning)', word: peer('warning'), deeper: true },
  { name: 'danger', mark: 'var(--color-danger)', word: peer('danger') },
  { name: 'accent', mark: 'var(--color-accent)', word: 'var(--color-accent-text)' },
  { name: 'phase-ideation', mark: 'var(--color-phase-ideation)', word: peer('phase-ideation') },
  { name: 'phase-spec', mark: 'var(--color-phase-spec)', word: peer('phase-spec'), deeper: true },
  { name: 'phase-implementation', mark: 'var(--color-phase-implementation)', word: peer('phase-implementation') },
  { name: 'text-secondary', mark: null, word: 'var(--color-text-secondary)' },
  { name: 'text-tertiary', mark: null, word: 'var(--color-text-tertiary)' },
  { name: 'icon', mark: 'var(--color-icon)', word: null },
  { name: 'focus-ring', mark: 'var(--color-focus-ring)', word: null },
]

export type Rgb = readonly [number, number, number]

/** A channel (0–255) in linear light, per WCAG 2.x relative luminance. */
function linear(channel: number): number {
  const c = channel / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

export function luminance([r, g, b]: Rgb): number {
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
}

/** The WCAG contrast ratio of two opaque colours, 1–21. */
export function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}
