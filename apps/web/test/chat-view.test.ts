import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { FeatureFull } from '../src/lib/api'
import { featureChat, liveSessionLine } from '../src/lib/feature-ui'
import { PanelToggle } from '../src/components/workspace/FeaturePanel'

type Session = FeatureFull['sessions'][number]

function session(over: Partial<Session> = {}): Session {
  return {
    id: 'sess_1',
    featureId: 'feat_1',
    kind: 'chat',
    status: 'live',
    awaitingInput: false,
    worktreePath: '/tmp/talk',
    createdAt: 0,
    ...over,
  } as Session
}

const html = (node: ReactNode): string => renderToStaticMarkup(node)

/** The main chat's row while the thread list cannot be read: the one up, else the newest. */
describe('featureChat', () => {
  it('reads back the chat that is up, else the newest chat, ignoring other kinds', () => {
    expect(
      featureChat([session({ id: 'old', status: 'ended' }), session({ id: 'live' })])?.id,
    ).toBe('live')
    expect(
      featureChat([session({ id: 'a', status: 'ended' }), session({ id: 'b', status: 'ended' })])?.id,
    ).toBe('b')
    expect(featureChat([session({ kind: 'drive-fix' })])).toBeUndefined()
  })
})

/** design-mode decision 12: one panel toggle in the header, no button per view. */
describe('PanelToggle', () => {
  const toggle = (props: Partial<Parameters<typeof PanelToggle>[0]> = {}) =>
    html(createElement(PanelToggle, { open: false, views: ['work', 'design', 'details'], onToggle: () => undefined, ...props }))

  it('is one icon button, whatever views the state offers', () => {
    const out = toggle()
    expect(out.match(/<button/g)).toHaveLength(1)
    expect(out).toContain('aria-label="Show the panel"')
    expect(out).not.toMatch(/(Tickets|Design|Details)<\/button>/)
  })

  it('says Hide while the panel is open', () => {
    expect(toggle({ open: true })).toContain('aria-label="Hide the panel"')
  })

  it('gives a draft, which offers no views, nothing', () => {
    expect(toggle({ views: [] })).not.toContain('<button')
  })
})

/** One line on Overview, in every state, whenever a session is live (decision 7). */
describe('the live-session line', () => {
  it('names the live session', () => {
    expect(liveSessionLine([session({ kind: 'drive-fix' })])).toEqual({
      sessionId: 'sess_1',
      text: 'Drive fix live',
    })
    // A launching terminal is as live as a live one — it is holding the seat.
    expect(liveSessionLine([session({ status: 'launching' })])?.text).toBe('Agent live')
  })

  it('says nothing about an ended session, or about no session', () => {
    expect(liveSessionLine([session({ status: 'ended' })])).toBeNull()
    expect(liveSessionLine([])).toBeNull()
  })

  it('says nothing during a self-planning run, whose bar already offers Stop', () => {
    expect(liveSessionLine([session({ purpose: 'self-plan' })])).toBeNull()
    expect(liveSessionLine([session({ purpose: 'self-plan', status: 'launching' })])).toBeNull()
  })
})
