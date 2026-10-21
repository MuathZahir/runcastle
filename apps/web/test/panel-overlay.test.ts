import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PanelSplit } from '../src/components/workspace/FeaturePanel'

/**
 * Below ~1100px of content width the panel floats over the chat (design-mode
 * spec): docked right, full height, above it, with a shadow. Tailwind only
 * emits a class it can read whole in source, so each overlay class the panel
 * renders must also be written out as a literal there — a variant assembled at
 * runtime renders fine and styles nothing.
 */
describe('the narrow panel overlay', () => {
  const html = renderToStaticMarkup(
    createElement(PanelSplit, {
      chat: 'the chat',
      panel: 'the panel',
      share: 0.5,
      collapsed: false,
      onResize: () => {},
      onToggleFull: () => {},
    }),
  )
  const panelClasses = (/<div data-panel="[^"]*"[^>]*\bclass="([^"]*)"/.exec(html)?.[1] ?? '').split(' ')
  const source = readFileSync(join(import.meta.dirname, '../src/components/workspace/FeaturePanel.tsx'), 'utf8')

  it('docks the panel right, full height, above the chat, with a shadow', () => {
    for (const cls of ['absolute', 'inset-y-0', 'right-0', 'z-20', 'shadow-dialog']) {
      expect(panelClasses).toContain(`@max-[1100px]:${cls}`)
    }
  })

  it('writes every overlay class as a literal Tailwind can see', () => {
    const overlay = panelClasses.filter((c) => c.startsWith('@max-[1100px]:'))
    expect(overlay.length).toBeGreaterThan(0)
    for (const cls of overlay) expect(source).toMatch(new RegExp(`['\\s]${cls.replace(/[[\]]/g, '\\$&')}[\\s']`))
  })
})
