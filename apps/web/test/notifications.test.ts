
import { describe, expect, it } from 'vitest'
import type { EventRow } from '@runcastle/core'
import type { FeatureListItem } from '../src/lib/api'
import { eventToNotification, notifyButton } from '../src/lib/notifications'
import { tabTitle } from '../src/lib/projects'
import { NOTIFY_OFFER } from '../src/lib/vocabulary'

/**
 * you-always-know-what-s-waiting decision 11: a desktop ping fires when a
 * feature starts needing the human, by the rule the phone push shares, and no
 * longer when a round finishes. Tested at the pure-function seam, no
 * Notification API.
 */

function ev(overrides: Partial<EventRow>): EventRow {
  return {
    id: 1,
    projectId: 'p1',
    featureId: 'f1',
    ts: 0,
    type: 'feature.needs_you',
    message: 'needs you',
    ...overrides,
  }
}

describe('eventToNotification', () => {
  it('pings for a need, titled with its words and naming the feature', () => {
    const n = eventToNotification(
      ev({ data: { kind: 'plan', words: 'Plan to approve', held: false, why: null } }),
      'Dark mode',
    )
    expect(n).toEqual({ title: 'Plan to approve', body: 'Dark mode' })
  })

  it('falls back to a generic feature name when no title is supplied', () => {
    const n = eventToNotification(ev({ data: { kind: 'merge', words: 'Ready to merge', held: false, why: null } }))
    expect(n).toEqual({ title: 'Ready to merge', body: 'your feature' })
  })

  it('stays quiet for a need its orchestrator is handling, and for the human’s own Stop', () => {
    expect(
      eventToNotification(ev({ data: { kind: 'handback', words: 'With the orchestrator · Ready to merge', held: true, why: 'Ready to merge' } })),
    ).toBeNull()
    expect(
      eventToNotification(ev({ data: { kind: 'stopped', words: 'Stopped · you stopped it', held: false, why: 'you stopped it' } })),
    ).toBeNull()
  })

  it('no longer pings when a round finishes or fails', () => {
    expect(eventToNotification(ev({ type: 'run.finished', data: { status: 'succeeded', summary: 'ok' } }))).toBeNull()
    expect(eventToNotification(ev({ type: 'run.finished', data: { status: 'failed', summary: 'red' } }))).toBeNull()
  })
})

/** Decision 13: the tab counts what needs the human, across every project. */
describe('tabTitle', () => {
  const feature = (need: FeatureListItem['need']): FeatureListItem =>
    ({ status: 'active', need }) as FeatureListItem
  const plan = { kind: 'plan', words: 'Plan to approve', held: false, since: 0 } as const

  it('counts the Needs-you features of every project', () => {
    expect(tabTitle([[feature(plan), feature(null)], [feature(plan)]])).toBe('(2) runcastle')
  })

  it('leaves out a need its orchestrator is handling, and reads plain at zero', () => {
    expect(tabTitle([[feature({ ...plan, held: true })], []])).toBe('runcastle')
    expect(tabTitle([])).toBe('runcastle')
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

  /**
   * Decision 9 — the offer used to read "Notify me when a burn finishes", which
   * is the insider verb meeting a newcomer at the moment of a click. The
   * sentence comes from `lib/vocabulary.ts` so every surface says the same one.
   */
  it('offers the ping in a sentence that reads without the jargon', () => {
    const b = notifyButton({ enabled: false, permission: 'default' })
    expect(b.title).toBe(NOTIFY_OFFER)
    expect(b.title).toBe('Notify me when a feature needs me')
    expect(b.title).not.toMatch(/burn/i)
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
