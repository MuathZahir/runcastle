// @vitest-environment happy-dom
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { EventRow } from '@runcastle/core'
import type { FeatureFull } from '../src/lib/api'
import { ToastProvider } from '../src/lib/toast'

const DOCS: Record<string, string> = {
  'decisions.md': '# Decisions\n\n## 1. Ship it\nBecause.\n\n## 2. Then stop\nBecause.\n',
  'spec.md': '# Spec\n\n## Problem\nThe pinned view was the live view.\n',
  'map.md': '## Destination\nA frozen record.\n',
}

vi.mock('../src/trpc', () => ({
  trpc: {
    docs: {
      read: {
        useQuery: ({ relPath }: { relPath: string }) => ({
          data: DOCS[relPath] === undefined ? undefined : { content: DOCS[relPath] },
          isLoading: false,
        }),
      },
    },
    settings: { get: { useQuery: () => ({ data: undefined }) } },
    feature: { workWaypoint: { useMutation: () => ({ isPending: false, mutate: () => undefined }) } },
    useUtils: () => ({ feature: { get: { invalidate: () => undefined }, list: { invalidate: () => undefined } } }),
  },
}))

const { PinnedBody } = await import('../src/components/bodies/PinnedBody')
const { ReadonlyBanner } = await import('../src/components/workspace/ReadonlyBanner')

const START = 1_760_000_000_000
const HOUR = 3_600_000

function full(over: Partial<FeatureFull> = {}): FeatureFull {
  return {
    feature: { id: 'feature-1', projectId: 'project-1', phase: 'shipped', mapped: false, lap: 1, createdAt: START },
    tickets: [],
    sessions: [],
    runs: [],
    docs: [
      { relPath: 'decisions.md', title: 'Decisions' },
      { relPath: 'spec.md', title: 'Spec' },
    ],
    gate: { next: null, satisfied: true },
    waypoints: [],
    frontierIds: [],
    ...over,
  } as unknown as FeatureFull
}

const events: EventRow[] = [
  { id: 1, ts: START + HOUR, type: 'session.ended', message: '', projectId: 'project-1', data: { sessionId: 'session-1' } },
  { id: 2, ts: START + 2 * HOUR, type: 'phase.advanced', message: '', projectId: 'project-1', data: { from: 'ideation', to: 'spec' } },
] as EventRow[]

function pinned(effective: 'ideation' | 'spec' | 'tickets', over: Partial<FeatureFull> = {}): HTMLElement {
  const { container } = render(
    <ToastProvider>
      <PinnedBody
        full={full(over)}
        effective={effective}
        events={events}
        mapRailCollapsed={false}
        onToggleMapRail={() => undefined}
      />
    </ToastProvider>,
  )
  return container
}

/** Every door this flow removed from a pinned view (decision 10). */
const LIVE_AFFORDANCES = [
  'End session',
  'Send briefing',
  'Show terminal',
  'Hide terminal',
  'Resume session',
  'Work next',
  'Edit ticket',
  'Cancel ticket',
  'Model for all pending',
  'default model',
]

function expectFrozen(container: HTMLElement): void {
  for (const label of LIVE_AFFORDANCES) expect(container.textContent).not.toContain(label)
  expect(container.querySelector('[data-testid="terminal"]')).toBeNull()
}

afterEach(cleanup)

describe('ReadonlyBanner', () => {
  it('names the phase, states what it produced and offers the one way back', () => {
    const html = renderToStaticMarkup(
      createElement(ReadonlyBanner, {
        phase: 'ideation',
        livePhase: 'shipped',
        facts: '2d · 3 sessions · 12 decisions',
        onBack: () => undefined,
      }),
    )

    expect(html).toContain('READ-ONLY')
    expect(html).toContain('ideation')
    expect(html).toContain('2d · 3 sessions · 12 decisions')
    expect(html).toContain('Back to shipped →')
    expect(html).not.toContain('readonly-')
  })

  it('says only the phase when nothing about it could be derived', () => {
    const html = renderToStaticMarkup(
      createElement(ReadonlyBanner, {
        phase: 'spec',
        livePhase: 'review',
        facts: null,
        onBack: () => undefined,
      }),
    )

    expect(html).toContain('READ-ONLY')
    expect(html).toContain('Back to review →')
  })
})

