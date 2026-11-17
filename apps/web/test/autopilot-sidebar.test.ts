import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SidebarEpics } from '../src/components/SidebarEpics'
import { featureStateWords } from '../src/components/SidebarParts'
import type { FeatureListItem } from '../src/lib/api'
import type { ThreadEntry } from '../src/lib/chat-thread'
import { epicIsYellow, epicsFrom } from '../src/lib/feature-ui/epics'
import { listItem, need, withFoldsOpen } from './fixtures'

/**
 * The sidebar on autopilot (docs/features/epics-on-autopilot decisions 7, 14,
 * 17; the design page "Sidebar on autopilot"): an epic on autopilot wears the
 * Moving edge and the mark after its title; its locked rows wear the lock and
 * say Working, Idle or Merged, never Needs you — the epic's row carries its
 * own need. Tier 1: the markup is the whole behaviour.
 */

const chat = (id: string, title: string, over: Partial<ThreadEntry> = {}): ThreadEntry => ({
  id,
  title,
  role: 'project',
  state: 'idle',
  createdAt: 0,
  updatedAt: 0,
  runtime: 'claude-code',
  need: null,
  ...over,
})

const locked = (epicId: string, epicName: string) => ({ autopilot: { epicId, epicName } })

const feature = (id: string, chatId: string, over: Partial<FeatureListItem> = {}): FeatureListItem =>
  ({ ...listItem({ id }), title: id, chatId, autopilot: null, ...over }) as FeatureListItem

const everyone = () => true

function render(chats: ThreadEntry[], features: FeatureListItem[]): string {
  return renderToStaticMarkup(
    createElement(SidebarEpics, {
      epics: epicsFrom(chats, features, everyone).epics,
      total: chats.length,
      currentChat: null,
      currentFeature: null,
      onOpenEpic: () => {},
      onSelectFeature: () => {},
      onAllEpics: () => {},
    }),
  )
}

/** The markup of one epic's card, from its `data-epic` head to the next card. */
function card(html: string, epicId: string): string {
  const head = html.indexOf(`<div data-epic="${epicId}"`)
  // The card is the element that opens just before its head.
  const start = html.lastIndexOf('<div', head - 1)
  const next = html.indexOf('<div data-epic=', head + 1)
  return html.slice(start, next < 0 ? undefined : next)
}

describe('epicsFrom reads autopilot off the wire', () => {
  it('marks the epic on autopilot and each feature the server says is locked', () => {
    const pay = chat('pay', 'Checkout flow', { autopilot: true })
    const ship = chat('ship', 'Shipping')
    const { epics } = epicsFrom(
      [pay, ship],
      [feature('a', 'pay', locked('pay', 'Checkout flow')), feature('b', 'ship')],
      everyone,
    )
    const byId = (id: string) => epics.find((e) => e.chat.id === id)!
    expect(byId('pay').autopilot).toBe(true)
    expect(byId('pay').features.map((x) => x.locked)).toEqual([true])
    expect(byId('ship').autopilot).toBe(false)
    expect(byId('ship').features.map((x) => x.locked)).toEqual([false])
  })

  it('takes a locked feature’s need for the epic’s: only the chat’s own makes it yellow', () => {
    const pay = chat('pay', 'Checkout flow', { autopilot: true })
    const asking = feature('a', 'pay', { ...locked('pay', 'Checkout flow'), status: 'active', need: need('Design to approve') })
    expect(epicIsYellow(epicsFrom([pay], [asking], everyone).epics[0]!)).toBe(false)
    const waits = { ...pay, need: need('Card fees or a flat price?', { threadId: 'pay' }) }
    expect(epicIsYellow(epicsFrom([waits], [asking], everyone).epics[0]!)).toBe(true)
  })
})

describe('the epic card on autopilot', () => {
  const on = chat('pay', 'Checkout flow', { autopilot: true, state: 'working', color: 'violet' })
  const off = chat('ship', 'Shipping', { state: 'working' })
  const html = render(
    [on, off],
    [
      feature('Checkout page', 'pay', { ...locked('pay', 'Checkout flow'), working: true }),
      feature('Handoff notes', 'ship', { working: true }),
    ],
  )

  it('wears the Moving edge, working, and the Autopilot mark after its title', () => {
    const c = card(html, 'pay')
    expect(c).toContain('data-autopilot=""')
    expect(c).toContain('data-autopilot-state="working"')
    expect(c).toContain('autopilot-edge')
    expect(c.indexOf('Checkout flow')).toBeLessThan(c.indexOf('>Autopilot<'))
  })

  it('leaves an ordinary epic plain', () => {
    const c = card(html, 'ship')
    expect(c).not.toContain('data-autopilot')
    expect(c).not.toContain('autopilot-edge')
    expect(c).not.toContain('>Autopilot<')
  })

  it('stops the light while the epic waits on you, and lights its own amber dot', () => {
    const waits = { ...on, state: 'waiting' as const, need: need('Card fees or a flat price?', { threadId: 'pay' }) }
    const c = card(render([waits], [feature('Checkout page', 'pay', { ...locked('pay', 'Checkout flow'), working: true })]), 'pay')
    expect(c).toContain('data-autopilot-state="asking"')
    expect(c).toContain('Needs you · Card fees or a flat price?')
  })
})

describe('a locked feature row', () => {
  const on = chat('pay', 'Checkout flow', { autopilot: true, state: 'working' })
  const lock = locked('pay', 'Checkout flow')

  it('folds with the rest, and opened wears the lock with no status words', () => {
    const features = [feature('Checkout page', 'pay', { ...lock, working: true })]
    expect(render([on], features)).toContain('>1 working<')
    const html = withFoldsOpen(() => render([on], features))
    expect(html).toContain('aria-label="On autopilot"')
    expect(html).toContain('title="Checkout page — on autopilot')
    expect(html).not.toContain('>Working<')
  })

  it('never needs you, even with a need of its own on the wire', () => {
    const features = [feature('Saved cards', 'pay', { ...lock, status: 'active', need: need('Design to approve') })]
    const html = withFoldsOpen(() => render([on], features))
    expect(html).toContain('>1 idle<')
    expect(html).not.toContain('Design to approve')
    expect(html).not.toContain('data-needs-you')
    expect(html).not.toContain('needs you"')
  })

  it('a feature left for the grill sits locked and idle with the rest (decision 14)', () => {
    const features = [feature('Checkout page', 'pay', { ...lock, working: true }), feature('Refunds', 'pay', lock)]
    expect(render([on], features)).toContain('>1 working · 1 idle<')
    expect(withFoldsOpen(() => render([on], features)).match(/aria-label="On autopilot"/g)).toHaveLength(2)
  })

  it('a feature off autopilot keeps its own needs-you row and no lock', () => {
    const off = chat('ship', 'Shipping')
    const html = render([off], [feature('Status chip', 'ship', { status: 'active', need: need('Design to approve') })])
    expect(html).not.toContain('aria-label="On autopilot"')
    expect(html).toContain('data-needs-you=""')
    expect(html).toContain('title="Status chip — Design to approve')
  })

  it('the words: Merged once shipped, Working or Idle otherwise', () => {
    expect(featureStateWords(feature('x', 'pay', { status: 'shipped' }), true)).toBe('Merged')
    expect(featureStateWords(feature('x', 'pay', { working: true }), true)).toBe('Working')
    expect(featureStateWords(feature('x', 'pay', { need: need('Plan to approve') }), true)).toBe('Idle')
  })
})
