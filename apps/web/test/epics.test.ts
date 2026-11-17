import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SidebarEpics } from '../src/components/SidebarEpics'
import type { FeatureListItem } from '../src/lib/api'
import type { ThreadEntry } from '../src/lib/chat-thread'
import {
  epicNameOf,
  epicsFrom,
  orderEpicList,
  shelfFeatureWords,
  type Epic,
} from '../src/lib/feature-ui/epics'
import { listItem, need } from './fixtures'

/**
 * The sidebar as a list of epics (docs/features/orchestrator-chats-become-epics):
 * membership by origin chat, Other features, yellow first, the nested words,
 * and the list drawn as static markup (tier 1).
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

/** A feature cut by `chatId`. */
const feature = (id: string, chatId: string | null, over: Partial<FeatureListItem> = {}): FeatureListItem =>
  ({ ...listItem({ id }), title: id, chatId, ...over }) as FeatureListItem

const asking = (why: string) => need(why)
const everyone = () => true

describe('membership (decisions 6, 7)', () => {
  const pay = chat('pay', 'Payment System', { createdAt: 2 })
  const ship = chat('ship', 'Shipping', { createdAt: 1 })

  it('nests a feature under the chat it came from, whoever runs it', () => {
    const features = [
      feature('mine', 'pay'),
      feature('taken', 'pay'),
      feature('lent', 'pay', { autopilot: { epicId: 'pay', epicName: 'Payment System' } }),
    ]
    const { epics, other } = epicsFrom([pay, ship], features, everyone)
    expect(epics.find((e) => e.chat.id === 'pay')?.features.map((x) => x.feature.id)).toEqual(['mine', 'taken', 'lent'])
    expect(epics.find((e) => e.chat.id === 'ship')?.features).toEqual([])
    expect(other).toEqual([])
  })

  it('sends a feature with no origin chat, or one not listed, to Other features', () => {
    const features = [feature('loose', null), feature('lost', 'gone'), feature('quiet', 'ship')]
    const { epics, other } = epicsFrom([pay, ship], features, (t) => t.id === 'pay')
    expect(epics.map((e) => e.chat.id)).toEqual(['pay'])
    expect(other.map((f) => f.id)).toEqual(['loose', 'lost', 'quiet'])
  })

  it('makes only orchestrator chats epics', () => {
    const { epics } = epicsFrom([pay, chat('w', 'A worker', { role: 'worker' })], [], everyone)
    expect(epics.map((e) => e.chat.id)).toEqual(['pay'])
  })

  it('leaves parked, shipped and archived features to the shelves (decision 9)', () => {
    const features = [
      feature('parked', 'pay', { status: 'draft', upNext: false }),
      feature('next', 'pay', { status: 'draft', upNext: true }),
      feature('done', 'pay', { status: 'shipped' }),
      feature('gone', null, { status: 'archived' }),
    ]
    const { epics, other } = epicsFrom([pay], features, everyone)
    expect(epics[0]!.features.map((x) => x.feature.id)).toEqual(['next'])
    expect(other).toEqual([])
  })

  it('counts what each epic shipped from the list the shelves read (epics-that-look-alive decision 4)', () => {
    const features = [
      feature('done', 'pay', { status: 'shipped' }),
      feature('done too', 'pay', { status: 'shipped' }),
      feature('elsewhere', 'ship', { status: 'shipped' }),
      feature('loose', null, { status: 'shipped' }),
      feature('moving', 'pay'),
      feature('gone', 'pay', { status: 'archived' }),
    ]
    const { epics } = epicsFrom([pay, ship], features, everyone)
    expect(epics.map((e) => [e.chat.id, e.shipped])).toEqual([
      ['pay', 2],
      ['ship', 1],
    ])
  })

  it("takes each epic's colour and icon from its chat, none while unset", () => {
    const { epics } = epicsFrom([{ ...pay, color: 'rose', icon: 'rocket' }, ship], [], everyone)
    expect(epics.map((e) => [e.color, e.icon])).toEqual([
      ['rose', 'rocket'],
      [null, null],
    ])
  })
})

describe('the order (decision 8)', () => {
  const quiet = chat('quiet', 'Quiet', { createdAt: 3 })
  const asks = chat('asks', 'Asks', { createdAt: 1, need: need('Which provider?', { threadId: 'asks' }) })
  const needs = chat('needs', 'Needs', { createdAt: 2 })

  it('puts epics with something yellow first, the rest newest started first', () => {
    const features = [feature('wants', 'needs', { need: asking('Which retry policy?') })]
    const { epics, other } = epicsFrom([quiet, asks, needs], features, everyone)
    const groups = orderEpicList(epics, other)
    expect(groups.map((g) => (g.kind === 'epic' ? g.epic.chat.id : 'other'))).toEqual(['needs', 'asks', 'quiet'])
  })

  it('puts epics in motion above idle ones, even when the idle one is newer', () => {
    const working = chat('working', 'Working', { createdAt: 1, state: 'working' })
    const groups = orderEpicList(epicsFrom([quiet, working], [], everyone).epics, [])
    expect(groups.map((g) => (g.kind === 'epic' ? g.epic.chat.id : 'other'))).toEqual(['working', 'quiet'])
  })

  it('floats Other features with the yellow epics only when something in it is yellow', () => {
    const calm = orderEpicList(epicsFrom([quiet, asks], [feature('loose', null)], everyone).epics, [feature('loose', null)])
    // Other features is in motion, so it sits above an idle epic either way.
    expect(calm.map((g) => (g.kind === 'epic' ? g.epic.chat.id : 'other'))).toEqual(['asks', 'other', 'quiet'])
    const loud = [feature('loose', null, { need: asking('Which retry policy?') })]
    const lit = orderEpicList(epicsFrom([quiet, asks], loud, everyone).epics, loud)
    expect(lit.map((g) => (g.kind === 'epic' ? g.epic.chat.id : 'other'))).toEqual(['asks', 'other', 'quiet'])
  })

  it('puts the features that need you first inside an epic', () => {
    const features = [feature('calm', 'quiet'), feature('wants', 'quiet', { need: asking('Which retry policy?') })]
    const [group] = orderEpicList(epicsFrom([quiet], features, everyone).epics)
    expect(group?.kind === 'epic' && group.epic.features.map((x) => x.feature.id)).toEqual(['wants', 'calm'])
  })
})

