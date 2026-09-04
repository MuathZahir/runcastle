import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { FeatureFull } from '../src/lib/api'
import type { Waypoint } from '../src/lib/feature-ui'
import { ToastProvider } from '../src/lib/toast'
import { WAYPOINT_EXPLAINER } from '../src/lib/vocabulary'

vi.mock('../src/trpc', () => ({
  trpc: {
    docs: { read: { useQuery: () => ({ data: { content: '## Destination\nShip it.' }, isLoading: false }) } },
    feature: { workWaypoint: { useMutation: () => ({ isPending: false, mutate: () => undefined }) } },
    useUtils: () => ({ feature: { get: { invalidate: () => undefined }, list: { invalidate: () => undefined } } }),
  },
}))

import { MapRail } from '../src/components/bodies/grill/MapRail'

function wp(over: Partial<Waypoint> & Pick<Waypoint, 'id' | 'seq' | 'title'>): Waypoint {
  return {
    featureId: 'feature-1',
    type: 'grilling',
    question: `Question for ${over.title}`,
    blockedBy: [],
    originWaypointId: null,
    status: 'open',
    claimedBy: null,
    lastSessionId: null,
    summary: null,
    ...over,
  } as Waypoint
}

function full(): FeatureFull {
  return {
    feature: { id: 'feature-1', phase: 'ideation', mapped: true, status: 'active' },
    tickets: [],
    sessions: [],
    runs: [],
    docs: [
      { relPath: 'docs/features/example/map.md', title: 'Map' },
      { relPath: 'docs/features/example/decisions.md', title: 'Decisions' },
    ],
    gate: { next: null, satisfied: false },
    waypoints: [
      wp({ id: 'ready', seq: 1, title: 'Choose storage', lastSessionId: 'session-1' }),
      wp({ id: 'done', seq: 2, title: 'Settle navigation', status: 'resolved', summary: 'Use real URLs.' }),
    ],
    frontierIds: ['ready'],
  } as unknown as FeatureFull
}

function render(readonly = false, collapsed = false): string {
  return renderToStaticMarkup(createElement(ToastProvider, null,
    createElement(MapRail, {
      full: full(),
      relPath: 'docs/features/example/map.md',
      collapsed,
      readonly,
      onToggle: () => undefined,
    }),
  ))
}

describe('MapRail', () => {
  it('renders progress, checklist groups, a closed done group and ready action live', () => {
    const html = render()
    expect(html).toContain('1/2 done')
    expect(html).toContain('width:50%')
    expect(html).toContain(`title="${WAYPOINT_EXPLAINER}"`)
    expect(html).toContain('map.md ▾')
    expect(html.indexOf('Ready · 1')).toBeLessThan(html.indexOf('Done · 1'))
    expect(html).toContain('<details')
    expect(html).not.toContain('<details open=""')
    expect(html).toContain('>Resume<')
    expect(html).not.toContain('Frontier')
  })

  it('renders a frozen record with every card open, summaries visible and no card actions', () => {
    const html = render(true)
    expect(html).not.toContain('<details class="border-t')
    expect(html).toContain('<section><div><span class="font-mono text-[11px] font-semibold uppercase tracking-wide text-text-3">Done · 1')
    expect(html).toContain('Question for Choose storage')
    expect(html).toContain('Use real URLs.')
    expect(html).not.toContain('>Work<')
    expect(html).not.toContain('>Resume<')
    expect(html).not.toContain('End &amp; work this')
  })

  it('shows only done/total and the vertical map label when collapsed', () => {
    const html = render(false, true)
    expect(html).toContain('1/2')
    expect(html).toContain('>map<')
    expect(html).not.toContain('Frontier')
  })
})
