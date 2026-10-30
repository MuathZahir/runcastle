// @vitest-environment happy-dom
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { EventRow } from '@runcastle/core'
import type { FeatureFull } from '../src/lib/api'
import type { FeatureView } from '../src/lib/routes'
import { full as fixture } from './fixtures'

/**
 * The chat-first feature page (design-mode decisions 4, 5, 12) once tickets and
 * review are tools, not phases (decisions 2, 7, 8, 9): the one header row with
 * no Go, the chat, the panel's fixed views beside them offered by the
 * feature's facts, a draft's body as the page — and what opens a view.
 */

const store = vi.hoisted(() => ({
  full: undefined as unknown,
  /** What each query answers, by its tRPC path; anything unnamed answers nothing yet. */
  queries: new Map<string, unknown>(),
  /** Every mutation's options, by its tRPC path — the page's handlers, to call. */
  mutations: new Map<string, { onSuccess?: (...args: unknown[]) => void }>(),
  /** Every tRPC path a hook was asked for, to prove the page never reaches a retired one. */
  touched: new Set<string>(),
}))

/** Every tRPC hook answers: `feature.get` the fixture, other queries from `store.queries`, mutations record their options. */
vi.mock('../src/trpc', () => {
  const node = (path: string[]): unknown =>
    new Proxy(() => Promise.resolve(), {
      get: (_, key) => {
        const name = path.join('.')
        if (key === 'useQuery') {
          store.touched.add(name)
          return () => ({
            data: name === 'feature.get' ? store.full : store.queries.get(name),
            isLoading: false,
            error: null,
          })
        }
        if (key === 'useMutation') {
          store.touched.add(name)
          return (options: { onSuccess?: (...args: unknown[]) => void } = {}) => {
            store.mutations.set(name, options)
            return { mutate: () => undefined, mutateAsync: async () => undefined, isPending: false }
          }
        }
        if (key === 'useUtils') return () => node([])
        return node([...path, String(key)])
      },
    })
  return { trpc: node([]) }
})
vi.mock('../src/lib/live', () => ({ useLivePoll: () => false, useLiveStatus: () => 'live' }))
vi.mock('../src/lib/toast', () => ({ useToast: () => ({ push: () => undefined }) }))

const { Workspace } = await import('../src/components/Workspace')

afterEach(cleanup)

type Ticket = FeatureFull['tickets'][number]
const ticket = (seq: number, over: Partial<Ticket> = {}): Ticket =>
  ({
    id: `t${seq}`,
    featureId: 'f1',
    seq,
    title: `Ticket ${seq}`,
    goal: '',
    context: '',
    acceptanceCriteria: [],
    seams: [],
    blockedBy: [],
    kind: 'implementation',
    status: 'pending',
    commits: [],
    ...over,
  }) as Ticket

const doc = (name: string) => ({ relPath: `docs/features/demo/${name}`, title: name })

interface PageOptions {
  driving?: { featureId: string; branch: string } | null
  view?: FeatureView
  status?: FeatureFull['feature']['status']
  onViewChange?: (view: FeatureView) => void
  preview?: boolean
  tickets?: Ticket[]
  docs?: ReturnType<typeof doc>[]
  runs?: FeatureFull['runs']
  queries?: Record<string, unknown>
}

function setup({ status = 'active', preview = false, tickets = [], docs = [], runs = [], queries = {} }: PageOptions) {
  const base = fixture({ id: 'f1', status })
  store.full = {
    ...base,
    tickets,
    docs,
    runs,
    ...(preview ? { preview: { relPath: 'docs/features/demo/preview.html', updatedAt: 1 } } : {}),
  }
  store.queries = new Map(Object.entries({ 'events.list': [], ...queries }))
  store.mutations.clear()
  store.touched.clear()
}

function workspace({ view = 'chat', onViewChange = () => undefined, driving = null }: PageOptions) {
  return createElement(
    QueryClientProvider,
    { client: new QueryClient() },
    createElement(Workspace, {
      featureId: 'f1',
      view,
      onViewChange,
      guidance: false,
      driving,
      onDriveChange: () => undefined,
    }),
  )
}

function page(options: PageOptions = {}): string {
  setup(options)
  return renderToStaticMarkup(workspace(options))
}

const at = (html: string, needle: string) => html.indexOf(needle)

/** The one header row: everything from `<header` to its close. */
const headerOf = (html: string) => html.slice(at(html, '<header'), at(html, '</header>'))

/** The open panel: everything from its marker on. */
const panelOf = (html: string) => html.slice(at(html, 'data-panel'))

const READY = { 'feature.readyDeclarations': [{ id: 'r1', featureId: 'f1', runId: null, scenario: 'Checkout', whatToTest: 'Pay.', createdAt: 5 }] }

