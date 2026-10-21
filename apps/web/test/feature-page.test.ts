import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import type { Phase } from '@runcastle/core'
import type { FeatureFull } from '../src/lib/api'
import type { FeatureView } from '../src/lib/routes'
import { full as fixture } from './fixtures'

/**
 * The chat-first feature page (design-mode decisions 4, 5), tier 1: the
 * topbar, the feature strip and the chat in every phase, the panel beside
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
  { view = 'chat' as FeatureView, status = 'active', onViewChange = (_: FeatureView) => undefined, preview = false } = {},
): string {
  const f = fixture({ id: 'f1', phase, status: status as FeatureFull['feature']['status'] })
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

describe('the chat-first feature page', () => {
  it.each(PHASES)('fills the page with the chat under the topbar and the strip at %s, with no tabs', (phase) => {
    const html = page(phase)
    expect(html).not.toContain('role="tab"')
    expect(html).not.toContain('Overview')
    // Topbar, then the strip holding the status line, then the chat.
    const topbar = at(html, '<header')
    const strip = at(html, 'data-feature-strip')
    const chat = at(html, 'data-chat-view')
    expect(topbar).toBeGreaterThan(-1)
    expect(strip).toBeGreaterThan(topbar)
    expect(at(html, 'role="status"')).toBeGreaterThan(strip)
    expect(at(html, 'role="status"')).toBeLessThan(chat)
    // The chat alone: no panel is open by itself.
    expect(html).not.toContain('data-panel')
  })

  it('opens the panel beside the chat, and floats it over the chat below ~1100px', () => {
    const html = page('planning', { view: 'details' })
    expect(html).toContain('data-panel')
    expect(html).toContain('@max-[1100px]:absolute')
    expect(html).toContain('aria-label="Resize the panel"')
    expect(at(html, 'data-panel')).toBeGreaterThan(at(html, 'data-chat-view'))
  })

  it('offers a topbar door per view: the preview only once there is one', () => {
    expect(page('planning')).not.toMatch(/Preview<\/button>/)
    expect(page('planning', { preview: true })).toMatch(/Preview<\/button>/)
    expect(page('planning')).toMatch(/Design<\/button>/)
    expect(page('shipped')).not.toMatch(/Design<\/button>/)
  })

  it('never shows a view this state does not offer, whatever the address says', () => {
    expect(page('planning', { view: 'drive' })).not.toContain('data-panel')
  })

  it("shows a draft's body as the page, with no chat and no panel", () => {
    const html = page('planning', { status: 'draft', view: 'details' })
    expect(html).not.toContain('data-chat-view')
    expect(html).not.toContain('data-feature-strip')
    expect(html).not.toContain('data-panel')
    expect(html).not.toContain('Show details')
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
