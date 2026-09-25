import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../src/trpc', () => ({
  trpc: {
    project: {
      conversationTranscript: {
        useQuery: () => ({
          isPending: false,
          data: {
            status: 'ok',
            runtime: 'claude-code',
            turns: [{ role: 'user', text: 'why did ticket 25 drop the override path?' }],
          },
        }),
      },
    },
    feature: { endSession: { useMutation: () => ({ mutate: () => undefined, isPending: false }) } },
    useUtils: () => ({
      feature: { get: { invalidate: () => undefined }, list: { invalidate: () => undefined } },
    }),
  },
}))

vi.mock('../src/components/TerminalView', () => ({
  TerminalView: ({ sessionId }: { sessionId: string }) =>
    createElement('div', { 'data-terminal': sessionId }),
}))

import type { FeatureFull } from '../src/lib/api'
import { ToastProvider } from '../src/lib/toast'
import { ChatPanel } from '../src/components/workspace/ChatPanel'
import { AsideLayout } from '../src/ui'

type Session = FeatureFull['sessions'][number]

function session(over: Partial<Session> = {}): Session {
  return {
    id: 'sess_1',
    featureId: 'feat_1',
    kind: 'chat',
    status: 'live',
    awaitingInput: false,
    worktreePath: '/tmp/talk',
    lap: 1,
    createdAt: 0,
    ...over,
  } as Session
}

function panel(sessions: Session[]): string {
  return renderToStaticMarkup(
    createElement(
      ToastProvider,
      null,
      createElement(ChatPanel, {
        featureId: 'feat_1',
        sessions,
        busy: false,
        onOpenChat: () => undefined,
        onCollapse: () => undefined,
      }),
    ),
  )
}

/**
 * The panel is the feature's one conversation, docked (decision 16) — the same
 * header in every state, and a body that follows the conversation rather than
 * the phase.
 */
describe('ChatPanel', () => {
  it('names the one transcript and offers the way out of the dock', () => {
    const html = panel([session()])

    expect(html).toContain('Chat')
    expect(html).toContain('One transcript, resumed')
    expect(html).toContain('aria-label="Close"')
    expect(html).toContain('aria-label="Feature chat"')
    // The page's one aside: the shared primitive, sliding in.
    expect(html).toContain('w-(--aside-w)')
    expect(html).toContain('animate-slide-in-right')
  })

  it('gives a live chat its terminal — the transcript and the composer are one surface', () => {
    const html = panel([session({ id: 'sess_live' })])

    expect(html).toContain('data-terminal="sess_live"')
    // A live conversation is answered in the terminal, so the panel does not
    // also offer to resume the one that is already up.
    expect(html).not.toContain('Resume the conversation')
    expect(html).toContain('End session')
  })

  it('reads an ended chat back and offers to pick it up again', () => {
    const html = panel([session({ status: 'ended', ccSessionId: 'cc-1', endedAt: 1 })])

    expect(html).toContain('why did ticket 25 drop the override path?')
    expect(html).toContain('Resume the conversation')
    expect(html).not.toContain('data-terminal')
    // Nothing is live, so there is no session to end from here.
    expect(html).not.toContain('End session')
  })

  it('offers the first conversation on a feature nobody has talked to', () => {
    const html = panel([])

    expect(html).toContain('No conversation yet')
    expect(html).toContain('Start the conversation')
  })

  /**
   * The chat that is up wins over the chat that stopped: resume targets the one
   * transcript, and a panel showing the older row would be reading back a
   * conversation the human is mid-sentence in.
   */
  it('shows the chat that is up, not the newest ended one', () => {
    const html = panel([
      session({ id: 'sess_live', status: 'live' }),
      session({ id: 'sess_old', status: 'ended', ccSessionId: 'cc-0' }),
    ])

    expect(html).toContain('data-terminal="sess_live"')
  })

  /** Waypoint and converge sessions are the map's, not the chat's. */
  it('ignores sessions that are not the chat', () => {
    const html = panel([session({ id: 'sess_wp', kind: 'waypoint' })])

    expect(html).toContain('No conversation yet')
  })
})

/**
 * Collapsed, the dock is not a narrower panel or a stub — it is nothing at all,
 * which is what lets the body keep the layout its phase gave it.
 */
describe('AsideLayout (the chat dock)', () => {
  const body = createElement('div', { id: 'phase-body' }, 'the phase body')

  // The page column is the same element open or closed, so toggling the
  // aside never remounts the page (no replayed entrance, no scroll reset).
  it('renders the body in the same column, and no aside, while the chat is away', () => {
    const closed = renderToStaticMarkup(createElement(AsideLayout, { aside: false, children: body }))
    const open = renderToStaticMarkup(
      createElement(AsideLayout, { aside: createElement('aside', null, 'chat'), children: body }),
    )

    expect(closed).toContain('<div id="phase-body">the phase body</div>')
    expect(closed).not.toContain('<aside')
    // Everything up to and including the body is identical in both states.
    const upToBody = (html: string) => html.slice(0, html.indexOf('</div>') + '</div>'.length)
    expect(upToBody(open)).toBe(upToBody(closed))
  })

  it('puts the panel beside the body, with the body still in it', () => {
    const html = renderToStaticMarkup(
      createElement(AsideLayout, { aside: createElement('aside', null, 'chat'), children: body }),
    )

    expect(html).toContain('<div id="phase-body">the phase body</div>')
    expect(html).toContain('<aside>chat</aside>')
    // The body is given a column of its own so a wide table cannot push the
    // panel off the edge.
    expect(html).toContain('min-w-0')
    // Under 56rem of panel the aside floats over the page instead of sharing it.
    expect(html).toContain('@container')
    expect(html).toContain('@max-4xl:absolute')
  })
})