describe('the chat-first feature page', () => {
  it('shows exactly one header row, then the chat — no strip, no chat header, no tabs', () => {
    const html = page()
    expect(html).not.toContain('role="tab"')
    expect(html).not.toContain('Overview')
    expect(html).not.toContain('data-feature-strip')
    expect(html.split('<header').length - 1).toBe(1)
    const chat = at(html, 'data-thread-column')
    expect(at(html, '</header>')).toBeLessThan(chat)
    const header = headerOf(html)
    expect(header).toContain('Demo')
    expect(header).toContain('role="status"')
    // The thread in front is named, not switched: its list is the sidebar's (threads-in-the-sidebar).
    expect(header).not.toContain('aria-label="Thread"')
    expect(header).toContain('aria-label="Breadcrumb"')
    expect(header).toContain('aria-label="Feature actions"')
    expect(header).toContain('aria-label="Show the panel"')
    expect(html).not.toContain('data-panel')
  })

  it('reads Talking with you with nothing running and nothing asked, and carries no button, Go or otherwise', () => {
    const header = headerOf(page({ tickets: [ticket(1)] }))
    expect(header).toContain('Talking with you')
    const buttons = [...header.matchAll(/<button[^>]*>/g)].map((m) => m[0])
    const chrome = buttons.filter((b) => /aria-label="(Feature actions|Show the panel|Hide the panel|Show sidebar)"/.test(b))
    expect(buttons.length - chrome.length).toBe(0)
    expect(header).not.toMatch(/>Go</)
    expect(header).not.toContain('Merge &amp; ship')
  })

  it('offers Start test drive once the agent declared ready, with no What-to-test notice', () => {
    const html = page({ queries: READY })
    expect(headerOf(html)).toContain('Ready for you')
    expect(headerOf(html)).toContain('Start test drive')
    expect(html).not.toContain('What to test')
  })

  it('shows the share of the non-cancelled tickets that landed in the title’s glyph', () => {
    const tickets = [ticket(1, { status: 'done' }), ticket(2), ticket(3, { status: 'cancelled' })]
    expect(headerOf(page({ tickets }))).toContain('stroke-dasharray:50 100')
    expect(headerOf(page())).toContain('stroke-dasharray:0 100')
  })

  it('has no button per panel view in the header', () => {
    const header = headerOf(page({ preview: true, tickets: [ticket(1)], queries: READY }))
    expect(header).not.toMatch(/(Plan|Work|Tickets|Preview|Design|Review|Details)<\/button>/)
  })

  it('opens the panel beside the chat, and floats it over the chat below ~1100px', () => {
    const html = page({ view: 'details' })
    expect(html).toContain('data-panel')
    expect(html).toContain('@max-[1100px]:absolute')
    expect(html).toContain('aria-label="Resize the panel"')
    expect(at(html, 'data-panel')).toBeGreaterThan(at(html, 'data-chat-view'))
    expect(headerOf(html)).toContain('aria-label="Hide the panel"')
  })

  it('never shows a view the feature’s facts do not offer, whatever the address says', () => {
    expect(page({ view: 'drive' })).not.toContain('data-panel')
    expect(page({ view: 'work' })).not.toContain('data-panel')
    expect(page({ view: 'plan' })).not.toContain('data-panel')
  })

  it("shows a draft's body as the page, with no chat and no panel", () => {
    const html = page({ status: 'draft', view: 'details' })
    expect(html).not.toContain('data-chat-view')
    expect(html).not.toContain('data-panel')
    expect(html).not.toContain('Show the panel')
    expect(html).not.toContain('aria-label="Chat session"')
  })

  it('makes no call to Go, its warnings, the human’s burn or the agentic review', () => {
    page({ tickets: [ticket(1)], queries: READY, view: 'details' })
    page({ tickets: [ticket(1)], view: 'work' })
    for (const retired of ['feature.go', 'feature.goWarnings', 'feature.burn', 'feature.agenticReview']) {
      expect(store.touched.has(retired)).toBe(false)
    }
  })
})

describe('the panel’s views', () => {
  it('switches the views by tabs in the panel’s header, Review never among them', () => {
    const panel = panelOf(page({ view: 'plan', preview: true, tickets: [ticket(1)], queries: READY, docs: [doc('spec.md')] }))
    const views = panel.slice(at(panel, 'aria-label="Panel views"'), at(panel, 'aria-label="Fold the panel"'))
    expect([...views.matchAll(/role="tab"/g)]).toHaveLength(3)
    expect(views).toContain('Tickets')
    expect(views).toContain('Details')
    expect(views).not.toContain('Review')
  })

  it('shows the plan preview in Plan, with Decisions and Spec as tabs beside it and no repeated title', () => {
    const docs = [doc('brief.md'), doc('decisions.md'), doc('spec.md')]
    const panel = panelOf(page({ view: 'plan', preview: true, docs, queries: { 'docs.read': { content: '<p>the show</p>' } } }))
    const bar = panel.slice(at(panel, 'role="tablist" aria-label="Plan"'))
    expect(bar).toContain('Preview</button>')
    expect(bar).toContain('Decisions</button>')
    expect(bar).toContain('Spec</button>')
    expect(bar).not.toContain('brief.md')
    expect(panel).toContain('<iframe')
    expect(panel).not.toContain('<h1')
  })

  it('reads the decisions in Plan before a preview exists, in the panel and not a dialog', () => {
    const panel = panelOf(page({ view: 'plan', docs: [doc('decisions.md')] }))
    expect(panel).not.toContain('Preview</button>')
    expect(panel).toContain('Decisions</button>')
    expect(panel).not.toContain('role="dialog"')
    expect(panel).not.toContain('<iframe')
  })

  it('shows the ticket ledger in Work, with no Go above it', () => {
    const panel = panelOf(page({ view: 'work', tickets: [ticket(1), ticket(2, { kind: 'review', passKind: 'review' })] }))
    expect(panel).toContain('aria-label="Tickets"')
    expect(panel).toContain('Ticket 1')
    expect(panel).not.toMatch(/>Go</)
    expect(panel).not.toContain('Go anyway')
  })
})

