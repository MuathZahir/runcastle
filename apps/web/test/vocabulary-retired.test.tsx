// @vitest-environment happy-dom
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FeatureFull } from '../src/lib/api'
import { nextStep } from '../src/lib/feature-ui'
import type { NextStepContext } from '../src/lib/feature-ui/next-step/resolver-input'
import { full, wp } from './fixtures'

/**
 * The copy policy, enforced (decision 12). Ideation, spec and tickets retired
 * "grill", "frontier", "fog", "promote" and "approve" from every string they
 * render, `GRILL LIVE` became `SESSION LIVE`, and the tickets bar's ghost
 * `Revisit` became `Ask for changes`. Prose drifts back; a rendering sweep does
 * not, so every surface of this flow is rendered here and read for the words.
 *
 * The one deliberate exception is a waypoint's `type`, which is wire data
 * (ADR-0001 charts `research` / `grilling` / `prototype` / `task`) rendered as a
 * dim chip, not copy this flow writes — it has its own case at the bottom.
 */
const RETIRED = /\bgrill|frontier|\bfog\b|promote|approve\b/i

const DOCS: Record<string, string> = {
  'decisions.md': '# Decisions\n\n## 1. Ship it\nBecause.\n',
  'spec.md': '# Spec\n\n## Problem\nThe words were the problem.\n',
  'map.md': '## Destination\nA map a newcomer can read.\n\n## Not yet specified\nThe error copy.\n',
}

vi.mock('../src/lib/live', () => ({ useLivePoll: () => false as const, useLiveStatus: () => 'live' }))
vi.mock('../src/lib/toast', () => ({ useToast: () => ({ push: () => undefined }) }))
vi.mock('../src/trpc', () => ({
  trpc: {
    useUtils: () => ({
      client: { ticket: { edit: { mutate: async () => undefined } } },
      feature: { get: { invalidate: async () => undefined }, list: { invalidate: async () => undefined } },
      events: { invalidate: async () => undefined },
    }),
    docs: {
      read: {
        useQuery: ({ relPath }: { relPath: string }) => ({
          data: DOCS[relPath] === undefined ? undefined : { content: DOCS[relPath] },
          isLoading: false,
          error: null,
        }),
      },
    },
    events: { list: { useQuery: () => ({ data: [] }) } },
    settings: { get: { useQuery: () => ({ data: { fields: [] }, isLoading: false, error: null }) } },
    feature: {
      get: { useQuery: () => ({ data: ticketsPayload(), isLoading: false, error: null }) },
      endSession: { useMutation: () => ({ isPending: false, mutate: () => undefined }) },
      workWaypoint: { useMutation: () => ({ isPending: false, mutate: () => undefined }) },
      resendKickoff: { useMutation: () => ({ isPending: false, mutate: () => undefined }) },
    },
    ticket: {
      edit: { useMutation: () => ({ isPending: false, mutate: () => undefined }) },
      cancel: { useMutation: () => ({ isPending: false, mutate: () => undefined }) },
    },
  } as unknown as typeof import('../src/trpc').trpc,
}))

const { NextStepBar } = await import('../src/components/workspace/NextStepBar')
const { GrillBody } = await import('../src/components/bodies/grill/GrillBody')
const { MapRail } = await import('../src/components/bodies/grill/MapRail')
const { PinnedBody } = await import('../src/components/bodies/PinnedBody')
const { TicketsBody } = await import('../src/components/bodies/tickets/TicketsBody')
const { SessionStrip } = await import('../src/components/session/SessionStrip')

afterEach(cleanup)

type Session = FeatureFull['sessions'][number]

/**
 * `full` fills the feature from the sidebar-row fixture, which pins `mapped` and
 * carries no `lap` — both of which decide which branch the ideation and tickets
 * resolvers take. This lays the override back over the built feature.
 */
function feat(over: Partial<FeatureFull['feature']> = {}): FeatureFull {
  const base = full(over)
  return { ...base, feature: { ...base.feature, lap: 1, ...over } as FeatureFull['feature'] }
}

function session(over: Partial<Session> = {}): Session {
  return {
    id: 'sess_1',
    featureId: 'feat_1',
    kind: 'ideation',
    lap: 1,
    status: 'ended',
    ccSessionId: 'cc_1',
    createdAt: 1_760_000_000_000,
    ...over,
  } as Session
}

const DOC_ROWS = [
  { relPath: 'decisions.md', title: 'Decisions' },
  { relPath: 'spec.md', title: 'Spec' },
  { relPath: 'map.md', title: 'Map' },
] as FeatureFull['docs']

function ticket(over: Record<string, unknown> = {}): FeatureFull['tickets'][number] {
  return {
    id: 'tk_1',
    featureId: 'feat_1',
    seq: 1,
    lap: 1,
    title: 'Wire the ledger',
    goal: 'Wire it',
    context: '',
    acceptanceCriteria: ['It is wired'],
    seams: [],
    blockedBy: [],
    kind: 'implementation',
    status: 'pending',
    commits: [],
    ...over,
  } as unknown as FeatureFull['tickets'][number]
}

