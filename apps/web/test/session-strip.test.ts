import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { FeatureFull } from '../src/lib/api'
import { SessionStrip } from '../src/components/session/SessionStrip'
import { liveSessionLine } from '../src/lib/feature-ui/session'

function session(overrides: Partial<FeatureFull['sessions'][number]> = {}): FeatureFull['sessions'][number] {
  return { id: 'sess_abcdefghijk', featureId: 'feat_1', kind: 'chat', status: 'live', awaitingInput: false, worktreePath: '/tmp/work', createdAt: Date.now() - 60_000, lap: 1, ...overrides }
}

describe('SessionStrip', () => {
  it('names a live ideation session and hides its short id in visible text', () => {
    const html = renderToStaticMarkup(createElement(SessionStrip, { session: session() }))
    expect(html).toContain('Chat session')
    expect(html).toContain('Live')
    expect(html).toContain('title="sess_abcdefghijk"')
    expect(html).not.toContain('abcdefgh</span>')
  })

  it('uses starting language for a launching session', () => {
    expect(renderToStaticMarkup(createElement(SessionStrip, { session: session({ status: 'launching' }) }))).toContain('Starting…')
  })

  it.each([
    ['converge', 'Converge session'],
    ['waypoint', 'Waypoint session'],
  ] as const)('gives %s a plain kind name', (kind, label) => {
    expect(renderToStaticMarkup(createElement(SessionStrip, { session: session({ kind }) }))).toContain(label)
  })

  it('renders an ended session as one quiet line with no resume action', () => {
    const html = renderToStaticMarkup(createElement(SessionStrip, { session: session({ status: 'ended', createdAt: Date.now() - 7_200_000, endedAt: Date.now() - 7_200_000 }) }))
    expect(html).toContain('Ended 2h ago')
    expect(html).not.toContain('Resume')
  })

  it('ages the ended line from when the session stopped, not from when it started', () => {
    const html = renderToStaticMarkup(createElement(SessionStrip, { session: session({ status: 'ended', createdAt: Date.now() - 7_200_000, endedAt: Date.now() - 1_000 }) }))
    expect(html).toContain('Ended just now')
    expect(html).not.toContain('2h')
  })

  it('says only "ended" for a session that stopped before endings were recorded', () => {
    const html = renderToStaticMarkup(createElement(SessionStrip, { session: session({ status: 'ended', createdAt: Date.now() - 1_020_000, endedAt: undefined }) }))
    expect(html).toContain('Ended')
    expect(html).not.toContain('ago')
    expect(html).not.toContain('17m')
  })
})

/**
 * The review page renders no terminal at all (decision 5), so a session that is
 * still up is one line there — what it is, and the phase whose view actually
 * holds it. An ended session is not state anybody is waiting on, so it has no
 * line.
 */
describe('the live-session line', () => {
  const sessions = (over: Partial<FeatureFull['sessions'][number]>) =>
    [session(over)] as FeatureFull['sessions']

  it('names a live session and where its terminal lives', () => {
    expect(liveSessionLine(sessions({ kind: 'chat', lap: 1 }))).toEqual({
      sessionId: 'sess_abcdefghijk',
      text: 'Chat session still live from lap 1',
      phase: 'planning',
    })
    expect(liveSessionLine(sessions({ kind: 'converge' }))?.phase).toBe('planning')
    // A launching terminal is as live as a live one — it is holding the seat.
    expect(liveSessionLine(sessions({ status: 'launching' }))?.text).toContain('still live')
  })

  // Nowhere to send the human: the line offers End and no trip to nowhere.
  it('points a Q&A or drive-fix session at no phase at all', () => {
    expect(liveSessionLine(sessions({ kind: 'chat' }))?.phase).toBe('planning')
    expect(liveSessionLine(sessions({ kind: 'drive-fix' }))?.phase).toBeNull()
  })

  it('says nothing about an ended session, or about no session', () => {
    expect(liveSessionLine(sessions({ status: 'ended' }))).toBeNull()
    expect(liveSessionLine([] as FeatureFull['sessions'])).toBeNull()
  })
})
