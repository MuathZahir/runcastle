import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Spinner } from '../src/ui'

/**
 * The `prefers-reduced-motion` switch in `theme.css` clamps every animation to
 * one near-instant iteration. For a garnish that is the point; for an infinite
 * spinner it lands on its end frame and freezes, so "Loading feature…" looked
 * stuck on a machine with animation effects off. A progress indicator marks
 * itself `data-progress` and swaps the rotation for a slow opacity pulse there.
 */
const css = readFileSync(join(import.meta.dirname, '../src/theme.css'), 'utf8')

/** The body of the `@media (prefers-reduced-motion: reduce) { … }` block. */
function reducedMotionBlock(): string {
  const open = css.indexOf('@media (prefers-reduced-motion: reduce)')
  if (open === -1) throw new Error('theme.css has no reduced-motion block')
  let depth = 0
  const start = css.indexOf('{', open)
  for (let i = start; i < css.length; i++) {
    if (css[i] === '{') depth++
    else if (css[i] === '}' && --depth === 0) {
      return css.slice(start + 1, i).replace(/\/\*[\s\S]*?\*\//g, '')
    }
  }
  throw new Error('unterminated reduced-motion block')
}

describe('reduced motion', () => {
  it('still clamps motion everywhere else', () => {
    expect(reducedMotionBlock()).toMatch(/\*,\s*\*::before,\s*\*::after\s*\{[^}]*animation-iteration-count:\s*1 !important/)
  })

  it('keeps a progress indicator saying "working" with a slow, endless pulse', () => {
    const rule = reducedMotionBlock().match(/\[data-progress\]\s*\{([^}]*)\}/)?.[1]
    expect(rule).toBeDefined()
    expect(rule).toMatch(/animation:\s*pulse\s[^;]*infinite\s*!important/)
  })

  it('marks the spinner as a progress indicator', () => {
    expect(renderToStaticMarkup(createElement(Spinner))).toContain('data-progress')
  })
})
