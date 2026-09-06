// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FeatureFull } from '../src/lib/api'
import { full, wp } from './fixtures'

/**
 * Every phase body fills the workspace body area (decisions 11, 15).
 *
 * `Workspace` lays ideation, spec and tickets out in a flex row that spans the
 * workspace; a body root that does not claim the main axis is sized to its
 * content instead, and the terminal — the one pane meant to grow — collapses.
 * Measured at 1440×900 with the Details panel hidden, that left the terminal
 * 368px wide beside the 380px artifact pane and 258px beside the 300px map rail,
 * with 424–614px of the workspace unclaimed to the right of it: narrower than
 * the ~400px decision 15 hides the Details panel to buy back.
 *
 * Neither happy-dom nor jsdom lays anything out — every box here is 0×0 — so
 * what is asserted is the contract that produces the layout: each body root
 * grows into the row (`flex-1`) and lets the panes inside it shrink (`min-w-0`).
 */
const DOCS: Record<string, string> = {
  'decisions.md': '# Decisions\n\n## 1. Fill the body\nBecause the terminal needs the room.\n',
  'spec.md': '# Spec\n\n## Problem\nThe split never stretched.\n',
  'map.md': '## Destination\nA body that fills its row.\n',
}

vi.mock('../src/lib/live', () => ({ useLivePoll: () => false as const, useLiveStatus: () => 'live' }))
vi.mock('../src/lib/toast', () => ({ useToast: () => ({ push: () => undefined }) }))
vi.mock('../src/trpc', () => ({
  trpc: {
    useUtils: () => ({
      client: { ticket: { edit: { mutate: async () => undefined } } },
      feature: { get: { invalidate: async () => undefined }, list: { invalidate: async () => undefined } },
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

const { GrillBody } = await import('../src/components/bodies/grill/GrillBody')
const { PinnedBody } = await import('../src/components/bodies/PinnedBody')
const { TicketsBody } = await import('../src/components/bodies/tickets/TicketsBody')

afterEach(cleanup)

const DOC_ROWS = [
  { relPath: 'decisions.md', title: 'Decisions' },
  { relPath: 'spec.md', title: 'Spec' },
  { relPath: 'map.md', title: 'Map' },
] as FeatureFull['docs']

const SESSION = {
  id: 'sess_1',
  featureId: 'feat_1',
  kind: 'ideation',
  lap: 1,
  status: 'ended',
  ccSessionId: 'cc_1',
  createdAt: 1_760_000_000_000,
} as FeatureFull['sessions'][number]

function feature(over: Partial<FeatureFull['feature']> = {}): FeatureFull {
  const base = full({ id: 'feat_1', ...over })
  return { ...base, feature: { ...base.feature, lap: 1, ...over } as FeatureFull['feature'], docs: DOC_ROWS, sessions: [SESSION] }
}

const MAPPED: FeatureFull = {
  ...feature({ phase: 'ideation', mapped: true }),
  waypoints: [wp({ id: 'w1', seq: 1, title: 'Claim the row' })],
  frontierIds: ['w1'],
}

/** The payload `TicketsBody`'s own query hands back. */
function ticketsPayload(): FeatureFull {
  return { ...feature({ phase: 'tickets' }), tickets: [] }
}

const pane = { mapRailCollapsed: false, onToggleMapRail: () => undefined }

/** The root element each phase body hands the workspace's two-pane row. */
function roots(): Record<string, HTMLElement> {
  const root = (element: Parameters<typeof render>[0]) => {
    const first = render(element).container.firstElementChild
    if (!(first instanceof HTMLElement)) throw new Error('the body rendered no root element')
    return first
  }
  const live = { ...pane, artifactPaneCollapsed: false, onToggleArtifactPane: () => undefined }

  return {
    'ideation · unmapped': root(<GrillBody full={feature({ phase: 'ideation' })} effective="ideation" {...live} />),
    'ideation · mapped': root(<GrillBody full={MAPPED} effective="ideation" {...live} />),
    spec: root(<GrillBody full={feature({ phase: 'spec' })} effective="spec" {...live} />),
    tickets: root(<TicketsBody featureId="feat_1" />),
    'pinned ideation': root(<PinnedBody full={MAPPED} effective="ideation" events={[]} {...pane} />),
    'pinned spec': root(<PinnedBody full={feature({ phase: 'spec' })} effective="spec" events={[]} {...pane} />),
    'pinned tickets': root(<PinnedBody full={ticketsPayload()} effective="tickets" events={[]} {...pane} />),
  }
}

/**
 * What each body is, in one fragment: a body that quietly rendered nothing —
 * or an artifact pane that swallowed its own error — would still hand back a
 * root element and pass the class check on its own.
 */
const MARKERS: Record<string, string> = {
  'ideation · unmapped': 'Decisions so far',
  'ideation · mapped': 'Claim the row',
  spec: 'The split never stretched',
  tickets: 'No tickets yet',
  'pinned ideation': 'Fill the body',
  'pinned spec': 'The split never stretched',
  'pinned tickets': 'No tickets in this lap.',
}

describe('the phase bodies of ideation, spec and tickets', () => {
  it('each hand the workspace a root that grows into its row', () => {
    const rendered = roots()
    expect(Object.keys(rendered)).toEqual(Object.keys(MARKERS))
    for (const [body, element] of Object.entries(rendered)) {
      expect.soft(element.textContent, body).toContain(MARKERS[body])
      const classes = element.className.split(' ')
      expect.soft(classes, body).toContain('flex-1')
      expect.soft(classes, body).toContain('min-w-0')
    }
  })
})