/** The payload `TicketsBody`'s own query hands back, tickets and all. */
function ticketsPayload(): FeatureFull {
  return {
    ...feat({ id: 'feat_1', phase: 'tickets' }),
    docs: DOC_ROWS,
    tickets: [ticket(), ticket({ id: 'tk_2', seq: 2, status: 'done' })],
    sessions: [session({ kind: 'converge' })],
  }
}

/** The bar as it renders for one resolved state. */
function bar(payload: FeatureFull, ctx: Partial<NextStepContext> = {}): string {
  return renderToStaticMarkup(
    createElement(NextStepBar, {
      ns: nextStep(payload, { driving: false, ...ctx }),
      guidance: true,
      busy: false,
      onAction: () => undefined,
    }),
  )
}

/** Every state the ideation, spec and tickets resolvers can return. */
function barStates(): Record<string, string> {
  const ideation = (over: Partial<FeatureFull> = {}, ctx: Partial<NextStepContext> = {}) =>
    bar({ ...feat({ phase: 'ideation' }), ...over }, ctx)
  const mapped = { ...feat({ phase: 'ideation', mapped: true }), docs: DOC_ROWS }
  const open = [wp({ id: 'w1', seq: 1, title: 'Where do the words come from?' }), wp({ id: 'w2', seq: 2, title: 'What does the rail say?' })]

  return {
    'ideation · never started': ideation(),
    'ideation · ended conversation': ideation({ sessions: [session()] }),
    'ideation · live': ideation({ sessions: [session({ status: 'live' })] }),
    'ideation · lap 2 not yet worked': ideation({ feature: { ...feat({ phase: 'ideation' }).feature, lap: 2 }, sessions: [session()] }),
    'ideation · lap 2 live': ideation({ feature: { ...feat({ phase: 'ideation' }).feature, lap: 2 }, sessions: [session({ status: 'live', lap: 2 })] }),
    'ideation · map with ready waypoints': bar(
      { ...mapped, waypoints: open, frontierIds: ['w1', 'w2'] },
      { mapContent: DOCS['map.md'] },
    ),
    'ideation · map waiting on research': bar({
      ...mapped,
      waypoints: [wp({ id: 'w1', seq: 1, title: 'Read the audit', type: 'research', claimedBy: 'run_1' })],
      frontierIds: [],
    }),
    'ideation · map complete': bar({ ...mapped, gate: { next: null, satisfied: true } }),
    'spec · live': bar({ ...feat({ phase: 'spec' }), sessions: [session({ kind: 'converge', status: 'live' })] }),
    'spec · converge stranded': bar({ ...feat({ phase: 'spec', mapped: true }), sessions: [session({ kind: 'converge' })] }),
    'spec · no spec yet': bar(feat({ phase: 'spec' })),
    'tickets · ready to burn': bar(ticketsPayload()),
    'tickets · emitting': bar({ ...feat({ phase: 'tickets' }), sessions: [session({ kind: 'converge', status: 'live' })] }),
    'tickets · waiting for tickets': bar(feat({ phase: 'tickets' })),
  }
}

/** The bodies, rail and strip, rendered through a DOM and read as markup. */
function surfaces(): Record<string, string> {
  const html = (element: Parameters<typeof render>[0]) => render(element).container.innerHTML
  const ideation = { ...feat({ id: 'feat_1', phase: 'ideation' }), docs: DOC_ROWS, sessions: [session()] }
  const mapped = {
    ...feat({ id: 'feat_1', phase: 'ideation', mapped: true }),
    docs: DOC_ROWS,
    sessions: [session()],
    waypoints: [
      wp({ id: 'w1', seq: 1, title: 'Where do the words come from?', type: 'task' }),
      wp({ id: 'w2', seq: 2, title: 'What does the rail say?', type: 'research', blockedBy: [1] }),
      wp({ id: 'w3', seq: 3, title: 'Which words go?', type: 'prototype', status: 'resolved', summary: 'They all go.' }),
    ],
    frontierIds: ['w1'],
  }
  const pane = { collapsed: false, onToggle: () => undefined }

  return {
    'grill body · unmapped ideation': html(
      <GrillBody full={ideation} effective="ideation" mapRailCollapsed={false} onToggleMapRail={() => undefined} artifactPaneCollapsed={false} onToggleArtifactPane={() => undefined} />,
    ),
    'grill body · no session yet': html(
      <GrillBody full={{ ...ideation, sessions: [] }} effective="ideation" mapRailCollapsed={false} onToggleMapRail={() => undefined} artifactPaneCollapsed={false} onToggleArtifactPane={() => undefined} />,
    ),
    'grill body · spec': html(
      <GrillBody full={{ ...ideation, feature: { ...ideation.feature, phase: 'spec' } }} effective="spec" mapRailCollapsed={false} onToggleMapRail={() => undefined} artifactPaneCollapsed={false} onToggleArtifactPane={() => undefined} />,
    ),
    'grill body · mapped ideation': html(
      <GrillBody full={mapped} effective="ideation" mapRailCollapsed={false} onToggleMapRail={() => undefined} artifactPaneCollapsed={false} onToggleArtifactPane={() => undefined} />,
    ),
    'map rail · open': html(<MapRail full={mapped} relPath="map.md" {...pane} />),
    'map rail · collapsed': html(<MapRail full={mapped} relPath="map.md" collapsed onToggle={() => undefined} />),
    'map rail · pinned': html(<MapRail full={mapped} relPath="map.md" {...pane} readonly />),
    'tickets body': html(<TicketsBody featureId="feat_1" />),
    'pinned ideation': html(<PinnedBody full={mapped} effective="ideation" events={[]} mapRailCollapsed={false} onToggleMapRail={() => undefined} />),
    'pinned spec': html(<PinnedBody full={ideation} effective="spec" events={[]} mapRailCollapsed={false} onToggleMapRail={() => undefined} />),
    'pinned tickets': html(<PinnedBody full={ticketsPayload()} effective="tickets" events={[]} mapRailCollapsed={false} onToggleMapRail={() => undefined} />),
    'session strip · live': html(<SessionStrip session={session({ status: 'live' })} />),
    'session strip · ended': html(<SessionStrip session={session()} />),
  }
}

