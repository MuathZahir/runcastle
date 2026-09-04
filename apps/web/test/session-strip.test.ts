import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { FeatureFull } from '../src/lib/api'
import { SessionStrip } from '../src/components/session/SessionStrip'

function session(overrides: Partial<FeatureFull['sessions'][number]> = {}): FeatureFull['sessions'][number] {
  return { id: 'sess_abcdefghijk', featureId: 'feat_1', kind: 'ideation', status: 'live', awaitingInput: false, worktreePath: '/tmp/work', createdAt: Date.now() - 60_000, lap: 1, ...overrides }
}

describe('SessionStrip', () => {
  it('names a live ideation session and hides its short id in visible text', () => {
    const html = renderToStaticMarkup(createElement(SessionStrip, { session: session() }))
    expect(html).toContain('Ideation session')
    expect(html).toContain('live')
    expect(html).toContain('title="sess_abcdefghijk"')
    expect(html).not.toContain('abcdefgh</span>')
  })

  it('uses starting language for a launching session', () => {
    expect(renderToStaticMarkup(createElement(SessionStrip, { session: session({ status: 'launching' }) }))).toContain('starting…')
  })

  it('names a later revisit after its lap', () => {
    expect(renderToStaticMarkup(createElement(SessionStrip, { session: session({ kind: 'revisit', lap: 3 }) }))).toContain('Lap 3 session')
  })

  it.each([
    ['converge', 'Converge session'],
    ['qa', 'Question session'],
    ['waypoint', 'Waypoint session'],
  ] as const)('gives %s a plain kind name', (kind, label) => {
    expect(renderToStaticMarkup(createElement(SessionStrip, { session: session({ kind }) }))).toContain(label)
  })

  it('renders an ended session as one quiet line with no resume action', () => {
    const html = renderToStaticMarkup(createElement(SessionStrip, { session: session({ status: 'ended', createdAt: Date.now() - 7_200_000, endedAt: Date.now() - 7_200_000 }) }))
    expect(html).toContain('ended 2h ago')
    expect(html).not.toContain('Resume')
  })

  it('ages the ended line from when the session stopped, not from when it started', () => {
    const html = renderToStaticMarkup(createElement(SessionStrip, { session: session({ status: 'ended', createdAt: Date.now() - 7_200_000, endedAt: Date.now() - 1_000 }) }))
    expect(html).toContain('ended just now')
    expect(html).not.toContain('2h')
  })

  it('says only "ended" for a session that stopped before endings were recorded', () => {
    const html = renderToStaticMarkup(createElement(SessionStrip, { session: session({ status: 'ended', createdAt: Date.now() - 1_020_000, endedAt: undefined }) }))
    expect(html).toContain('ended')
    expect(html).not.toContain('ago')
    expect(html).not.toContain('17m')
  })
})
