import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { FeatureFull } from '../src/lib/api'
import { PHASE_LABELS, PHASE_ORDER, type NextStep, type PipelineStep } from '../src/lib/feature-ui'
import { ToastProvider } from '../src/lib/toast'
import { FeatureHeader } from '../src/components/workspace/FeatureHeader'
import { NextStepBar } from '../src/components/workspace/NextStepBar'
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
  state: phase === 'planning' ? 'current' : 'upcoming',
  isViewed: phase === 'planning',
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
        facts: isDraft ? [{ phase: 'draft', text: 'Parked 2d ago' }] : [{ text: 'Started 2d ago' }],
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
  it('states the title once, as the page heading, and lets it wrap', () => {
    const html = header()
    expect(html).toContain(`<h1 class="m-0 min-w-0 flex-1 text-xl font-semibold text-pretty text-text">${LONG_TITLE}</h1>`)
    // The retired header chrome is gone with its legacy rules.
    expect(html).not.toContain('ws-head')
    expect(html).not.toContain('ws-title')
  })

  it('lets the branch ellipsize rather than leave the window, and copies it on click', () => {
    const html = header()

    expect(classesAround(html, LONG_BRANCH)).toContain('truncate')
    expect(classesAround(html, 'Copy branch name')).toContain('min-w-0')
    expect(classesAround(html, 'Copy branch name')).toContain('font-mono')
  })

  it('says a draft is a draft in the meta line, with no branch to copy', () => {
    const html = header({}, true)
    expect(html).toContain('data-phase="draft"')
    expect(html).not.toContain('Copy branch name')
  })

  it('pulls the stepper back by one step’s padding so it starts on the title’s edge', () => {
    const stepper = /<nav aria-label="Pipeline" class="([^"]*)"/.exec(header())?.[1]?.split(' ') ?? []
    expect(stepper).toContain('-ml-2')
  })

  it('states the pipeline for a started feature and not for a draft', () => {
    // The step's own tip, which only the stepper renders — the label alone
    // could as easily have come from the title beside it.
    expect(header()).toContain('title="building"')
    // A draft is created at `ideation`, so a stepper here would claim work has
    // begun on a feature that has no branch yet.
    expect(header({}, true)).not.toContain('title="building"')
  })
})

describe('the next-step bar under it', () => {
  const ns: NextStep = {
    kick: 'NEXT STEP',
    title: 'Start this feature',
    desc: 'Parked as a draft — Start cuts its branch, writes the brief.',
    primary: { label: 'Start', kind: 'startDraft' },
    secondary: [{ label: 'Chat', kind: 'chat' }],
    busy: false,
  }

  const bar = (): string =>
    renderToStaticMarkup(
      createElement(NextStepBar, {
        ns,
        guidance: true,
        busy: false,
        onAction: () => undefined,
        draftBranch: {
          branches: [LONG_BRANCH, 'main'],
          value: LONG_BRANCH,
          missing: false,
          onPick: () => undefined,
        },
      }),
    )

  it('lets the actions wrap inside the row rather than leave it', () => {
    // The buttons keep their own widths (decision 30e); the group around them
    // is what yields, so a crowded row wraps onto a second line instead of
    // running the primary action off the right edge of the page.
    const actions = /<div class="([^"]*)"><button/.exec(bar())?.[1]?.split(' ') ?? []
    expect(actions).toContain('min-w-0')
    expect(actions).toContain('flex-wrap')
  })

  it('ellipsizes a long branch in the picker instead of widening the row', () => {
    expect(classesAround(bar(), `from ${LONG_BRANCH}`)).toContain('truncate')
  })
})
