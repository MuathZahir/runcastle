import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { FeatureFull } from '../src/lib/api'
import { PHASE_LABELS, PHASE_ORDER, type PipelineStep } from '../src/lib/feature-ui'
import { PHASE_NAME } from '../src/icons'
import { ToastProvider } from '../src/lib/toast'
import { UnrecognizedPhase } from '../src/components/workspace/FeaturePanes'
import { PipelineStepper } from '../src/components/workspace/PipelineStepper'

describe('workspace parts', () => {
  it('renders every pipeline phase and marks the current step', () => {
    const current = 'planning'
    const steps: PipelineStep[] = PHASE_ORDER.map((phase) => ({
      phase,
      label: PHASE_LABELS[phase],
      state: phase === current ? 'current' : 'upcoming',
      isViewed: phase === current,
      clickable: phase === current,
      tip: phase,
    }))

    const html = renderToStaticMarkup(
      createElement(PipelineStepper, { steps, onView: () => undefined }),
    )

    expect(html.match(/<button/g)).toHaveLength(PHASE_ORDER.length)
    // The current step is the only one marked current and clickable; every
    // future step is disabled and wears the dashed ring. Nothing is pinned, so
    // no step takes the selected fill.
    expect(html.match(/disabled=""/g)).toHaveLength(PHASE_ORDER.length - 1)
    expect(html.match(/aria-current="step"/g)).toHaveLength(1)
    expect(html.match(/data-phase="draft"/g)).toHaveLength(PHASE_ORDER.length - 1)
    expect(html).not.toContain('bg-surface-selected')
    for (const phase of PHASE_ORDER) expect(html).toContain(`>${PHASE_NAME[phase]}<`)
    // Each step carries its own tip — what it teaches depends on its state.
    for (const phase of PHASE_ORDER) expect(html).toContain(`title="${phase}"`)
    // The steps are wider than a narrow page column and none of them can
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
    expect(html).toContain('Unrecognized phase')
  })

  it('marks the pinned past step with the selected fill, and only that one', () => {
    const steps: PipelineStep[] = PHASE_ORDER.map((phase, i) => ({
      phase,
      label: PHASE_LABELS[phase],
      state: i < 2 ? 'done' : i === 2 ? 'current' : 'upcoming',
      isViewed: i === 0,
      clickable: i <= 2,
      tip: phase,
    }))
    const html = renderToStaticMarkup(
      createElement(PipelineStepper, { steps, readonly: true, onView: () => undefined }),
    )
    expect(html.match(/bg-surface-selected/g)).toHaveLength(1)
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1)
    // Done steps wear the check.
    expect(html.match(/data-phase="shipped"/g)).toHaveLength(2)
  })
})
