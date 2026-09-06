import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { FeatureFull } from '../src/lib/api'
import { SessionPanel } from '../src/components/SessionPanel'

type Session = FeatureFull['sessions'][number]

function session(over: Partial<Session> & Pick<Session, 'id'>): Session {
  return { featureId: 'feat_1', kind: 'ideation', status: 'ended', awaitingInput: false, worktreePath: '/tmp/work', lap: 1, ...over }
}

const panel = (sessions: Session[]): string =>
  renderToStaticMarkup(createElement(SessionPanel, { featureId: 'feat_1', sessions }))

/**
 * Which session the panel speaks for once none is live (decision #13).
 *
 * It used to prefer the newest RESUMABLE ended session over the newest one, a
 * preference left over from when its card carried a Resume button. End a
 * terminal that never got past its trust prompt — so it recorded no
 * `ccSessionId` — and the strip reported the conversation before it instead,
 * dating the line from an ending the human never watched.
 */
describe('SessionPanel — the session the ended strip speaks for', () => {
  const now = Date.now()

  it('reports the session that just ended, not an older resumable one', () => {
    const html = panel([
      session({ id: 'sess_old', kind: 'converge', ccSessionId: 'cc-old', createdAt: now - 1_080_000, endedAt: now - 1_020_000 }),
      session({ id: 'sess_new', createdAt: now - 60_000, endedAt: now - 2_000 }),
    ])
    expect(html).toContain('Ideation session')
    expect(html).toContain('ended just now')
    expect(html).not.toContain('Converge session')
    expect(html).not.toContain('17m')
  })
})
