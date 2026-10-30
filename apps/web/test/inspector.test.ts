// @vitest-environment happy-dom
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DependencyRef, EventRow } from '@runcastle/core'
import type { DocSummary, FeatureFull } from '../src/lib/api'
import { ActivityRow, LapDivider } from '../src/components/inspector/Activity'
import { FeatureFacts } from '../src/components/inspector/FeatureFacts'
import { DetailsView } from '../src/components/inspector/Inspector'
import { Knowledge } from '../src/components/inspector/Knowledge'

const store = vi.hoisted(() => ({ docs: [] as unknown[] }))

/** The details' one read, answering with `store.docs`; the feed is the true boundary's too. */
vi.mock('../src/trpc', () => ({
  trpc: { feature: { get: { useQuery: () => ({ data: { docs: store.docs }, isLoading: false, error: null }) } } },
}))
vi.mock('../src/lib/events', () => ({ useEventLog: () => [] }))
vi.mock('../src/lib/live', () => ({ useLivePoll: () => false }))
vi.mock('../src/lib/toast', () => ({ useToast: () => ({ push: () => undefined }) }))

afterEach(cleanup)

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

const doc = (relPath: string, title: string): DocSummary => ({ relPath, title }) as DocSummary
/** Each doc row's title, top to bottom. */
const rowTitles = (root: ParentNode) => [...root.querySelectorAll('[data-list-row]')].map((row) => row.textContent ?? '')

/** the-feature-s-right-panel decisions 8, 9: Details is one column — facts, docs, then Activity. */
describe('the details', () => {
  it('lists the docs by title, the outcome and the plan’s documents first, the rest after', () => {
    const docs = [doc('notes.md', 'Notes'), doc('spec.md', 'Spec'), doc('brief.md', 'Brief'), doc('outcome.md', 'Outcome'), doc('decisions.md', 'Decisions')]
    render(createElement(Knowledge, { docs, onOpen: () => undefined }))
    expect(rowTitles(document)).toEqual(['Outcome', 'Brief', 'Decisions', 'Spec', 'Notes'])
  })

  it('states the branch, when it started and the features on either side of it', () => {
    const dep = { featureId: 'f0', slug: 'base', title: 'The base', status: 'active', satisfied: false, upNext: false } as DependencyRef
    render(
      createElement(FeatureFacts, {
        feature: { branch: 'feature/demo' } as FeatureFull['feature'],
        when: { label: 'Started', value: '1d ago' },
        dependsOn: [dep],
        blocks: [{ featureId: 'f2', slug: 'next', title: 'The next', upNext: true }],
      }),
    )
    const facts = [...document.querySelectorAll('dt')].map((dt) => [dt.textContent, dt.nextElementSibling?.textContent])
    expect(facts).toEqual([
      ['Branch', 'feature/demo'],
      ['Started', '1d ago'],
      ['Waits on', 'The basein progress'],
      ['Waited on by', 'The nextstarts when this ships'],
    ])
    expect(screen.getByRole('button', { name: 'feature/demo' }).getAttribute('title')).toBe('Copy branch name')
  })

  it('opens a doc by its relPath for the panel to read, the facts above and Activity closed below', () => {
    store.docs = [doc('spec.md', 'Spec')]
    const opened: string[] = []
    render(createElement(DetailsView, { featureId: 'f1', facts: 'the facts', onOpenDoc: (relPath: string) => opened.push(relPath) }))
    fireEvent.click(within(screen.getByLabelText('Feature docs')).getByText('Spec'))
    expect(opened).toEqual(['spec.md'])
    expect(document.body.textContent?.indexOf('the facts')).toBeLessThan(document.body.textContent?.indexOf('Spec') ?? -1)
    const activity = screen.getByText('Activity').closest('details')
    expect(activity?.open).toBe(false)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