/**
 * What each bar state is, in one fragment. A sweep over states that quietly
 * stopped resolving would pass by rendering nothing at all — this is what keeps
 * the fixtures above honest about which branch each one takes.
 */
const BAR_MARKERS: Record<string, string | RegExp> = {
  'ideation · never started': 'Start session',
  'ideation · ended conversation': 'Resume session',
  'ideation · live': 'Ideation session in progress',
  'ideation · lap 2 not yet worked': 'Start lap 2 session',
  'ideation · lap 2 live': 'Lap 2 in progress',
  'ideation · map with ready waypoints': 'Work next',
  'ideation · map waiting on research': 'Waiting on 1 research run',
  'ideation · map complete': 'Converge',
  'spec · live': 'Writing the spec',
  'spec · converge stranded': 'Resume converge',
  'spec · no spec yet': 'Write the spec',
  'tickets · ready to burn': 'Burn 2 tickets',
  'tickets · emitting': 'Emitting tickets',
  'tickets · waiting for tickets': 'Waiting for tickets',
}

describe('the retired vocabulary', () => {
  it('is swept over every bar state the three phases resolve to', () => {
    const states = barStates()
    expect(Object.keys(states)).toEqual(Object.keys(BAR_MARKERS))
    for (const [state, marker] of Object.entries(BAR_MARKERS)) {
      expect.soft(states[state], state).toMatch(marker)
    }
  })

  it('appears in no state of the ideation, spec and tickets bar', () => {
    for (const [state, html] of Object.entries(barStates())) {
      expect.soft(html, state).not.toMatch(RETIRED)
    }
  })

  it('appears on none of this flow`s bodies, its rail or its session strip', () => {
    const rendered = surfaces()
    // Same guard as the bar's markers: a surface that rendered nothing would
    // pass the sweep, so each one has to prove it drew its own artifact.
    const markers: Record<string, string> = {
      'grill body · unmapped ideation': 'Decisions so far',
      'grill body · no session yet': 'No session yet',
      'grill body · spec': 'The words were the problem',
      'grill body · mapped ideation': 'Where do the words come from?',
      'map rail · open': 'A map a newcomer can read',
      'map rail · collapsed': '1/3',
      'map rail · pinned': 'They all go.',
      'tickets body': 'Wire the ledger',
      'pinned ideation': 'Ship it',
      'pinned spec': 'The words were the problem',
      'pinned tickets': 'Wire the ledger',
      'session strip · live': 'live',
      'session strip · ended': 'ended',
    }
    expect(Object.keys(rendered)).toEqual(Object.keys(markers))
    for (const [surface, html] of Object.entries(rendered)) {
      expect.soft(html, surface).toContain(markers[surface])
      expect.soft(html, surface).not.toMatch(RETIRED)
    }
  })

  it('has taken GRILL LIVE off the live-session bar', () => {
    const states = barStates()
    expect(states['ideation · live']).not.toContain('GRILL LIVE')
    expect(states['ideation · live']).toContain('SESSION LIVE')
  })

  it('offers Ask for changes where the tickets bar used to offer Revisit', () => {
    const html = barStates()['tickets · ready to burn']
    expect(html).toContain('Ask for changes')
    expect(html).not.toMatch(/>\s*Revisit\s*</)
  })

  /**
   * The exception the sweep above is written around: a waypoint's charted type
   * is server data rendered as a dim chip. It is the only place the word may
   * still surface, so the count pins it to exactly that one chip.
   */
  it('still shows a charted waypoint type verbatim, and nowhere else', () => {
    const charted = {
      ...feat({ id: 'feat_1', phase: 'ideation', mapped: true }),
      docs: DOC_ROWS,
      waypoints: [wp({ id: 'w1', seq: 1, title: 'Where do the words come from?', type: 'grilling' })],
      frontierIds: ['w1'],
    }
    const html = render(<MapRail full={charted} relPath="map.md" collapsed={false} onToggle={() => undefined} />).container.innerHTML
    expect(html.match(/grill/gi)).toHaveLength(1)
    expect(html).toContain('>grilling<')
  })
})
