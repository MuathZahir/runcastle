// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
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
 * `plan_card` and `design_cards` items drawn from the live record, opening the
 * Plan view, a design, or the Design list. Tier 2: clicks.
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

function server() {
  return fakeTrpc({
    'design.list': () => ({
      designs: [design('cart', 'Cart'), design('menu', 'Menu', { state: 'approved', isNew: false })],
      plan: { isNew: true },
    }),
    'design.planFigures': () => ({ decisions: 22, checkFirst: 3, tickets: null, designs: 2 }),
  })
}

function target(): ThreadCardsTarget {
  return { featureId: 'f1', oneLiner: 'Designs get their own place.', onOpenPlan: vi.fn(), onOpenDesign: vi.fn(), onOpenDesignList: vi.fn() }
}

const thread = (value: ThreadCardsTarget | null) => (
  <ThreadCardsContext.Provider value={value}>
    <ChatThread items={ITEMS} state="idle" footer={null} />
  </ThreadCardsContext.Provider>
)

afterEach(cleanup)

describe('the plan and design cards in a thread', () => {
  it('draws the plan card with its figures, the older one marked, and opens the Plan view', async () => {
    const t = target()
    render(thread(t), { wrapper: server().Wrapper })
    const plans = await screen.findAllByRole('button', { name: 'Open the plan' })
    expect(plans).toHaveLength(2)
    expect(plans[0]!.textContent).toContain('Older version')
    expect(plans[1]!.textContent).toContain('New')
    expect(plans[1]!.textContent).toContain('Designs get their own place.')
    expect(plans[1]!.textContent).toContain('22decisions')
    expect(plans[1]!.textContent).toContain('built by the agent')
    fireEvent.click(plans[1]!)
    expect(t.onOpenPlan).toHaveBeenCalledTimes(1)
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

  it('in an orchestrator chat, draws the cards of the feature each names and opens that feature on its view', async () => {
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
      { wrapper: server().Wrapper },
    )
    const plans = await screen.findAllByRole('button', { name: 'Open the plan' })
    expect(plans).toHaveLength(1)
    expect(plans[0]!.textContent).toContain('The chat owns this one.')
    fireEvent.click(plans[0]!)
    expect(links.openFeature).toHaveBeenCalledWith('f9', 'plan')
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
