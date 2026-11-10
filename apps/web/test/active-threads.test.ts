import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { epicCrumb } from '../src/components/SidebarEpics'
import { HoldMark, SidebarThreadList } from '../src/components/SidebarParts'
import type { FeatureListItem } from '../src/lib/api'
import type { ThreadEntry } from '../src/lib/chat-thread'
import { Crumbs } from '../src/ui/page'
import {
  askingAboutLine,
  featureEpic,
  originFeatures,
  orchestratorLanding,
  threadIsActive,
  WRITTEN_KEEPS_LISTED_MS,
} from '../src/lib/sidebar-threads'
import { listItem } from './fixtures'

const now = 1_000_000_000_000
const DAY = 86_400_000

const thread = (id: string, over: Partial<ThreadEntry> = {}): ThreadEntry => ({
  id,
  title: id,
  role: 'project',
  state: 'idle',
  createdAt: now - 10 * DAY,
  updatedAt: now - 10 * DAY,
  runtime: 'claude-code',
  ...over,
})

const held = (title: string, heldBy: string, over: Partial<FeatureListItem> = {}): FeatureListItem =>
  ({ ...listItem(), id: title, title, heldBy, status: 'active', ...over }) as FeatureListItem

/** A feature cut by chat `chatId` (its origin), held by that chat unless `over` says otherwise. */
const cut = (title: string, chatId: string, over: Partial<FeatureListItem> = {}): FeatureListItem =>
  ({ ...listItem(), id: title, title, chatId, heldBy: chatId, status: 'active', ...over }) as FeatureListItem

const active = (t: ThreadEntry, features: FeatureListItem[] = [], current: string | null = null) =>
  threadIsActive(t, { current, features, now })

describe('which threads the Orchestrator lists', () => {
  it('lists a thread working or asking', () => {
    expect(active(thread('a', { state: 'working' }))).toBe(true)
    expect(active(thread('a', { state: 'waiting' }))).toBe(true)
  })

  it('lists the thread in front', () => {
    expect(active(thread('a'), [], 'a')).toBe(true)
  })

  it('lists a thread the human wrote in, for 24 hours', () => {
    expect(active(thread('a', { lastHumanAt: now - WRITTEN_KEEPS_LISTED_MS + 1 }))).toBe(true)
    expect(active(thread('a', { lastHumanAt: now - WRITTEN_KEEPS_LISTED_MS }))).toBe(false)
  })

  it('lists a thread with words typed and not sent (leaving a new chat must not lose it)', () => {
    const drafted = (id: string) => id === 'a'
    expect(active(thread('a'))).toBe(false)
    expect(threadIsActive(thread('a'), { current: null, features: [], now, drafted })).toBe(true)
    expect(threadIsActive(thread('b'), { current: null, features: [], now, drafted })).toBe(false)
  })

  it('lists a chat that cut a feature in flight or up next, by origin', () => {
    expect(active(thread('a'), [cut('f', 'a')])).toBe(true)
    expect(active(thread('a'), [cut('f', 'a', { status: 'draft', upNext: true })])).toBe(true)
  })

  it('keeps an epic listed while the human runs a feature it cut (decision 16)', () => {
    // Taken by typing: nothing holds it, the origin stays.
    expect(active(thread('a'), [cut('f', 'a', { heldBy: undefined })])).toBe(true)
    expect(originFeatures('a', [cut('f', 'a', { heldBy: undefined })]).map((f) => f.id)).toEqual(['f'])
  })

  it('does not count a hold without the origin: holding is not cutting', () => {
    expect(active(thread('a'), [held('f', 'a')])).toBe(false)
    // Given to another chat, it moves with its origin.
    expect(active(thread('a'), [cut('f', 'b', { heldBy: 'b' })])).toBe(false)
    expect(active(thread('b'), [cut('f', 'b', { heldBy: 'b' })])).toBe(true)
  })

  it('does not count backlog, shipped or archived features, or another chat\'s', () => {
    const features = [
      cut('backlog', 'a', { status: 'draft', upNext: false }),
      cut('shipped', 'a', { status: 'shipped' }),
      cut('archived', 'a', { status: 'archived' }),
      cut('theirs', 'b'),
    ]
    expect(originFeatures('a', features)).toEqual([])
    expect(active(thread('a'), features)).toBe(false)
  })

  it('does not list an idle thread nobody wrote in', () => {
    expect(active(thread('a'))).toBe(false)
  })
})

describe('arriving at the Orchestrator', () => {
  it('opens the active chat that moved last', () => {
    const threads = [
      thread('old', { state: 'working', updatedAt: now - DAY }),
      thread('new', { state: 'working', updatedAt: now - 1 }),
      thread('idle', { updatedAt: now }),
    ]
    expect(orchestratorLanding(threads, [], now)).toEqual({ kind: 'chat', threadId: 'new' })
  })

  it('goes to the Conversations page when chats exist and none is active', () => {
    expect(orchestratorLanding([thread('a')], [], now)).toEqual({ kind: 'conversations' })
  })

  it('has nowhere to go in a project with no chats', () => {
    expect(orchestratorLanding([], [], now)).toEqual({ kind: 'none' })
  })

  it('never picks an old drive chat', () => {
    const threads = [
      thread('s', { role: 'old-drive-chat', state: 'working', updatedAt: now }),
      thread('a'),
    ]
    expect(orchestratorLanding(threads, [], now)).toEqual({ kind: 'conversations' })
  })
})

