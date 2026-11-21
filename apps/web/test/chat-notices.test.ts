import { describe, expect, it } from 'vitest'
import type { EventRow } from '@runcastle/core'
import { deckReducer, noticeFor, type ChatNotice } from '../src/lib/chat-notices'

let nextId = 1
function ev(type: string, message = '', over: Partial<EventRow> = {}): EventRow {
  return { id: nextId++, projectId: 'p1', featureId: 'f1', ts: 0, type, message, ...over }
}

describe('noticeFor', () => {
  it.each([
    ['tickets.stored', '3 ticket(s) stored'],
    ['ticket.edited', 'ticket 3 content edited (title)'],
    ['ticket.cancelled', 'ticket 3 cancelled'],
    ['ticket.failed', 'ticket 4 failed: typecheck failed'],
    ['run.finished', 'run failed: 4/6 tickets done'],
  ])('reads an old %s as a plain history note opening the History view, never a round to act on', (type, message) => {
    const notice = noticeFor(ev(type, message, { data: { status: 'failed', summary: '4/6 tickets done' } }))
    expect(notice).toMatchObject({
      kind: 'history',
      hue: 'tickets',
      title: 'Ticket history',
      subtitle: message,
      actionLabel: 'View history',
      target: 'work',
    })
    expect(`${notice?.title} ${notice?.actionLabel}`).not.toMatch(/round/i)
  })

  it('maps testdrive.url to "Test drive running" with the url', () => {
    const e = ev('testdrive.url', 'dev server printed http://localhost:4613', {
      data: { url: 'http://localhost:4613' },
    })
    expect(noticeFor(e)).toMatchObject({
      kind: 'drive',
      hue: 'review',
      title: 'Test drive running',
      subtitle: 'http://localhost:4613',
      actionLabel: 'Open',
      target: 'drive',
    })
  })

  it.each([
    ev('review.agentic-minted', 'agentic review minted as ticket 7 for lap 1', { ticketId: 't-rev' }),
    ev('docs.changed', 'docs changed: decisions.md', { data: { files: ['decisions.md'] } }),
    // The Plan view these opened is gone (building-starts-without-a-plan-approval decision 3).
    ev('docs.changed', 'docs changed: spec.md', { data: { files: ['decisions.md', 'spec.md'] } }),
    ev('docs.changed', 'docs changed: preview.html', { data: { files: ['preview.html'] } }),
    ev('docs.changed', 'docs changed'),
    ev('note.created', 'note added'),
    ev('waypoint.resolved', 'waypoint 2 resolved'),
    ev('chat.started', 'chat started'),
    ev('feature.status', 'status → burning'),
    ev('ticket.done', 'ticket 2 done', { ticketId: 't-work' }),
    ev('ticket.done', 'ticket 8 done', { ticketId: 't-ver' }),
    ev('ticket.done', 'ticket 9 done', { ticketId: 'unknown' }),
  ])('raises nothing for $type ($message)', (e) => {
    expect(noticeFor(e)).toBeNull()
  })
})

function n(kind: ChatNotice['kind'], subtitle: string = kind, eventId = 0): ChatNotice {
  return {
    kind,
    hue: 'review',
    title: kind,
    subtitle,
    actionLabel: 'View',
    target: 'work',
    count: 1,
    eventId,
  }
}

describe('deckReducer', () => {
  function pushAll(...notices: ChatNotice[]): ChatNotice[] {
    return notices.reduce<ChatNotice[]>((deck, notice) => deckReducer(deck, { type: 'push', notice }), [])
  }

  it('keeps notices newest first', () => {
    expect(pushAll(n('history'), n('drive')).map((x) => x.kind)).toEqual(['drive', 'history'])
  })

  it('collapses a repeated kind into one card: count up, new subtitle, moved to front', () => {
    const deck = pushAll(n('history', '6 ticket(s) stored', 1), n('drive'), n('history', 'ticket 3 cancelled', 3))
    expect(deck).toHaveLength(2)
    expect(deck[0]).toMatchObject({ kind: 'history', count: 2, subtitle: 'ticket 3 cancelled', eventId: 3 })
    expect(deck[1].kind).toBe('drive')
  })

  it('removes a card on dismiss and on act', () => {
    const deck = pushAll(n('history'), n('drive'))
    expect(deckReducer(deck, { type: 'dismiss', kind: 'history' }).map((x) => x.kind)).toEqual(['drive'])
    expect(deckReducer(deck, { type: 'act', kind: 'drive' }).map((x) => x.kind)).toEqual(['history'])
  })
})
