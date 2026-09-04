import { describe, expect, it, vi } from 'vitest'
import type { EventRow } from '@runcastle/core'
import type { FeatureFull } from '../src/lib/api'
import { phaseFacts, phaseSessions, phaseSummary, phaseWindow } from '../src/lib/feature-ui'

const DAY = 86_400_000
const START = 1_760_000_000_000

type Input = Parameters<typeof phaseSummary>[0]['full']

function full(over: Partial<FeatureFull> = {}): Input {
  return {
    feature: { id: 'feature-1', phase: 'shipped', mapped: false, lap: 1, createdAt: START },
    sessions: [],
    tickets: [],
    waypoints: [],
    ...over,
  } as unknown as Input
}

function event(over: Partial<EventRow> & Pick<EventRow, 'ts' | 'type'>): EventRow {
  return { id: over.ts, projectId: 'project-1', message: '', ...over } as EventRow
}

/** The transitions `setPhase` writes — `{ from, to }` under whatever type. */
function advanced(ts: number, from: string, to: string, type = 'phase.advanced'): EventRow {
  return event({ ts, type, data: { from, to } })
}

function session(over: Partial<FeatureFull['sessions'][number]> & { id: string }) {
  return {
    kind: 'ideation',
    lap: 1,
    status: 'ended',
    createdAt: START,
    ...over,
  } as FeatureFull['sessions'][number]
}

function ticket(over: { lap?: number; status?: string } = {}) {
  return { lap: 1, status: 'done', ...over } as FeatureFull['tickets'][number]
}

describe('phaseSummary', () => {
  it('reports ideation as a duration, a session count and a decision count', () => {
    const events = [advanced(START + 2 * DAY, 'ideation', 'spec')]
    const summary = phaseSummary({
      phase: 'ideation',
      full: full({
        sessions: [
          session({ id: 'session-1' }),
          session({ id: 'session-2', kind: 'converge', createdAt: START + DAY }),
          // Outside the window: the lap-2 session ran long after the first
          // transition into spec.
          session({ id: 'session-3', createdAt: START + 9 * DAY }),
          // Never an ideation session, even inside the window.
          session({ id: 'session-4', kind: 'qa', createdAt: START + DAY }),
        ] as FeatureFull['sessions'],
      }),
      events,
      decisions: '# Decisions\n\n## One\n\n## Two\n\n## Three\n',
    })

    expect(summary).toBe('Ideation · 2d · 2 sessions · 3 decisions')
  })

  it('adds the waypoint count for a mapped feature', () => {
    const summary = phaseSummary({
      phase: 'ideation',
      full: full({
        feature: { mapped: true, lap: 1, createdAt: START } as FeatureFull['feature'],
        waypoints: [{ id: 'a' }, { id: 'b' }] as FeatureFull['waypoints'],
      }),
      events: [advanced(START + DAY, 'ideation', 'spec')],
      decisions: '## Only one\n',
    })

    expect(summary).toBe('Ideation · 1d · 0 sessions · 1 decision · 2 waypoints')
  })

  it('omits the duration when the feed cannot date the phase, and the count when no doc was read', () => {
    expect(phaseSummary({ phase: 'ideation', full: full(), events: [] })).toBe(
      'Ideation · 0 sessions',
    )
  })

  it('dates the spec from the docs watcher, and says only "Spec" without one', () => {
    const events = [
      event({ ts: START, type: 'docs.changed', data: { files: ['decisions.md'] } }),
      event({ ts: START + DAY, type: 'docs.changed', data: { files: ['brief.md', 'spec.md'] } }),
    ]
    vi.useFakeTimers()
    vi.setSystemTime(START + 3 * DAY)
    try {
      expect(phaseSummary({ phase: 'spec', full: full(), events })).toBe('Spec · written 2d ago')
      expect(phaseSummary({ phase: 'spec', full: full(), events: [] })).toBe('Spec')
    } finally {
      vi.useRealTimers()
    }
  })

  it('counts tickets for the lap, and every lap from lap 2', () => {
    const lapOne = full({
      tickets: [ticket(), ticket(), ticket({ status: 'failed' })] as FeatureFull['tickets'],
    })
    expect(phaseSummary({ phase: 'tickets', full: lapOne, events: [] })).toBe(
      'Tickets · 3 emitted, 2 done',
    )

    const lapTwo = full({
      feature: { mapped: false, lap: 2, createdAt: START } as FeatureFull['feature'],
      tickets: [
        ticket(),
        ticket(),
        ticket({ lap: 2 }),
        ticket({ lap: 2, status: 'pending' }),
      ] as FeatureFull['tickets'],
    })
    expect(phaseSummary({ phase: 'tickets', full: lapTwo, events: [] })).toBe(
      'Tickets · lap 1 · 2 emitted, 2 done · lap 2 · 2 emitted, 1 done',
    )
  })

  it('has nothing to say about the phases this flow does not own', () => {
    for (const phase of ['implementation', 'review', 'shipped'] as const) {
      expect(phaseSummary({ phase, full: full(), events: [] })).toBeNull()
      expect(phaseFacts({ phase, full: full(), events: [] })).toBeNull()
    }
  })

  it('leaves the phase title to the banner and returns the facts alone', () => {
    expect(phaseFacts({ phase: 'tickets', full: full(), events: [] })).toBe('0 emitted, 0 done')
    expect(phaseFacts({ phase: 'spec', full: full(), events: [] })).toBeNull()
  })
})