describe('the epic a feature names (decision 15)', () => {
  const threads = [thread('a', { title: 'Payment System' }), thread('w', { role: 'worker' })]
  const open = vi.fn()

  it('is its origin chat, whoever holds it', () => {
    expect(featureEpic({ chatId: 'a' }, threads)?.id).toBe('a')
    expect(featureEpic({ chatId: 'a', ...{ heldBy: 'other' } }, threads)?.id).toBe('a')
  })

  it('is nothing with no origin chat, one the list lacks, or a chat that is not an epic', () => {
    expect(featureEpic({ chatId: null }, threads)).toBeNull()
    expect(featureEpic({}, threads)).toBeNull()
    expect(featureEpic({ chatId: 'gone' }, threads)).toBeNull()
    expect(featureEpic({ chatId: 'w' }, threads)).toBeNull()
  })

  it('leads the header with the epic glyph and name, and stays after ship', () => {
    const shipped = cut('f', 'a', { status: 'shipped', heldBy: undefined })
    const crumb = epicCrumb(shipped, threads, open)
    expect(crumb).not.toBeNull()
    const html = renderToStaticMarkup(createElement(Crumbs, { items: [crumb!, { label: 'f' }] }))
    expect(html).toContain('Payment System')
    expect(html).not.toContain('Orchestrator')
    ;(crumb!.onClick as () => void)()
    expect(open).toHaveBeenCalledWith('a')
  })

  it('gives a feature with no epic no crumb', () => {
    expect(epicCrumb(listItem({ chatId: null }), threads, open)).toBeNull()
  })
})

describe('the rows', () => {
  const list = (props: Partial<Parameters<typeof SidebarThreadList>[0]>) =>
    renderToStaticMarkup(
      createElement(SidebarThreadList, {
        threads: [thread('a', { updatedAt: now - 3 * DAY }), thread('b', { updatedAt: now - 3 * DAY })],
        current: null,
        onOpen: () => {},
        actionsFor: () => [],
        more: () => {},
        ...props,
      }),
    )

  it('lists what keep says, and counts every thread in the way to the rest', () => {
    const html = list({ keep: (t) => t.id === 'a', markFor: () => null })
    expect(html).toContain('title="a"')
    expect(html).not.toContain('title="b"')
    expect(html).toContain('All 2 chats')
  })

  it('shows no age on a row marked null, and a ring per feature on a holder', () => {
    const noAge = list({ keep: () => true, markFor: () => null })
    expect(noAge).not.toMatch(/[0-9]+d</)
    const features = [held('one', 'a')]
    const rings = list({ keep: () => true, markFor: () => createElement(HoldMark, { features }) })
    expect(rings).toContain('Holds 1 feature')
    expect(rings).not.toMatch(/[0-9]+d</)
  })

  it('stops at three rings, then counts the rest', () => {
    const features = ['one', 'two', 'three', 'four', 'five'].map((t) => held(t, 'a'))
    const html = renderToStaticMarkup(createElement(HoldMark, { features }))
    expect(html).toContain('Holds 5 features')
    expect(html).toContain('+2')
  })

  it('leaves a list with no mark as it was: five rows, ages and all', () => {
    const threads = Array.from({ length: 7 }, (_, i) => thread(`t${i}`, { updatedAt: now - 3 * DAY }))
    const html = list({ threads, more: undefined })
    expect(html).toContain('Show 2 more')
    expect(html).toMatch(/[0-9]+d</)
  })
})

/** every-feature-has-one-owner decisions 8, 17, 30: the chat row names what it asks about, plainly. */
describe('a chat asking about features it owns', () => {
  const features = [held('Export notes', 'a'), held('Sync offline', 'a'), held('Not its own', 'b')]

  it('reads Asking about the first, +N for the rest, only for features it owns', () => {
    expect(askingAboutLine(thread('a', { askingAbout: ['Export notes'] }), features)).toBe('Asking about Export notes')
    expect(askingAboutLine(thread('a', { askingAbout: ['Export notes', 'Not its own', 'Sync offline'] }), features)).toBe('Asking about Export notes +1')
    expect(askingAboutLine(thread('a', { askingAbout: ['Not its own'] }), features)).toBeNull()
    expect(askingAboutLine(thread('a'), features)).toBeNull()
  })

  it('shows the line under the title, with the amber dot the only mark of the question', () => {
    const asking = thread('a', { state: 'waiting', askingAbout: ['Export notes'] })
    const html = renderToStaticMarkup(
      createElement(SidebarThreadList, {
        threads: [asking, thread('b')],
        current: null,
        onOpen: () => {},
        actionsFor: () => [],
        keep: () => true,
        aboutFor: (t) => askingAboutLine(t, features),
      }),
    )
    expect(html).toContain('>Asking about Export notes<')
    expect(html).toContain('title="a — Asking about Export notes"')
    expect(html.match(/aria-label="Waiting for you"/g)).toHaveLength(1)
    expect(html).toContain('title="b"')
  })
})
