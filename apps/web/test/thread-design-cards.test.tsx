// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DesignEntry } from '@runcastle/core'
import { ChatThread } from '../src/components/chat/thread/ChatThread'
import { ThreadCardsContext, type ThreadCardsTarget } from '../src/components/design/ThreadCards'
import { FeatureLinksContext, type FeatureLinks } from '../src/components/chat/thread/FeatureCardItems'
import { listItem } from './fixtures'
import type { ThreadItem } from '../src/lib/chat-thread'
import { fakeTrpc } from './fake-trpc'

/**
 * The plan and design cards in a feature's chat
 * (designs-and-the-plan-get-their-own-place decisions 2, 4, 5, 19): the fold's
 * `design_cards` items drawn from the live record, opening a design or the
 * Design list; and an old chat's `plan_card`, a small "Plan page" card that
 * opens the feature's plan page, or its Details when it has none
 * (building-starts-without-a-plan-approval decision 6). Tier 2: clicks.
 */

const design = (id: string, title: string, over: Partial<DesignEntry> = {}): DesignEntry => ({
  id,
  title,
  path: `/preview/${id}.html`,
  state: 'waiting',
  isNew: true,
  shownAt: 1,
  report: null,
  ...over,
})

const ITEMS: ThreadItem[] = [
  { kind: 'plan_card', id: 'plan_card:1', older: true },
  { kind: 'plan_card', id: 'plan_card:2' },
  { kind: 'design_cards', id: 'design_cards:3', designIds: ['cart', 'menu'], older: ['menu'] },
]

/** The features that have a plan page; any other has none (`FeatureFull.preview` null). */
function server(withPage: readonly string[] = ['f1']) {
  return fakeTrpc({
    'design.list': () => ({
      designs: [design('cart', 'Cart'), design('menu', 'Menu', { state: 'approved', isNew: false })],
    }),
    'feature.get': ({ id }: { id: string }) => ({
      feature: { id, title: `Feature ${id}` },
      preview: withPage.includes(id) ? { relPath: 'preview.html', updatedAt: 1 } : null,
    }),
    'docs.read': () => ({ content: '<!doctype html><p>the plan page</p>' }),
  })
}

function target(): ThreadCardsTarget {
  return { featureId: 'f1', onOpenDetails: vi.fn(), onOpenDesign: vi.fn(), onOpenDesignList: vi.fn() }
}

const thread = (value: ThreadCardsTarget | null) => (
  <ThreadCardsContext.Provider value={value}>
    <ChatThread items={ITEMS} state="idle" footer={null} />
  </ThreadCardsContext.Provider>
)

afterEach(cleanup)

describe('the plan and design cards in a thread', () => {
  it('draws an old plan card as a small "Plan page" card, the older one marked, that opens the plan page full window', async () => {
    const t = target()
    render(thread(t), { wrapper: server().Wrapper })
    const plans = await screen.findAllByRole('button', { name: 'Open the plan page' })
    expect(plans).toHaveLength(2)
    expect(plans[0]!.textContent).toContain('Older version')
    expect(plans[1]!.textContent).toContain('Plan page')
    expect(plans[1]!.textContent).not.toContain('New')
    expect(plans[1]!.textContent).not.toContain('decisions')
    // In the feature's own chat the card need not name it.
    expect(plans[1]!.textContent).not.toContain('Feature f1')
    fireEvent.click(plans[1]!)
    const dialog = await screen.findByRole('dialog', { name: 'Plan page' })
    const frame = await waitFor(() => {
      const found = dialog.querySelector('iframe')
      expect(found).not.toBeNull()
      return found!
    })
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts')
    expect(frame.getAttribute('srcdoc')).toContain('the plan page')
    expect(t.onOpenDetails).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('opens the Details view from an old plan card when the feature has no plan page', async () => {
    const t = target()
    render(thread(t), { wrapper: server([]).Wrapper })
    const plans = await screen.findAllByRole('button', { name: 'Open the plan page' })
    fireEvent.click(plans[1]!)
    expect(t.onOpenDetails).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('draws the group of design cards from the record, opening a design by its page and the list from the group', async () => {
    const t = target()
    render(thread(t), { wrapper: server().Wrapper })
    fireEvent.click(await screen.findByRole('button', { name: 'Open the design Cart' }))
    expect(t.onOpenDesign).toHaveBeenCalledWith('/preview/cart.html')
    expect(screen.getByRole('button', { name: 'Open the design Menu' }).textContent).toContain('Older version')
    expect(screen.getByText('1 of 2 approved')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Design tab/ }))
    expect(t.onOpenDesignList).toHaveBeenCalledTimes(1)
  })

  it('in an orchestrator chat, draws the cards of the feature each names, the plan card saying which, and opens that feature on its view', async () => {
    const links: FeatureLinks = {
      features: [{ ...listItem({ id: 'f9', slug: 'f9-slug' }), oneLiner: 'The chat owns this one.' }],
      openFeature: vi.fn(),
    }
    const items: ThreadItem[] = [
      { kind: 'plan_card', id: 'plan_card:1', featureId: 'f9' },
      { kind: 'design_cards', id: 'design_cards:2', designIds: ['cart'], older: [], featureId: 'f9' },
      // A card naming a feature the list does not hold draws nothing.
      { kind: 'plan_card', id: 'plan_card:3', featureId: 'gone' },
    ]
    render(
      <FeatureLinksContext.Provider value={links}>
        <ChatThread items={items} state="idle" footer={null} />
      </FeatureLinksContext.Provider>,
      { wrapper: server([]).Wrapper },
    )
    const plans = await screen.findAllByRole('button', { name: 'Open the plan page of Feature f9' })
    expect(plans).toHaveLength(1)
    expect(plans[0]!.textContent).toContain('Feature f9')
    fireEvent.click(plans[0]!)
    expect(links.openFeature).toHaveBeenCalledWith('f9', 'details')
    fireEvent.click(await screen.findByRole('button', { name: 'Open the design Cart' }))
    expect(links.openFeature).toHaveBeenCalledWith('f9', 'design')
  })

  it('draws nothing for them in a thread outside a feature page', async () => {
    const api = server()
    render(thread(null), { wrapper: api.Wrapper })
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.queryByRole('button', { name: /Open the/ })).toBeNull()
    expect(api.calls).toEqual([])
  })
})