describe('what opens the panel', () => {
  it('opens the drive on the Test drive click, before the server answers', () => {
    const onViewChange = vi.fn()
    setup({ queries: READY })
    render(workspace({ onViewChange }))
    fireEvent.click(screen.getByRole('button', { name: 'Start test drive' }))
    expect(onViewChange).toHaveBeenCalledWith('drive')
  })

  it('opens nothing when a test drive lands, or stops', () => {
    const onViewChange = vi.fn()
    page({ onViewChange, queries: READY })
    const testDrive = store.mutations.get('feature.testDrive')
    testDrive?.onSuccess?.({ ok: true, branch: 'b' }, { featureId: 'f1', action: 'start' })
    testDrive?.onSuccess?.({ ok: true, branch: 'b' }, { featureId: 'f1', action: 'stop' })
    expect(onViewChange).not.toHaveBeenCalled()
  })

  it('opens nothing on any other mutation landing', () => {
    const onViewChange = vi.fn()
    page({ onViewChange })
    for (const [path, options] of store.mutations) {
      if (path === 'feature.testDrive') continue
      options.onSuccess?.({ ok: true, files: [], confirmed: true }, { featureId: 'f1' })
    }
    expect(onViewChange).not.toHaveBeenCalled()
  })

  // the-feature-s-right-panel decision 20: Review was the one place to write notes.
  it('says a merged feature’s Details was merged, with its time', () => {
    const shipped = { id: 1, projectId: 'p1', featureId: 'f1', ts: Date.now() - 3 * 3_600_000, type: 'feature.shipped', message: 'shipped' } as EventRow
    setup({ status: 'shipped', queries: { 'events.list': [shipped] } })
    const view = render(workspace({ view: 'details' }))
    const facts = view.container.querySelector('[data-panel]')?.textContent ?? ''
    expect(facts).toContain('Merged')
    expect(facts).toContain('3h ago')
  })

  it('opens Work on the panel.show emit_tickets raises, even before the refetched feature has the tickets', () => {
    const event = (id: number, type: string, data?: unknown): EventRow =>
      ({ id, projectId: 'p1', featureId: 'f1', ts: id, type, message: type, data }) as EventRow
    const onViewChange = vi.fn()
    setup({ queries: { 'events.list': [event(1, 'session.started')] } })
    const view = render(workspace({ onViewChange }))
    store.queries.set('events.list', [event(1, 'session.started'), event(2, 'panel.show', { view: 'work' })])
    act(() => view.rerender(workspace({ onViewChange })))
    expect(onViewChange).toHaveBeenCalledWith('work')
  })
})

/** test-drive-looks-the-part decisions 13, 19, 20: while on a drive, the drive is the page. */
describe('the drive page', () => {
  const driving = { featureId: 'f1', branch: 'feature/f1' }

  it('takes the page in place of the header, the chat and the panel', () => {
    const html = page({ view: 'drive', driving })
    expect(html).toContain('data-drive-page')
    expect(html).toContain('>Stop drive<')
    expect(html).toContain('aria-label="Back to the chat"')
    expect(html).not.toContain('data-panel')
    // The header and the chat stay mounted under it, hidden.
    expect(at(html, 'class="hidden"')).toBeGreaterThan(-1)
    expect(html.slice(0, at(html, 'class="hidden"'))).not.toContain('<header')
  })

  it('stays mounted behind the chat page, with the way back in the header', () => {
    const html = page({ view: 'chat', driving })
    expect(html).toMatch(/class="[^"]*hidden[^"]*" data-drive-page/)
    expect(headerOf(html)).toContain('Back to the drive')
    expect(headerOf(html)).not.toContain('Stop drive')
    // Over the chat: the agent is held, and how to let it go.
    expect(html).toContain('the agent can’t start a round')
    expect(html).toContain('>Stop drive<')
  })

  it('is not there with no drive', () => {
    expect(page({ view: 'chat' })).not.toContain('data-drive-page')
  })
})
