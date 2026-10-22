import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import type { Phase } from '@runcastle/core'
import type { FeatureFull } from '../src/lib/api'
import type { FeatureView } from '../src/lib/routes'
import { full as fixture } from './fixtures'

/**
 * The chat-first feature page (design-mode decisions 4, 5, 12), tier 1: the
 * one header row and the chat in every phase, the panel beside
 * them, a draft's body as the page — and the two clicks runcastle answers by
 * opening a view.
 */

const store = vi.hoisted(() => ({
  full: undefined as unknown,
  /** Every mutation's options, by its tRPC path — the page's handlers, to call. */
  mutations: new Map<string, { onSuccess?: (...args: unknown[]) => void }>(),
}))

/** Every tRPC hook answers: `feature.get` the fixture, every other query nothing yet, mutations record their options. */
vi.mock('../src/trpc', () => {
  const node = (path: string[]): unknown =>
    new Proxy(() => Promise.resolve(), {
      get: (_, key) => {
        if (key === 'useQuery') {
          return () => ({
            data: path.join('.') === 'feature.get' ? store.full : path.join('.') === 'events.list' ? [] : undefined,
            isLoading: false,
            error: null,
          })
        }
        if (key === 'useMutation') {
          return (options: { onSuccess?: (...args: unknown[]) => void } = {}) => {
            store.mutations.set(path.join('.'), options)
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

function page(
  phase: Phase,
  {
    view = 'chat' as FeatureView,
    status = 'active',
    onViewChange = (_: FeatureView) => undefined,
    preview = false,
    feature = {} as Partial<FeatureFull['feature']>,
  } = {},
): string {
  const base = fixture({ id: 'f1', phase, status: status as FeatureFull['feature']['status'] })
  const f = { ...base, feature: { ...base.feature, ...feature } }
  store.full = { ...f, ...(preview ? { preview: { relPath: 'preview.html', updatedAt: 1 } } : {}) }
  store.mutations.clear()
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: new QueryClient() },
      createElement(Workspace, {
        featureId: 'f1',
        view,
        onViewChange,
        viewedPhase: null,
        onViewPhase: () => undefined,
        guidance: false,
        driving: null,
        onDriveChange: () => undefined,
      }),
    ),
  )
}

const PHASES: Phase[] = ['planning', 'building', 'review', 'shipped']
const at = (html: string, needle: string) => html.indexOf(needle)

/** The one header row: everything from `<header` to its close. */
const headerOf = (html: string) => html.slice(at(html, '<header'), at(html, '</header>'))

describe('the chat-first feature page', () => {
  it.each(PHASES)('shows exactly one header row, then the chat, at %s — no strip, no chat header, no tabs', (phase) => {
    const html = page(phase)
    expect(html).not.toContain('role="tab"')
    expect(html).not.toContain('Overview')
    expect(html).not.toContain('data-feature-strip')
    // One header, and nothing that reads as a second row before the chat.
    expect(html.split('<header').length - 1).toBe(1)
    const chat = at(html, 'data-chat-view')
    expect(at(html, '</header>')).toBeLessThan(chat)
    // The header holds the title, the status, the switcher, "⋯" and the panel toggle.
    const header = headerOf(html)
    expect(header).toContain('Demo')
    expect(header).toContain('role="status"')
    expect(header).toContain('aria-label="Chat session"')
    expect(header).toContain('aria-label="Feature actions"')
    expect(header).toContain('aria-label="Show the panel"')
    // The chat column carries no header row of its own.
    expect(html.slice(chat)).not.toContain('One transcript per feature')
    expect(html.slice(chat)).not.toContain('End session')
    // The chat alone: no panel is open by itself.
    expect(html).not.toContain('data-panel')
  })

  it.each(PHASES)('carries at most one action button in the header at %s, and never Go', (phase) => {
    const header = headerOf(page(phase))
    // Every button in the row, by its accessible name or text.
    const buttons = [...header.matchAll(/<button[^>]*>/g)].map((m) => m[0])
    const chrome = buttons.filter((b) => /aria-label="(Chat session|Feature actions|Show the panel|Hide the panel|Show sidebar)"/.test(b))
    expect(buttons.length - chrome.length).toBeLessThanOrEqual(1)
    expect(header).not.toMatch(/>Go</)
    expect(header).not.toContain('Go anyway')
  })

  it('says the quiet status in planning, with Merge & ship as the one button since the resolver offers it', () => {
    const header = headerOf(page('planning', { feature: { lap: 1, ticketsReadyLap: null } }))
    expect(header).toContain('Planning with you')
    expect(header).toContain('Merge &amp; ship')
  })

  it('has no button per panel view in the header: no Plan, Tickets, Preview or Design buttons', () => {
    for (const html of [page('planning', { preview: true }), page('review')]) {
      const header = headerOf(html)
      expect(header).not.toMatch(/(Plan|Tickets|Preview|Design|Review|Details)<\/button>/)
    }
  })

  it('opens the panel beside the chat, and floats it over the chat below ~1100px', () => {
    const html = page('planning', { view: 'details' })
    expect(html).toContain('data-panel')
    expect(html).toContain('@max-[1100px]:absolute')
    expect(html).toContain('aria-label="Resize the panel"')
    expect(at(html, 'data-panel')).toBeGreaterThan(at(html, 'data-chat-view'))
  })

  it('marks the panel toggle pressed while the panel is open', () => {
    expect(headerOf(page('planning', { view: 'details' }))).toContain('aria-label="Hide the panel"')
  })

  it('never shows a view this state does not offer, whatever the address says', () => {
    expect(page('planning', { view: 'drive' })).not.toContain('data-panel')
  })

  it("shows a draft's body as the page, with no chat and no panel", () => {
    const html = page('planning', { status: 'draft', view: 'details' })
    expect(html).not.toContain('data-chat-view')
    expect(html).not.toContain('data-feature-strip')
    expect(html).not.toContain('data-panel')
    expect(html).not.toContain('Show the panel')
    expect(html).not.toContain('aria-label="Chat session"')
  })
})

describe('what opens the panel', () => {
  it('opens the run body after a successful Go', () => {
    const onViewChange = vi.fn()
    page('planning', { onViewChange })
    store.mutations.get('feature.go')?.onSuccess?.({}, { featureId: 'f1' })
    expect(onViewChange).toHaveBeenCalledWith('body')
  })

  it('opens the drive after a test drive starts, and not after one stops or is denied', () => {
    const onViewChange = vi.fn()
    page('review', { onViewChange })
    const testDrive = store.mutations.get('feature.testDrive')
    testDrive?.onSuccess?.({ ok: true, branch: 'b' }, { featureId: 'f1', action: 'stop' })
    testDrive?.onSuccess?.({ ok: false }, { featureId: 'f1', action: 'start' })
    expect(onViewChange).not.toHaveBeenCalled()
    testDrive?.onSuccess?.({ ok: true, branch: 'b' }, { featureId: 'f1', action: 'start' })
    expect(onViewChange).toHaveBeenCalledWith('drive')
  })

  it('opens nothing on any other mutation landing', () => {
    const onViewChange = vi.fn()
    page('review', { onViewChange })
    for (const [path, options] of store.mutations) {
      if (path === 'feature.go' || path === 'feature.testDrive') continue
      options.onSuccess?.({ ok: true, files: [], confirmed: true }, { featureId: 'f1' })
    }
    expect(onViewChange).not.toHaveBeenCalled()
  })
})
