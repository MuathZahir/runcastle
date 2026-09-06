import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { FeatureFull } from '../src/lib/api'
import { PHASE_LABELS, PHASE_ORDER, type PipelineStep } from '../src/lib/feature-ui'
import { ToastProvider } from '../src/lib/toast'
import { FeatureHeader } from '../src/components/workspace/FeatureHeader'
import { full } from './fixtures'

/**
 * The feature header has to fit the column it is handed, whatever it is asked to
 * name. The app frame is `overflow: hidden`, so a header row that sizes itself
 * to a long title plus a long branch name does not scroll — it renders the chip
 * past the right edge of the window, where nothing can reach it.
 *
 * Nothing here lays anything out (this is a string, and even a DOM would give
 * every box 0×0), so what is asserted is the contract that produces the layout:
 * the title claims the leftover room and ellipsizes into it, and every other
 * part of the row either keeps its own width or ellipsizes too.
 */
const LONG_TITLE =
  'Flow redesign styling regressions across every workspace surface the rebuild touched'
const LONG_BRANCH = 'feature/flow-redesign-styling-regressions-and-the-header-that-clipped'

function feature(over: Partial<FeatureFull['feature']> = {}): FeatureFull['feature'] {
  return { ...full().feature, lap: 1, ...over } as FeatureFull['feature']
}

const STEPS: PipelineStep[] = PHASE_ORDER.map((phase) => ({
  phase,
  label: PHASE_LABELS[phase],
  state: phase === 'tickets' ? 'current' : 'upcoming',
  isViewed: phase === 'tickets',
  clickable: false,
  tip: phase,
}))

function header(over: Partial<FeatureFull['feature']> = {}, isDraft = false): string {
  return renderToStaticMarkup(
    createElement(
      ToastProvider,
      null,
      createElement(FeatureHeader, {
        feature: feature({ title: LONG_TITLE, branch: LONG_BRANCH, ...over }),
        isDraft,
        steps: STEPS,
        onViewPhase: () => undefined,
      }),
    ),
  )
}

/** The class list of the one element whose markup contains `marker`. */
function classesAround(html: string, marker: string): string[] {
  const upTo = html.slice(0, html.indexOf(marker))
  const open = upTo.lastIndexOf('<')
  const match = /class="([^"]*)"/.exec(upTo.slice(open))
  return match?.[1]?.split(' ') ?? []
}

describe('the feature header', () => {
  it('gives the title the leftover room and ellipsizes it there', () => {
    const html = header()

    const title = classesAround(html, LONG_TITLE)
    expect(title).toContain('flex-1')
    expect(title).toContain('truncate')
    // The spacer that used to push the branch chip right is gone: a title that
    // claims the middle does that itself, and the spacer only ever competed
    // with it for the room.
    expect(html).not.toContain('ws-title-spacer')
    // Truncated, but never lost — the whole title is still one hover away.
    expect(html).toContain(`title="${LONG_TITLE}"`)
  })

  it('lets the branch chip ellipsize rather than leave the window', () => {
    const html = header()

    expect(classesAround(html, LONG_BRANCH)).toContain('truncate')
    expect(classesAround(html, 'Copy branch name')).toContain('min-w-0')
  })

  it('keeps the phase tag whole while the row shrinks around it', () => {
    expect(classesAround(header({}, true), 'draft')).toContain('shrink-0')
  })

  it('states the pipeline for a started feature and not for a draft', () => {
    // The step's own tip, which only the stepper renders — the label alone
    // could as easily have come from the title beside it.
    expect(header()).toContain('title="implementation"')
    // A draft is created at `ideation`, so a stepper here would claim work has
    // begun on a feature that has no branch yet.
    expect(header({}, true)).not.toContain('title="implementation"')
  })
})
