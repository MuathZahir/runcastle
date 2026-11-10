import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SidebarEpics } from '../src/components/SidebarEpics'
import type { FeatureListItem } from '../src/lib/api'
import type { ThreadEntry } from '../src/lib/chat-thread'
import {
  asksAboutOf,
  epicHolder,
  epicNameOf,
  epicOwnerJoin,
  epicsFrom,
  nestedFeatureWords,
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
  ...over,
})

/** A feature cut by `chatId`, run by that chat unless `over` says otherwise. */
const feature = (id: string, chatId: string | null, over: Partial<FeatureListItem> = {}): FeatureListItem =>
  ({ ...listItem({ id }), title: id, chatId, heldBy: chatId ?? undefined, ...over }) as FeatureListItem

const asking = (words: string) => need('answer', words)
const everyone = () => true

describe('membership (decisions 6, 7)', () => {
  const pay = chat('pay', 'Payment System', { createdAt: 2 })
  const ship = chat('ship', 'Shipping', { createdAt: 1 })

  it('nests a feature under the chat it came from, whoever runs it', () => {
    const features = [
      feature('mine', 'pay'),
      feature('taken', 'pay', { heldBy: undefined }),
      feature('lent', 'pay', { heldBy: 'ship' }),
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

  it('says who runs each: its epic, you, or another chat by name', () => {
    expect(epicHolder({ heldBy: 'pay' }, 'pay', [pay, ship])).toEqual({ kind: 'epic' })
    expect(epicHolder({}, 'pay', [pay, ship])).toEqual({ kind: 'you' })
    expect(epicHolder({ heldBy: 'ship' }, 'pay', [pay, ship])).toEqual({ kind: 'chat', title: 'Shipping' })
  })
})

describe('the order (decision 8)', () => {
  const quiet = chat('quiet', 'Quiet', { createdAt: 3 })
  const asks = chat('asks', 'Asks', { createdAt: 1, state: 'waiting' })
  const needs = chat('needs', 'Needs', { createdAt: 2 })

  it('puts epics with something yellow first, the rest newest started first', () => {
    const features = [feature('wants', 'needs', { need: asking('Needs your answer') })]
    const { epics, other } = epicsFrom([quiet, asks, needs], features, everyone)
    const groups = orderEpicList(epics, other)
    expect(groups.map((g) => (g.kind === 'epic' ? g.epic.chat.id : 'other'))).toEqual(['needs', 'asks', 'quiet'])
  })

  it('floats Other features with the yellow epics only when something in it is yellow', () => {
    const calm = orderEpicList(epicsFrom([quiet, asks], [feature('loose', null)], everyone).epics, [feature('loose', null)])
    expect(calm.map((g) => (g.kind === 'epic' ? g.epic.chat.id : 'other'))).toEqual(['asks', 'quiet', 'other'])
    const loud = [feature('loose', null, { need: asking('Needs your answer') })]
    const lit = orderEpicList(epicsFrom([quiet, asks], loud, everyone).epics, loud)
    expect(lit.map((g) => (g.kind === 'epic' ? g.epic.chat.id : 'other'))).toEqual(['asks', 'other', 'quiet'])
  })

  it('puts the features that need you first inside an epic', () => {
    const features = [feature('calm', 'quiet'), feature('wants', 'quiet', { need: asking('Needs your answer') })]
    const [group] = orderEpicList(epicsFrom([quiet], features, everyone).epics)
    expect(group?.kind === 'epic' && group.epic.features.map((x) => x.feature.id)).toEqual(['wants', 'calm'])
  })
})

describe('the nested words (decision 10)', () => {
  it('reads its epic chat\'s question as "Question above"', () => {
    expect(nestedFeatureWords('With Payment System · asking you', { kind: 'epic' }, 'Payment System')).toBe('Question above')
    expect(nestedFeatureWords('Agent working', { kind: 'epic' }, 'Payment System')).toBe('Agent working')
  })

  it('keeps "With <its epic> ·" on any other need its chat holds, so it never reads as the human\'s to do', () => {
    expect(nestedFeatureWords('With Payment System · Plan to approve', { kind: 'epic' }, 'Payment System')).toBe(
      'With Payment System · Plan to approve',
    )
    expect(nestedFeatureWords('With Payment System · Needs your answer', { kind: 'epic' }, 'Payment System')).toBe(
      'With Payment System · Needs your answer',
    )
  })

  it('says "Yours · …" for a feature the human runs', () => {
    expect(nestedFeatureWords('In progress', { kind: 'you' }, 'Payment System')).toBe('Yours · In progress')
  })

  it('says "Asking above · …" for a feature of yours consulting its epic, whatever the case', () => {
    expect(nestedFeatureWords('Asking Payment System · which retry policy?', { kind: 'you' }, 'Payment System')).toBe(
      'Asking above · which retry policy?',
    )
    expect(nestedFeatureWords('Asking payment system · which retry policy?', { kind: 'you' }, 'Payment System')).toBe(
      'Asking above · which retry policy?',
    )
  })

  it('names a different chat that runs it', () => {
    expect(nestedFeatureWords('With Shipping · Agent working', { kind: 'chat', title: 'Shipping' }, 'Payment System')).toBe(
      'With Shipping · Agent working',
    )
  })
})

describe('what an epic asks about (decision 11)', () => {
  const features = [feature('a', 'pay', { title: 'Retry policy' }), feature('b', 'pay', { title: 'Refunds' }), feature('c', 'pay', { title: 'Receipts' })]
  const waiting = (askingAbout?: string[]) =>
    ({ ...chat('pay', 'Payment System', { state: 'waiting' }), ...(askingAbout ? { askingAbout } : {}) }) as ThreadEntry

  it('names the feature, then "+N" for the rest', () => {
    expect(asksAboutOf(waiting(['a']), features)).toBe('Retry policy')
    expect(asksAboutOf(waiting(['a', 'b', 'c']), features)).toBe('Retry policy +2')
  })

  it('is nothing when the question names no feature, or the chat is not asking', () => {
    expect(asksAboutOf(waiting(), features)).toBeNull()
    expect(asksAboutOf(waiting([]), features)).toBeNull()
    expect(asksAboutOf({ ...waiting(['a']), state: 'working' }, features)).toBeNull()
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
        onNewEpic: () => {},
        onAllEpics: () => {},
      }),
    )
  const pay = chat('pay', 'Payment System', { state: 'waiting' })
  const ship = chat('ship', 'Shipping')

  it('is headed "Epics" with a "New epic" plus, and ends in "All N epics"', () => {
    const html = render(epicsFrom([pay, ship], [], everyone).epics, [], 7)
    expect(html).toContain('>Epics<')
    expect(html).toContain('aria-label="New epic"')
    expect(html).toContain('All 7 epics')
    expect(html).not.toContain('Orchestrator')
  })

  it('draws an asking epic amber with "Asking about <feature> +N"', () => {
    const features = [feature('a', 'pay', { title: 'Retry policy' }), feature('b', 'pay', { title: 'Refunds' })]
    const asks = { ...pay, askingAbout: ['a', 'b'] } as ThreadEntry
    const html = render(epicsFrom([asks], features, everyone).epics)
    expect(html).toContain('Asking about Retry policy +1')
    expect(html).toContain('bg-warning')
  })

  it('still draws a waiting epic amber, reading "Asking you", when its question names no feature', () => {
    const html = render(epicsFrom([pay], [], everyone).epics)
    expect(html).toContain('Asking you')
    expect(html).toContain('bg-warning')
  })

  it('nests the features, with "Yours" and "With <chat>" rows, then Other features', () => {
    const features = [
      feature('Retry policy', 'pay', { heldBy: undefined }),
      feature('Labels', 'pay', { heldBy: 'ship', need: need('answer', 'With Shipping · Agent working', { held: true }) }),
      feature('Loose', null, { heldBy: undefined }),
    ]
    const { epics, other } = epicsFrom([pay, ship], features, everyone)
    const html = render(epics, other)
    expect(html).toContain('role="group" aria-label="Payment System"')
    expect(html).toContain('Yours · In progress')
    expect(html).toContain('With Shipping · Agent working')
    expect(html).toContain('Other features')
    expect(html.indexOf('Payment System')).toBeLessThan(html.indexOf('Other features'))
  })
})

describe('the header joins the epic and its owner (decision 15, changed by the orchestrator)', () => {
  const chat = (id: string, holder = true) => ({ owner: { kind: 'chat' as const }, chatId: id, ...(holder ? { holderId: id } : {}) })

  it('is one crumb when the epic chat owns it, held or still being planned', () => {
    expect(epicOwnerJoin('a', chat('a'))).toBe('one')
    expect(epicOwnerJoin('a', chat('a', false))).toBe('one')
  })

  it('is two when the human or another chat owns it', () => {
    expect(epicOwnerJoin('a', { owner: { kind: 'you' }, chatId: 'a' })).toBe('two')
    expect(epicOwnerJoin('a', chat('b'))).toBe('two')
  })

  it('is the owner alone with no epic', () => {
    expect(epicOwnerJoin(null, chat('a'))).toBe('owner')
    expect(epicOwnerJoin(null, { owner: { kind: 'you' } })).toBe('owner')
  })
})
