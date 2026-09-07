import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The native element reset (apps/web/STYLE.md, "No preflight").
 *
 * `theme.css` imports Tailwind's theme and utilities layers but not its base
 * reset, because that reset would change the legacy sheet under it. The price is
 * that a `<button>` keeps the user agent's light chrome on a near-black app, so
 * the file hand-writes the slice of preflight that fixes exactly that — and only
 * that.
 *
 * Two things about it are load-bearing and neither is visible from a diff, which
 * is why they are asserted here: the reset is scoped to the one element (widen
 * it to `ol, ul` and the markdown bullets go, which is the whole reason
 * preflight is out), and it lives in `@layer base` so both the legacy sheet and
 * the utilities still beat it.
 */
const css = readFileSync(join(import.meta.dirname, '../src/theme.css'), 'utf8')

/** The rules inside `@layer base { … }`, as selector → declaration text. */
function baseLayerRules(): Map<string, string> {
  const open = css.indexOf('@layer base {')
  if (open === -1) throw new Error('theme.css declares no `@layer base` block')
  let depth = 0
  let end = open
  for (let i = css.indexOf('{', open); i < css.length; i++) {
    if (css[i] === '{') depth++
    else if (css[i] === '}' && --depth === 0) {
      end = i
      break
    }
  }
  const body = css.slice(css.indexOf('{', open) + 1, end).replace(/\/\*[\s\S]*?\*\//g, '')
  const rules = new Map<string, string>()
  for (const [, selector, decls] of body.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    rules.set(selector.trim(), decls.trim())
  }
  return rules
}

describe('native element reset', () => {
  it('does not pull in preflight', () => {
    expect(css).not.toMatch(/tailwindcss\/preflight/)
    // The bare `@import "tailwindcss"` is the one that would bring it along.
    expect(css).not.toMatch(/@import\s+["']tailwindcss["']/)
  })

  it('orders the layers so utilities and the legacy sheet both win', () => {
    const statement = css.match(/@layer ([^;{]+);/)?.[1]
    const order = statement?.split(',').map((name) => name.trim())
    expect(order).toBeDefined()
    expect(order!.indexOf('base')).toBeGreaterThan(-1)
    expect(order!.indexOf('base')).toBeLessThan(order!.indexOf('utilities'))
  })

  it('takes the user agent paint off a bare button', () => {
    const decls = baseLayerRules().get('button')
    expect(decls).toBeDefined()
    expect(decls).toMatch(/appearance:\s*none/)
    expect(decls).toMatch(/background:\s*none/)
    expect(decls).toMatch(/border:\s*0/)
    expect(decls).toMatch(/padding:\s*0/)
  })

  it('resets nothing but that one element', () => {
    expect([...baseLayerRules().keys()]).toEqual(['button'])
  })

  it('has no select left to reset', () => {
    // The `<select>` slice was retired with the last raw one in the app: every
    // picker is a `Select` or a `Combobox` now, and both are a button plus a
    // portalled list this app styles itself. A raw `<select>` reintroduced here
    // would drop the platform's white listbox into a near-black app, so this
    // fails on the markup rather than waiting for the rule to be missed.
    const src = join(import.meta.dirname, '../src')
    const rendered = readdirSync(src, { recursive: true, encoding: 'utf8' })
      .filter((file) => file.endsWith('.tsx'))
      .filter((file) => readFileSync(join(src, file), 'utf8').includes('<select'))

    expect(rendered).toEqual([])
  })
})
