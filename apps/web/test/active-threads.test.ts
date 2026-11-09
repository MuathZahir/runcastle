import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { HoldMark, SidebarThreadList } from '../src/components/SidebarParts'
import type { FeatureListItem } from '../src/lib/api'
import type { ThreadEntry } from '../src/lib/chat-thread'
import {
  askingAboutLine,
  featureHolder,
  heldFeatures,
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

  it('lists a thread holding a feature in flight or up next', () => {
    expect(active(thread('a'), [held('f', 'a')])).toBe(true)
    expect(active(thread('a'), [held('f', 'a', { status: 'draft', upNext: true })])).toBe(true)
  })

  it('does not count backlog, shipped or archived holds, or another thread\'s', () => {
    const features = [
      held('backlog', 'a', { status: 'draft', upNext: false }),
      held('shipped', 'a', { status: 'shipped' }),
      held('archived', 'a', { status: 'archived' }),
      held('theirs', 'b'),
    ]
    expect(heldFeatures('a', features)).toEqual([])
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

describe('the thread a feature names', () => {
  const threads = [thread('a')]

  it('is its holder while it has not shipped', () => {
    expect(featureHolder({ status: 'active', heldBy: 'a' }, threads)?.id).toBe('a')
    expect(featureHolder({ status: 'draft', heldBy: 'a' }, threads)?.id).toBe('a')
  })

  it('is nothing once shipped, unheld, or when the list lacks it', () => {
    expect(featureHolder({ status: 'shipped', heldBy: 'a' }, threads)).toBeNull()
    expect(featureHolder({ status: 'active' }, threads)).toBeNull()
    expect(featureHolder({ status: 'active', heldBy: 'gone' }, threads)).toBeNull()
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
