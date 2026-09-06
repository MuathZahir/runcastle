import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { FeatureFull } from '../src/lib/api'
import { PHASE_LABELS, PHASE_ORDER, type PipelineStep } from '../src/lib/feature-ui'
import { ToastProvider } from '../src/lib/toast'
import { UnrecognizedPhase } from '../src/components/workspace/FeaturePanes'
import { PipelineStepper } from '../src/components/workspace/PipelineStepper'

describe('workspace parts', () => {
  it('renders every pipeline phase and marks the current step', () => {
    const current = 'tickets'
    const steps: PipelineStep[] = PHASE_ORDER.map((phase) => ({
      phase,
      label: PHASE_LABELS[phase],
      state: phase === current ? 'current' : 'upcoming',
      isViewed: phase === current,
      clickable: phase === current,
      tip: phase,
    }))

    const html = renderToStaticMarkup(
      createElement(PipelineStepper, { steps, lap: 1, onView: () => undefined }),
    )

    expect(html.match(/<button/g)).toHaveLength(PHASE_ORDER.length)
    // The current step is the only one that is lit, framed as the viewed step
    // and clickable at once; every other step is disabled and unframed.
    expect(html.match(/disabled=""/g)).toHaveLength(PHASE_ORDER.length - 1)
    expect(html.match(/border-accent-line/g)).toHaveLength(1)
    for (const phase of PHASE_ORDER) expect(html).toContain(PHASE_LABELS[phase])
    // Each step carries its own tip — what it teaches depends on its state.
    for (const phase of PHASE_ORDER) expect(html).toContain(`title="${phase}"`)
    // Six pills are wider than a narrow workspace column and none of them can
    // shrink below the phase it names, so the row wraps instead of running off
    // the right edge of the header.
    expect(html).toContain('flex-wrap')
    expect(html.match(/shrink-0/g)?.length).toBeGreaterThanOrEqual(PHASE_ORDER.length)
  })

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
    expect(html).toContain('UNRECOGNIZED')
  })
})
