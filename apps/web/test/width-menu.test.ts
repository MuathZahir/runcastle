import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { WidthMenu } from '../src/components/review/WidthMenu'

/**
 * The frame's width menu (design-mode ticket 19). Closed, its whole behaviour
 * is the label it reads: the screen width and the scale it is drawn at.
 */
describe('WidthMenu', () => {
  const render = (width: number | 'fit', scale: number) =>
    renderToStaticMarkup(createElement(WidthMenu, { width, scale, onPick: () => {} }))

  it('reads the width and the scale', () => {
    const html = render(1440, 0.61)
    expect(html).toContain('aria-label="Screen width"')
    expect(html).toContain('1440 · 61%')
  })

  it('reads Fit when the frame takes the pane’s width', () => {
    expect(render('fit', 1)).toContain('>Fit<')
  })
})
