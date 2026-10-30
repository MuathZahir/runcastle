import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Crumbs } from '../src/ui/page'

/** A thread trails its feature in the page header (the-chat-looks-the-part decision 5). */
const render = (labels: string[], trail?: boolean) =>
  renderToStaticMarkup(createElement(Crumbs, { items: labels.map((label) => ({ label })), ...(trail ? { trail } : {}) }))

const classOf = (html: string, label: string) => new RegExp(`class="([^"]*)"[^>]*><span class="truncate">${label}<`).exec(html)?.[1] ?? ''

describe('Crumbs', () => {
  it('reads the last item as the page by default', () => {
    const html = render(['Export notes', 'Feature chat'])
    expect(classOf(html, 'Feature chat')).toContain('font-medium text-text')
    expect(classOf(html, 'Export notes')).toContain('text-text-tertiary')
  })

  it('with trail, the item before the last leads and the last reads quietly', () => {
    const html = render(['Export notes', 'Feature chat'], true)
    expect(classOf(html, 'Export notes')).toContain('font-medium text-text')
    expect(classOf(html, 'Feature chat')).toContain('text-text-secondary')
    expect(classOf(html, 'Feature chat')).not.toContain('font-medium')
  })

  it('with trail and one item, that item is still the page', () => {
    expect(classOf(render(['Export notes'], true), 'Export notes')).toContain('font-medium text-text')
  })
})