describe('phaseWindow', () => {
  it('runs ideation from the start event and closes each phase on its transition', () => {
    const events = [
      event({ ts: START + DAY, type: 'feature.started' }),
      advanced(START + 2 * DAY, 'ideation', 'spec'),
      advanced(START + 3 * DAY, 'spec', 'tickets'),
      // The burn crosses into implementation under its own event type.
      advanced(START + 4 * DAY, 'tickets', 'implementation', 'burn.started'),
    ]
    expect(phaseWindow('ideation', full(), events)).toEqual({
      from: START + DAY,
      to: START + 2 * DAY,
    })
    expect(phaseWindow('spec', full(), events)).toEqual({
      from: START + 2 * DAY,
      to: START + 3 * DAY,
    })
    expect(phaseWindow('tickets', full(), events)).toEqual({
      from: START + 3 * DAY,
      to: START + 4 * DAY,
    })
  })

  it('falls back to the feature row when no start event is in the feed', () => {
    expect(phaseWindow('ideation', full(), [])).toEqual({ from: START, to: undefined })
  })
})

describe('phaseSessions', () => {
  it('names each ideation session, times it and says what it settled', () => {
    const events = [
      event({ ts: START + 1800_000, type: 'feature.escalated' }),
      event({ ts: START + 3600_000, type: 'session.ended', data: { sessionId: 'session-1' } }),
      event({ ts: START + 2 * DAY, type: 'session.ended', data: { sessionId: 'session-3' } }),
      advanced(START + 3 * DAY, 'ideation', 'spec'),
    ]

    expect(
      phaseSessions({
        full: full({
          feature: { mapped: true, lap: 1, createdAt: START } as FeatureFull['feature'],
          sessions: [
            session({ id: 'session-3', kind: 'converge', createdAt: START + DAY }),
            session({ id: 'session-1' }),
            session({ id: 'session-2', kind: 'waypoint', createdAt: START + 3600_000 }),
          ] as FeatureFull['sessions'],
          tickets: [ticket(), ticket()] as FeatureFull['tickets'],
          waypoints: [
            { id: 'w1', lastSessionId: 'session-2', status: 'resolved' },
            { id: 'w2', lastSessionId: 'session-2', status: 'open' },
          ] as FeatureFull['waypoints'],
        }),
        events,
      }),
    ).toEqual([
      {
        id: 'session-1',
        name: 'Ideation session',
        startedAt: START,
        duration: '1h 00m',
        fact: 'escalated to a map',
      },
      { id: 'session-2', name: 'Waypoint session', startedAt: START + 3600_000, fact: 'resolved 1' },
      {
        id: 'session-3',
        name: 'Converge session',
        startedAt: START + DAY,
        duration: '24h 00m',
        fact: 'wrote spec, 2 tickets',
      },
    ])
  })
})
