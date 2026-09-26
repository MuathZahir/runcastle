import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PHASE_ORDER } from '../src/lib/feature-ui'
import { FeatureSkeleton } from '../src/components/workspace/FeatureSkeleton'

/**
 * The feature page's loading state is the page's own shape in placeholder
 * bars — title, branch line, the stepper, the summary rows — not a spinner and
 * a word, and it keeps the shared loading state's 300ms wait so a fast load
 * shows nothing at all.
 */
describe('FeatureSkeleton', () => {
  const html = renderToStaticMarkup(createElement(FeatureSkeleton))
  const count = (marker: string) => html.split(`data-skeleton="${marker}"`).length - 1

  it('is announced as loading the feature, with the placeholders hidden', () => {
    expect(html).toContain('role="status"')
    expect(html).toContain('Loading feature…')
    expect(html).toContain('aria-hidden="true"')
  })

  it('is shaped like the feature page: title, branch, one step per phase, five summary rows', () => {
    expect(count('title')).toBe(1)
    expect(count('branch')).toBe(1)
    expect(count('step')).toBe(PHASE_ORDER.length)
    // Review · Checks · Test drive · Tickets · Laps
    expect(count('row')).toBe(5)
  })

  it('waits 300ms before fading in, like the shared loading state', () => {
    expect(html).toContain('animate-fade-in [animation-delay:300ms]')
    expect(html).not.toContain('animate-spin')
  })

  it('keeps every breathing bar pulsing under reduced motion', () => {
    // The feature page's only progress indicator now: each `animate-breathe`
    // element must be marked `data-progress`, or the reduced-motion clamp
    // freezes it into a still frame.
    const breathing = html.match(/<[^>]*animate-breathe[^>]*>/g) ?? []
    expect(breathing.length).toBe(2)
    for (const tag of breathing) expect(tag).toContain('data-progress')
  })
})
