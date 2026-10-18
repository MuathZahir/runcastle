import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { FeatureFull } from '../src/lib/api'
import { ToastProvider } from '../src/lib/toast'
import { UnrecognizedPhase } from '../src/components/workspace/FeaturePanes'

describe('workspace parts', () => {
  it('renders an unrecognized phase value', () => {
    const feature = {
      id: 'feature-7',
      slug: 'future-feature',
      title: 'Future feature',
      phase: 'future-phase',
    } as unknown as FeatureFull['feature']

    const html = renderToStaticMarkup(
      createElement(ToastProvider, null, createElement(UnrecognizedPhase, { feature })),
    )

    expect(html).toContain('future-phase')
    expect(html).toContain('Unrecognized phase')
  })
})
