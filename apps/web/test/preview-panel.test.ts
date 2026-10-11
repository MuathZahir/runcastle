import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

const doc = vi.hoisted(() => ({ content: '<!doctype html><p>the show</p>' as string | undefined }))

vi.mock('../src/trpc', () => ({
  trpc: { docs: { read: { useQuery: () => ({ data: doc.content === undefined ? undefined : { content: doc.content }, isLoading: doc.content === undefined, error: null }) } } },
}))

vi.mock('../src/lib/live', () => ({ useLivePoll: () => false }))

const { PreviewPanel } = await import('../src/components/PreviewPanel')

function render(updatedAt?: number): string {
  return renderToStaticMarkup(
    createElement(PreviewPanel, { featureId: 'f1', preview: { relPath: 'preview.html', updatedAt } }),
  )
}

/** plan-preview decisions 6, 7, 9: the panel's heading row and its locked-down frame. */
describe('PreviewPanel', () => {
  it('frames the preview with scripts and nothing else', () => {
    doc.content = '<!doctype html><p>the show</p>'
    const html = render()
    expect(html.match(/<iframe/g)).toHaveLength(1)
    expect(html).toMatch(/<iframe[^>]* sandbox="allow-scripts"/)
    expect(html).toContain('title="Preview"')
    // The file reaches the frame through the policy-bearing frame document.
    expect(html).toContain('Content-Security-Policy')
    expect(html).toContain('the show')
  })

  it('heads the section "Preview" with when it was written and an "Open full window" control', () => {
    const html = render(Date.now() - 2 * 60 * 60 * 1000)
    expect(html).toContain('>Preview</h2>')
    expect(html).toContain('updated 2h ago')
    expect(html).toContain('aria-label="Open full window"')
  })

  it('omits the written time when the file has none', () => {
    expect(render()).not.toContain('updated')
  })

  it('shows a loading skeleton and no frame before the file is read', () => {
    doc.content = undefined
    const html = render()
    expect(html).not.toContain('<iframe')
    expect(html).toContain('Loading the preview')
    doc.content = '<!doctype html><p>the show</p>'
  })
})
