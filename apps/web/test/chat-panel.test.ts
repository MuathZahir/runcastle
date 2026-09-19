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
import { ChatDock, ChatPanel } from '../src/components/workspace/ChatPanel'

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
    expect(html).toContain('one transcript · resumed')
    expect(html).toContain('aria-label="Collapse the chat"')
    expect(html).toContain('aria-label="Feature chat"')
    // Docked at the width the prototype settled on, never the body's.
    expect(html).toContain('w-(--chat-panel-w)')
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
describe('ChatDock', () => {
  const body = createElement('div', { id: 'phase-body' }, 'the phase body')

  it('renders the body and nothing else while the chat is away', () => {
    const html = renderToStaticMarkup(
      createElement(ChatDock, { open: false, panel: createElement('aside', null, 'chat') }, body),
    )

    expect(html).toBe('<div id="phase-body">the phase body</div>')
  })

  it('puts the panel beside the body, with the body still in it', () => {
    const html = renderToStaticMarkup(
      createElement(ChatDock, { open: true, panel: createElement('aside', null, 'chat') }, body),
    )

    expect(html).toContain('<div id="phase-body">the phase body</div>')
    expect(html).toContain('<aside>chat</aside>')
    // The body is given a column of its own so a wide table cannot push the
    // panel off the edge.
    expect(html).toContain('min-w-0')
  })
})
