import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Skeleton, SkeletonBar } from '../src/ui'

/**
 * The content-area loading state: placeholder bars in the content's shape,
 * announced by a label, waiting 300ms so a fast load shows nothing, and
 * breathing — never a spinner and a word.
 */
describe('Skeleton', () => {
  const bars = createElement(SkeletonBar, { className: 'h-3 w-20' })
  const labelled = renderToStaticMarkup(
    createElement(Skeleton, { label: 'Loading things…', className: 'mt-9', children: bars }),
  )
  const decorative = renderToStaticMarkup(createElement(Skeleton, { children: bars }))

  it('is announced by its label, with the bars hidden from a screen reader', () => {
    expect(labelled).toContain('role="status"')
    expect(labelled).toContain('<span class="sr-only">Loading things…</span>')
    expect(labelled).toContain('aria-hidden="true"')
  })

  it('without a label is decorative: no status, nothing to read out', () => {
    expect(decorative).not.toContain('role="status"')
    expect(decorative).toContain('aria-hidden="true"')
  })

  it('waits 300ms before fading in, and the caller places it', () => {
    expect(labelled).toContain('animate-fade-in [animation-delay:300ms] mt-9')
    expect(labelled).not.toContain('animate-spin')
  })

  it('keeps its breathing under reduced motion', () => {
    const breathing = labelled.match(/<[^>]*animate-breathe[^>]*>/g) ?? []
    expect(breathing.length).toBe(1)
    expect(breathing[0]).toContain('data-progress')
  })

  it('draws a bar at the size the caller gives it', () => {
    expect(labelled).toContain('bg-surface-selected h-3 w-20')
  })
})
