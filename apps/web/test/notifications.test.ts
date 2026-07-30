import { describe, expect, it } from 'vitest'
import type { EventRow } from '@runcastle/core'
import { eventToNotification, notifyButton } from '../src/lib/notifications'

/**
 * Streamlining-ux ticket 10 — the events poll turns a finishing burn into a
 * desktop notification. Tested at the pure-function seam, no Notification API.
 */

function ev(overrides: Partial<EventRow>): EventRow {
  return {
    id: 1,
    projectId: 'p1',
    featureId: 'f1',
    ts: 0,
    type: 'run.finished',
    message: 'run succeeded: done',
    ...overrides,
  }
}

describe('eventToNotification', () => {
  it('maps a succeeded run to a review-ready ping naming the feature', () => {
    const n = eventToNotification(
      ev({ data: { status: 'succeeded', summary: 'all tickets green' } }),
      'Dark mode',
    )
    expect(n).toEqual({ title: 'Burn complete — review is ready', body: 'Dark mode' })
  })

  it('maps a failed run to a failure ping with a short reason', () => {
    const n = eventToNotification(
      ev({ data: { status: 'failed', summary: 'ticket 3 never went green' } }),
      'Dark mode',
    )
    expect(n).toEqual({ title: 'Burn failed', body: 'Dark mode: ticket 3 never went green' })
  })

  it('trims a multi-line / overlong summary to its first line', () => {
    const summary = `${'x'.repeat(200)}\nsecond line`
    const n = eventToNotification(ev({ data: { status: 'failed', summary } }), 'F')
    expect(n?.body).toBe(`F: ${'x'.repeat(139)}…`)
    expect(n?.body).not.toContain('second line')
  })

  it('falls back to a generic feature name when no title is supplied', () => {
    const n = eventToNotification(ev({ data: { status: 'succeeded', summary: 'ok' } }))
    expect(n).toEqual({ title: 'Burn complete — review is ready', body: 'your feature' })
  })

  it('ignores a cancelled run — the human stopped it, not an away-period end', () => {
    expect(
      eventToNotification(ev({ data: { status: 'cancelled', summary: 'run cancelled' } })),
    ).toBeNull()
  })

  it('ignores run.finished with a malformed or missing data payload', () => {
    expect(eventToNotification(ev({ data: undefined }))).toBeNull()
    expect(eventToNotification(ev({ data: { status: 'succeeded' } }))).toBeNull()
    expect(eventToNotification(ev({ data: 'oops' }))).toBeNull()
  })

  it('ignores unrelated event types', () => {
    expect(eventToNotification(ev({ type: 'run.started', data: { status: 'succeeded', summary: 'x' } }))).toBeNull()
    expect(eventToNotification(ev({ type: 'session.kickoff' }))).toBeNull()
    expect(eventToNotification(ev({ type: 'phase.advanced' }))).toBeNull()
  })
})

/**
 * The status bar's notify button used to have one appearance and a click that
 * silently did nothing once the browser had denied permission (findings F17.9).
 */
describe('notifyButton', () => {
  it('is on when enabled and permitted', () => {
    const b = notifyButton({ enabled: true, permission: 'granted' })
    expect(b.state).toBe('on')
    expect(b.label).toBe('notify on')
  })

  it('is off when the preference is off', () => {
    const b = notifyButton({ enabled: false, permission: 'default' })
    expect(b.state).toBe('off')
    expect(b.label).toBe('notify off')
  })

  it('reads blocked — and says how to unblock — when the browser denied it', () => {
    const b = notifyButton({ enabled: false, permission: 'denied' })
    expect(b.state).toBe('blocked')
    expect(b.label).toBe('notify blocked')
    expect(b.title).toMatch(/site settings/i)
  })

  it('reads blocked even when the stored preference says on', () => {
    expect(notifyButton({ enabled: true, permission: 'denied' }).state).toBe('blocked')
  })
})
