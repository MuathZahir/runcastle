import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { EventRow } from '@runcastle/core'
import { ActivityRow, LapDivider } from '../src/components/inspector/Activity'

/**
 * The Inspector's activity pane as it renders (decision 9). Tier-1 static markup
 * (apps/web/STYLE.md): it is pure once the rail's queries have answered, which
 * is exactly what `ActivityRow` takes.
 *
 * What is pinned here is what the feed *states*: activity rows that read as
 * sentences rather than event slugs.
 */
const ev = (over: Partial<EventRow>): EventRow =>
  ({ id: 1, projectId: 'p', ts: Date.now(), type: 'docs.scaffolded', message: '', ...over }) as EventRow

describe('activity row', () => {
  it('reads as a sentence, with the slug demoted to the dim subline', () => {
    const html = renderToStaticMarkup(
      createElement(ActivityRow, {
        event: ev({
          type: 'feature.created',
          message: 'feature.created (feature/x ← main)',
          data: { branch: 'feature/x', baseBranch: 'main', branchReady: true },
        }),
      }),
    )
    expect(html).toContain('Feature created on branch feature/x, from main')
    expect(html).not.toContain('feature.created')
    expect(html).toContain('feature · created')
  })

  it('offers the whole event behind an expander only when there is more to see', () => {
    const short = renderToStaticMarkup(
      createElement(ActivityRow, { event: ev({ message: 'scaffolded brief.md' }) }),
    )
    expect(short).not.toContain('aria-expanded')

    const long = renderToStaticMarkup(
      createElement(ActivityRow, { event: ev({ message: `${'x'.repeat(400)}` }) }),
    )
    expect(long).toContain('aria-expanded="false"')
  })

  it('paints a failed run red however its type reads', () => {
    const html = renderToStaticMarkup(
      createElement(ActivityRow, {
        event: ev({ type: 'run.finished', message: 'run failed: 2 tickets', data: { status: 'failed' } }),
      }),
    )
    expect(html).toContain('bg-danger')
  })

  it('draws a lap boundary across the feed rather than listing it', () => {
    const html = renderToStaticMarkup(
      createElement(LapDivider, { event: ev({ type: 'lap.started', message: 'burning tickets — lap 2' }) }),
    )
    expect(html).toContain('role="separator"')
    expect(html).toContain('burning tickets — lap 2')
  })
})