describe('PinnedBody', () => {
  it('renders decisions.md inline with the sessions that ran, and nothing to click', () => {
    const container = pinned('ideation', {
      sessions: [
        { id: 'session-1', kind: 'ideation', lap: 1, status: 'ended', createdAt: START },
        { id: 'session-2', kind: 'qa', lap: 1, status: 'ended', createdAt: START + HOUR },
      ] as FeatureFull['sessions'],
    })

    expect(container.textContent).toContain('Decisions')
    expect(container.textContent).toContain('decisions.md · 2')
    expect(container.textContent).toContain('1. Ship it')
    expect(container.textContent).toContain('Sessions · 1')
    expect(container.textContent).toContain('Ideation session')
    // A question session is not part of how the idea was shaped.
    expect(container.textContent).not.toContain('Question session')
    expectFrozen(container)
  })

  it('opens the map beside the decisions when the feature was mapped', () => {
    const container = pinned('ideation', {
      feature: { id: 'feature-1', projectId: 'project-1', phase: 'shipped', mapped: true, lap: 1, createdAt: START } as FeatureFull['feature'],
      docs: [
        { relPath: 'decisions.md', title: 'Decisions' },
        { relPath: 'map.md', title: 'Map' },
      ] as FeatureFull['docs'],
      waypoints: [
        { id: 'w1', featureId: 'feature-1', seq: 1, title: 'Chart it', type: 'task', question: 'How?', blockedBy: [], status: 'resolved', summary: 'Charted.' },
      ] as unknown as FeatureFull['waypoints'],
    })

    expect(container.textContent).toContain('Map')
    expect(container.textContent).toContain('Chart it')
    expect(container.textContent).toContain('Charted.')
    // The done group is open in a retrospective (decision 5) — the map document
    // is the only thing still behind a disclosure here.
    expect([...container.querySelectorAll('summary')].map((s) => s.textContent)).toEqual([
      'Map document',
    ])
    expectFrozen(container)
    expect(container.textContent).not.toContain('Work')
  })

  it('renders spec.md in full', () => {
    const container = pinned('spec')

    expect(container.textContent).toContain('Spec')
    expect(container.textContent).toContain('The pinned view was the live view.')
    expectFrozen(container)
  })

  it('says what happened when the phase produced no document', () => {
    const ideation = pinned('ideation', { docs: [] as FeatureFull['docs'] })
    expect(ideation.textContent).toContain('No decisions were recorded')
    expect(ideation.textContent).toContain('skipped ideation')
    expect(ideation.textContent).not.toContain('Start')

    cleanup()
    const spec = pinned('spec', { docs: [] as FeatureFull['docs'] })
    expect(spec.textContent).toContain('No spec')
    expect(spec.textContent).not.toContain('Start')
  })

  it('renders the ledger as a record, with lap headers and no header menus', () => {
    const container = pinned('tickets', {
      feature: { id: 'feature-1', projectId: 'project-1', phase: 'shipped', mapped: false, lap: 2, createdAt: START } as FeatureFull['feature'],
      tickets: [
        { id: 't1', seq: 1, lap: 1, title: 'First', status: 'done', kind: 'implementation', blockedBy: [], commits: [], acceptanceCriteria: [], seams: [], goal: '' },
        { id: 't2', seq: 2, lap: 2, title: 'Second', status: 'pending', kind: 'implementation', blockedBy: [], commits: [], acceptanceCriteria: [], seams: [], goal: '' },
      ] as unknown as FeatureFull['tickets'],
    })

    expect(container.textContent).toContain('Lap 1')
    expect(container.textContent).toContain('First')
    expect(container.textContent).toContain('Second')
    expect(container.textContent).not.toContain('sandbox ·')
    expect(container.textContent).not.toContain('docs ▾')
    expectFrozen(container)
  })

  it('says the lap is empty rather than pointing at a session', () => {
    const container = pinned('tickets')
    expect(container.textContent).toContain('No tickets in this lap.')
    expect(container.textContent).not.toContain('The session breaks the spec')
  })
})
