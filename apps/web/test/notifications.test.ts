
import { describe, expect, it } from 'vitest'
import type { EventRow } from '@runcastle/core'
import type { FeatureListItem } from '../src/lib/api'
import { eventToNotification, needPath, notifyButton } from '../src/lib/notifications'
import { pathFor } from '../src/lib/routes'
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

const lead = { why: 'Plan ready for your yes', threadId: 'lead-1', by: 'agent', featureId: 'f1' }

describe('eventToNotification (needs-you-is-the-agent-s-call decision 14)', () => {
  it('pings for every well-formed need, titled with the agent’s line and naming the feature', () => {
    expect(eventToNotification(ev({ data: lead }), 'Dark mode')).toEqual({
      title: 'Needs you · Plan ready for your yes',
      body: 'Dark mode',
    })
  })

  it('falls back to a generic feature name when no title is supplied', () => {
    expect(eventToNotification(ev({ data: lead }))).toEqual({ title: 'Needs you · Plan ready for your yes', body: 'your feature' })
  })

  it('names an epic’s chat for a need with no feature', () => {
    const n = eventToNotification(ev({ featureId: undefined, data: { ...lead, featureId: null } }))
    expect(n).toEqual({ title: 'Needs you · Plan ready for your yes', body: 'An epic’s chat' })
  })

  it('stays quiet for a malformed one', () => {
    expect(eventToNotification(ev({ data: { kind: 'plan', words: 'Plan to approve', held: false } }))).toBeNull()
    expect(eventToNotification(ev({ data: { ...lead, by: 'someone' } }))).toBeNull()
  })
})

describe('needPath (decision 12)', () => {
  it('opens the exact chat on its feature’s page', () => {
    expect(needPath(ev({ data: { ...lead, threadId: 'worker-2' } }), { projectId: 'p1', slug: 'dark-mode' })).toBe(
      `${pathFor({ kind: 'feature', projectId: 'p1', featureSlug: 'dark-mode' })}?thread=worker-2`,
    )
  })

  it('opens an epic’s own chat on the Orchestrator', () => {
    expect(needPath(ev({ data: { ...lead, featureId: null, threadId: 'epic-1' } }), null)).toBe(
      `${pathFor({ kind: 'chat', projectId: 'p1' })}?thread=epic-1`,
    )
  })

  it('goes nowhere for a feature the server no longer lists, or an event that does not ping', () => {
    expect(needPath(ev({ data: lead }), null)).toBeNull()
    expect(needPath(ev({ type: 'run.finished', data: lead }), { projectId: 'p1', slug: 'x' })).toBeNull()
  })
})

describe('eventToNotification, other events', () => {

  it('no longer pings when a round finishes or fails', () => {
    expect(eventToNotification(ev({ type: 'run.finished', data: { status: 'succeeded', summary: 'ok' } }))).toBeNull()
    expect(eventToNotification(ev({ type: 'run.finished', data: { status: 'failed', summary: 'red' } }))).toBeNull()
  })
})

/** Decision 13: the tab counts what needs the human, across every project. */
describe('tabTitle', () => {
  const feature = (need: FeatureListItem['need']): FeatureListItem =>
    ({ status: 'active', need }) as FeatureListItem
  const plan = { why: 'Plan ready for your yes', since: 0, threadId: 't', by: 'agent' } as const

  it('counts the Needs-you features of every project', () => {
    expect(tabTitle([[feature(plan), feature(null)], [feature(plan)]])).toBe('(2) runcastle')
  })

  it('reads plain at zero', () => {
    expect(tabTitle([[feature(null)], []])).toBe('runcastle')
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