describe('the shelves name their epic (decision 21)', () => {
  const chats = [chat('pay', 'Payment System')]
  it('reads the epic quietly, or nothing with no epic', () => {
    const shipped = feature('s', 'pay', { status: 'shipped' })
    expect(epicNameOf(shipped, chats)).toBe('Payment System')
    expect(shelfFeatureWords(shipped, 'Shipped', epicNameOf(shipped, chats))).toBe('Payment System')
    const loose = feature('l', null, { status: 'draft' })
    expect(shelfFeatureWords(loose, 'Ready to start', epicNameOf(loose, chats))).toBe('Ready to start')
  })
})

describe('the list (SidebarEpics, static markup)', () => {
  const render = (epics: Epic[], other: FeatureListItem[] = [], total = epics.length) =>
    renderToStaticMarkup(
      createElement(SidebarEpics, {
        epics,
        other,
        total,
        currentChat: null,
        currentFeature: null,
        onOpenEpic: () => {},
        onSelectFeature: () => {},
        onAllEpics: () => {},
      }),
    )
  const pay = chat('pay', 'Payment System', { need: need('Which provider first?', { threadId: 'pay' }) })
  const ship = chat('ship', 'Shipping')

  it('has no heading of its own, and ends in "All N epics"', () => {
    const html = render(epicsFrom([pay, ship], [], everyone).epics, [], 7)
    expect(html).not.toContain('>Epics<')
    expect(html).toContain('All 7 epics')
    expect(html).not.toContain('Orchestrator')
  })

  it('tops the list with the dotted New epic slot, open with "Not sent yet" while the new epic is in front (epics-that-look-alive decision 5)', () => {
    const slot = (open: boolean) =>
      renderToStaticMarkup(
        createElement(SidebarEpics, {
          epics: epicsFrom([pay], [], everyone).epics,
          total: 1,
          currentChat: null,
          currentFeature: null,
          onOpenEpic: () => {},
          onSelectFeature: () => {},
          onAllEpics: () => {},
          onNewEpic: () => {},
          newEpicOpen: open,
        }),
      )
    const closed = slot(false)
    expect(closed).toContain('border-dashed')
    expect(closed.indexOf('New epic')).toBeLessThan(closed.indexOf('Payment System'))
    expect(closed).not.toContain('Not sent yet')
    expect(slot(true)).toContain('Not sent yet')
    expect(render(epicsFrom([pay], [], everyone).epics)).not.toContain('New epic')
  })

  it("paints each epic in its colour and icon, an idle one as a tinted slim row with what it shipped", () => {
    const idle = chat('idle', 'Old Work', { color: 'rust', icon: 'wrench', updatedAt: Date.now() - 2 * 3600_000 })
    const features = [feature('done', 'idle', { status: 'shipped' }), feature('also', 'idle', { status: 'shipped' })]
    const html = render(epicsFrom([pay, idle], features, everyone).epics)
    expect(html).toContain('--color-epic-rust')
    expect(html).toContain('lucide-wrench')
    expect(html).toContain('2 shipped')
    // The asking epic, with no colour or icon yet: blue, and the default chat bubble.
    expect(html).toContain('--color-epic-blue')
    expect(html).toMatch(/lucide-message-square/)
  })

  it('marks an epic whose chat needs you with a question in its head, its agent’s line on hover (a-calmer-sidebar decision 10)', () => {
    const html = render(epicsFrom([pay], [], everyone).epics)
    expect(html).toContain('title="Payment System — Needs you · Which provider first?"')
    expect(html).toContain('aria-label="Asks you"')
    expect(html).not.toContain('bg-warning')
  })

  it('reads a chat that only works or waits on a guess as no need: no amber, no "Asking"', () => {
    const html = render(epicsFrom([chat('w', 'Working epic', { state: 'working' })], [], everyone).epics)
    expect(html).toContain('Working')
    expect(html).not.toContain('bg-warning')
    expect(html).not.toContain('Asking')
  })

  it('folds the features that don’t need you into one line, with no owner prefix, then Other features', () => {
    const features = [
      feature('Retry policy', 'pay'),
      feature('Labels', 'pay', { working: true }),
      feature('Loose', null),
    ]
    const { epics, other } = epicsFrom([pay, ship], features, everyone)
    const html = render(epics, other)
    expect(html).toContain('role="group" aria-label="Payment System"')
    expect(html).toContain('>1 working · 1 idle<')
    expect(html).not.toContain('>Retry policy<')
    expect(html).not.toContain('Yours ·')
    expect(html).not.toContain('With Shipping')
    expect(html).toContain('Other features')
    expect(html.indexOf('Payment System')).toBeLessThan(html.indexOf('Other features'))
  })
})

