import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ImageBuildAction } from '../src/components/EnableAfkCard'

const probe = (status: 'missing' | 'stale' | 'ok', fix?: string) => ({
  id: 'sandcastle-image',
  label: 'Sandcastle image',
  status,
  detail: `${status} image detail`,
  ...(fix ? { fix } : {}),
})

describe('EnableAfkCard image action', () => {
  const render = (status: 'missing' | 'stale' | 'ok', fix?: string) =>
    renderToStaticMarkup(
      createElement(ImageBuildAction, {
        probe: probe(status, fix),
        runtimeOk: true,
        pending: false,
        onStart: () => undefined,
      }),
    )

  it('offers a primary Build image action when the image is missing', () => {
    const html = render('missing')
    expect(html).toContain('btn-solid')
    expect(html).toContain('Build image')
  })

  it('shows the doctor fix and a primary Rebuild image action when stale', () => {
    const html = render('stale', 'Rebuild the bundled image')
    expect(html).toContain('Rebuild the bundled image')
    expect(html).toContain('btn-solid')
    expect(html).toContain('Rebuild image')
  })

  it('offers a secondary Rebuild image action when the image is ok', () => {
    const html = render('ok')
    expect(html).toContain('btn-ghost')
    expect(html).toContain('Rebuild image')
  })
})
