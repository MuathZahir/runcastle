import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { Feature, Phase, Ticket } from '@runcastle/core'
import type { FeatureFull } from '../src/lib/api'
import { uiStatesModel } from './fixtures'

const store = vi.hoisted(() => ({ full: undefined as unknown, uiStates: null as unknown }))

/** Every tRPC hook a planning body calls: queries answer from `store`, nothing mutates. */
vi.mock('../src/trpc', () => {
  const query = (data: unknown) => ({ data, isLoading: false, error: null })
  return {
    trpc: {
      useUtils: () => ({}),
      docs: { read: { useQuery: (input: { relPath: string }) => query({ content: input.relPath === 'preview.html' ? '<!doctype html><p>the show</p>' : '# Decisions\n' }) } },
      feature: {
        get: { useQuery: () => query(store.full) },
        rounds: { useQuery: () => query([]) },
        endSession: { useMutation: () => ({ isPending: false, mutate: () => undefined }) },
        uiStates: { useQuery: () => query(store.uiStates) },
      },
      settings: { get: { useQuery: () => query({ fields: [] }) } },
      ticket: {
        edit: { useMutation: () => ({ isPending: false, mutate: () => undefined }) },
        cancel: { useMutation: () => ({ isPending: false, mutate: () => undefined }) },
      },
    },
  }
})
vi.mock('../src/lib/live', () => ({ useLivePoll: () => false, useLiveStatus: () => 'live' }))
vi.mock('../src/lib/toast', () => ({ useToast: () => ({ push: () => undefined }) }))

const { PhaseBody } = await import('../src/components/Workspace')
const { GrillBody } = await import('../src/components/bodies/grill/GrillBody')
const { PinnedBody } = await import('../src/components/bodies/PinnedBody')
const { TicketsBody } = await import('../src/components/bodies/tickets/TicketsBody')
const { planningFills } = await import('../src/lib/feature-ui/pipeline')

const feature = { id: 'f1', projectId: 'p1', slug: 'x', title: 'X', lap: 1, phase: 'planning', status: 'active' } as Feature
const ticket = { id: 't1', featureId: 'f1', seq: 1, lap: 1, title: 'Build it', goal: 'g', context: '', acceptanceCriteria: [], seams: [], blockedBy: [], kind: 'implementation', passKind: 'review', reviewedCommit: null, completedAt: null, status: 'pending', commits: [] } as unknown as Ticket

function fullWith({ tickets = [] as Ticket[], preview = null as FeatureFull['preview'] } = {}): FeatureFull {
  const full = { feature, tickets, sessions: [], runs: [], docs: [{ relPath: 'decisions.md', title: 'Decisions' }], preview, dependsOn: [], blocks: [] } as unknown as FeatureFull
  store.full = full
  store.uiStates = null
  return full
}

function body(full: FeatureFull, effective: Phase, { readonly = false, ticketsIsBody = false } = {}): string {
  return withoutIds(
    renderToStaticMarkup(
      createElement(PhaseBody, {
        effective,
        full,
        events: [],
        driving: null,
        conflict: null,
        runId: null,
        ticketsIsBody,
        readonly,
        onViewPhase: () => undefined,
      }),
    ),
  )
}

/**
 * React's generated ids follow a node's place among its siblings, so the last
 * review's UI-states slot beside a planning body (rendering nothing before a
 * first review) renumbers them without changing a byte of what is shown.
 */
const withoutIds = (html: string) => html.replace(/_R_\w+_/g, '_R_')
const markup = (element: ReactElement) => withoutIds(renderToStaticMarkup(element))
const PREVIEW = { relPath: 'preview.html', updatedAt: Date.now() } as const
const panelAt = (html: string) => html.indexOf('<iframe')

/** plan-preview decisions 6 and 11: the preview leads planning's bodies, and only theirs. */
describe('the preview on the planning page', () => {
  it('leads the planning body above the decisions before this lap has tickets', () => {
    const html = body(fullWith({ preview: PREVIEW }), 'planning')
    expect(panelAt(html)).toBeGreaterThan(-1)
    expect(panelAt(html)).toBeLessThan(html.indexOf('Decisions so far'))
  })

  it('leads the planning body above the ticket ledger once there are tickets', () => {
    const html = body(fullWith({ tickets: [ticket], preview: PREVIEW }), 'planning', { ticketsIsBody: true })
    expect(panelAt(html)).toBeGreaterThan(-1)
    expect(panelAt(html)).toBeLessThan(html.indexOf('aria-label="Tickets"'))
  })

  it('takes the planning body out of the fill layout, so the page scrolls both', () => {
    const args = { phase: 'planning' as const, readonly: false, ticketsIsBody: false }
    expect(planningFills({ ...args, full: { preview: null } })).toBe(true)
    expect(planningFills({ ...args, full: { preview: PREVIEW } })).toBe(false)
  })

  it('leads the read-only Planning view', () => {
    const html = body(fullWith({ preview: PREVIEW }), 'planning', { readonly: true })
    expect(panelAt(html)).toBeGreaterThan(-1)
    expect(panelAt(html)).toBeLessThan(html.indexOf('>Decisions</h2>'))
  })

  it('is not on the Building body before a first run, though its ledger is the same', () => {
    const html = body(fullWith({ tickets: [ticket], preview: PREVIEW }), 'building', { ticketsIsBody: true })
    expect(html).toContain('aria-label="Tickets"')
    expect(html).not.toContain('<iframe')
  })

  it('leaves every planning body exactly as it was when there is no preview', () => {
    const grill = fullWith()
    expect(body(grill, 'planning')).toBe(markup(createElement(GrillBody, { full: grill })))
    expect(body(grill, 'planning', { readonly: true })).toBe(
      markup(createElement(PinnedBody, { full: grill, effective: 'planning', events: [] })),
    )
    const ledger = fullWith({ tickets: [ticket] })
    expect(body(ledger, 'planning', { ticketsIsBody: true })).toBe(markup(createElement(TicketsBody, { featureId: 'f1' })))
  })
})

/** UI-states decision 12: the last review's build stays in view between reviews. */
describe('the last review’s UI states on the planning page', () => {
  it('follows the build, not a lap counter that no longer moves', () => {
    const full = fullWith({ tickets: [ticket] })
    store.uiStates = uiStatesModel()
    const html = body(full, 'planning', { ticketsIsBody: true })
    expect(feature.lap).toBe(1)
    expect(html).toContain('id="ui-states"')
    expect(html).toContain('Built at the last review')
  })
})
