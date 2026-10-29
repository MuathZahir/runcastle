import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * `theme.css`'s colour tokens per theme, read from the file itself: the
 * `@theme static` block is dark, and the `:root[data-theme="light"]` block
 * overrides it — whatever light does not restate is shared.
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
export const themeColours = {
  dark,
  light: { ...dark, ...colours(block(':root[data-theme="light"]')) },
}

export type ThemeName = keyof typeof themeColours

/**
 * A token's value in `theme` (named without `--color-`), every `var()` hop
 * followed. A see-through ground (`color-mix(in oklab, var(--color-x) N%,
 * transparent)` — hover, selected, the card) resolves to what it paints over
 * the canvas, the darkest ground it sits on in light, blended in sRGB: at a
 * few percent the gap to oklab is under one step per channel.
 */
export function resolveColour(theme: ThemeName, name: string): string {
  const tokens = themeColours[theme]
  let value = tokens[name]
  for (let hops = 0; value !== undefined && hops < 10; hops++) {
    const mix = /^color-mix\(in oklab, var\(--color-([\w-]+)\) ([\d.]+)%, transparent\)$/.exec(value)
    if (mix) return blend(resolveColour(theme, mix[1]!), resolveColour(theme, 'canvas'), Number(mix[2]) / 100)
    const ref = /^var\(--color-([\w-]+)\)$/.exec(value)
    if (!ref) return value.toLowerCase()
    value = tokens[ref[1]!]
  }
  throw new Error(`--color-${name} does not resolve to a value in ${theme}`)
}

/** `share` of `top` over `ground`, both #rrggbb, blended in sRGB. */
function blend(top: string, ground: string, share: number): string {
  const ch = (hex: string, i: number) => parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16)
  return `#${[0, 1, 2]
    .map((i) => Math.round(share * ch(top, i) + (1 - share) * ch(ground, i)).toString(16).padStart(2, '0'))
    .join('')}`
}
