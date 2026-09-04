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

    expect(html.match(/class="pstep /g)).toHaveLength(PHASE_ORDER.length)
    expect(html).toContain('class="pstep is-current is-viewed is-clickable"')
    for (const phase of PHASE_ORDER) expect(html).toContain(PHASE_LABELS[phase])
    // Each step carries its own tip — what it teaches depends on its state.
    for (const phase of PHASE_ORDER) expect(html).toContain(`title="${phase}"`)
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
