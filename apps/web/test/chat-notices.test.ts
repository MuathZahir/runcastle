import { describe, expect, it } from 'vitest'
import type { EventRow } from '@runcastle/core'
import { deckReducer, noticeFor, type ChatNotice, type NoticeTicket } from '../src/lib/chat-notices'

let nextId = 1
function ev(type: string, message = '', over: Partial<EventRow> = {}): EventRow {
  return { id: nextId++, projectId: 'p1', featureId: 'f1', ts: 0, type, message, ...over }
}

const reviewPass: NoticeTicket = { id: 't-rev', kind: 'review', passKind: 'review', title: 'Agentic review — lap 1' }
const verification: NoticeTicket = { id: 't-ver', kind: 'review', passKind: 'verification', title: 'Verification' }
const work: NoticeTicket = { id: 't-work', kind: 'implementation', passKind: 'review', title: 'Build the form' }
const tickets = [reviewPass, verification, work]

describe('noticeFor', () => {
  it('maps a docs.changed naming spec.md to "Spec written" on the planning hue', () => {
    const e = ev('docs.changed', 'docs changed: decisions.md, spec.md', {
      data: { files: ['decisions.md', 'spec.md'] },
    })
    expect(noticeFor(e)).toEqual({
      kind: 'spec',
      hue: 'planning',
      title: 'Spec written',
      subtitle: 'spec.md',
      actionLabel: 'View spec',
      target: 'overview',
      count: 1,
      eventId: e.id,
    })
  })

  it.each(['tickets.stored', 'ticket.edited', 'ticket.cancelled'])(
    'maps %s to "Tickets updated", going to the Tickets tab',
    (type) => {
      expect(noticeFor(ev(type, 'ticket 3 content edited (title)'))).toMatchObject({
        kind: 'tickets',
        hue: 'tickets',
        title: 'Tickets updated',
        subtitle: 'ticket 3 content edited (title)',
        actionLabel: 'View tickets',
        target: 'tickets',
      })
    },
  )

  it('maps ticket.failed to "Ticket #n failed" on danger, with the headline as subtitle', () => {
    expect(noticeFor(ev('ticket.failed', 'ticket 4 failed: typecheck failed'))).toMatchObject({
      kind: 'ticket-failed',
      hue: 'danger',
      title: 'Ticket #4 failed',
      subtitle: 'typecheck failed',
      actionLabel: 'View run',
      target: 'overview',
    })
  })

  it('maps a succeeded run.finished to "Run finished · x of y landed" on the building hue', () => {
    const e = ev('run.finished', 'run succeeded: 6/6 tickets done', {
      data: { status: 'succeeded', summary: '6/6 tickets done' },
    })
    expect(noticeFor(e)).toMatchObject({
      kind: 'run',
      hue: 'building',
      title: 'Run finished',
      subtitle: '6 of 6 landed',
      actionLabel: 'View run',
      target: 'overview',
    })
  })

  it('maps a failed run.finished to "Run finished with failures" on danger', () => {
    const e = ev('run.finished', 'run failed: 4/6 tickets done', {
      data: { status: 'failed', summary: '4/6 tickets done' },
    })
    expect(noticeFor(e)).toMatchObject({
      kind: 'run',
      hue: 'danger',
      title: 'Run finished with failures',
      subtitle: '4 of 6 landed',
      target: 'overview',
    })
  })

  it("maps the lap's review pass finishing to \"Review ready\" on the review hue", () => {
    expect(noticeFor(ev('ticket.done', 'ticket 7 done — 0 commit(s)', { ticketId: 't-rev' }), tickets)).toMatchObject({
      kind: 'review',
      hue: 'review',
      title: 'Review ready',
      subtitle: 'Agentic review — lap 1',
      actionLabel: 'View review',
      target: 'overview',
    })
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
      target: 'overview',
    })
  })

  it.each([
    ev('review.agentic-minted', 'agentic review minted as ticket 7 for lap 1', { ticketId: 't-rev' }),
    ev('docs.changed', 'docs changed: decisions.md', { data: { files: ['decisions.md'] } }),
    ev('docs.changed', 'docs changed'),
    ev('note.created', 'note added'),
    ev('waypoint.resolved', 'waypoint 2 resolved'),
    ev('chat.started', 'chat started'),
    ev('feature.status', 'status → burning'),
    ev('ticket.done', 'ticket 2 done', { ticketId: 't-work' }),
    ev('ticket.done', 'ticket 8 done', { ticketId: 't-ver' }),
    ev('ticket.done', 'ticket 9 done', { ticketId: 'unknown' }),
  ])('raises nothing for $type ($message)', (e) => {
    expect(noticeFor(e, tickets)).toBeNull()
  })
})

function n(kind: ChatNotice['kind'], subtitle: string = kind, eventId = 0): ChatNotice {
  return {
    kind,
    hue: 'review',
    title: kind,
    subtitle,
    actionLabel: 'View',
    target: 'overview',
    count: 1,
    eventId,
  }
}

describe('deckReducer', () => {
  function pushAll(...notices: ChatNotice[]): ChatNotice[] {
    return notices.reduce<ChatNotice[]>((deck, notice) => deckReducer(deck, { type: 'push', notice }), [])
  }

  it('keeps notices newest first', () => {
    expect(pushAll(n('spec'), n('tickets'), n('run')).map((x) => x.kind)).toEqual(['run', 'tickets', 'spec'])
  })

  it('caps at four, dropping the oldest on a fifth distinct kind', () => {
    const deck = pushAll(n('spec'), n('tickets'), n('ticket-failed'), n('run'), n('review'))
    expect(deck.map((x) => x.kind)).toEqual(['review', 'run', 'ticket-failed', 'tickets'])
  })

  it('collapses a repeated kind into one card: count up, new subtitle, moved to front', () => {
    const deck = pushAll(n('tickets', '6 ticket(s) stored', 1), n('run'), n('tickets', 'ticket 3 cancelled', 3))
    expect(deck).toHaveLength(2)
    expect(deck[0]).toMatchObject({ kind: 'tickets', count: 2, subtitle: 'ticket 3 cancelled', eventId: 3 })
    expect(deck[1].kind).toBe('run')
  })

  it('removes a card on dismiss and on act', () => {
    const deck = pushAll(n('spec'), n('tickets'), n('run'))
    expect(deckReducer(deck, { type: 'dismiss', kind: 'tickets' }).map((x) => x.kind)).toEqual(['run', 'spec'])
    expect(deckReducer(deck, { type: 'act', kind: 'run' }).map((x) => x.kind)).toEqual(['tickets', 'spec'])
  })
})
