import { createElement, type ReactNode } from 'react'
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
    events: { list: { useQuery: () => ({ data: [] }) } },
    feature: { endSession: { useMutation: () => ({ mutate: () => undefined, isPending: false }) } },
    useUtils: () => ({
      feature: { get: { invalidate: () => undefined }, list: { invalidate: () => undefined } },
    }),
  },
}))
vi.mock('../src/lib/events', () => ({ useEventLog: () => [] }))

vi.mock('../src/components/TerminalView', () => ({
  TerminalView: ({ sessionId }: { sessionId: string }) =>
    createElement('div', { 'data-terminal': sessionId }),
}))

import type { FeatureFull, ProjectSession } from '../src/lib/api'
import { chatContextLine, featureChat, liveSessionLine } from '../src/lib/feature-ui'
import { ToastProvider } from '../src/lib/toast'
import { ChatView } from '../src/components/chat/ChatView'
import { LiveChat } from '../src/components/project/LiveChat'
import { FeatureChat } from '../src/components/workspace/FeatureChat'
import { FeatureViewTabs } from '../src/components/workspace/FeatureViewTabs'
import { LiveSessionBar } from '../src/components/workspace/LiveSessionBar'
import { full as fixture } from './fixtures'

type Session = FeatureFull['sessions'][number]
type Waypoint = FeatureFull['waypoints'][number]

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

const html = (node: ReactNode): string =>
  renderToStaticMarkup(createElement(ToastProvider, null, node))

const view = (props: Partial<Parameters<typeof ChatView>[0]> = {}): string =>
  html(createElement(ChatView, { session: null, contextLine: 'Chat · lap 2', ...props }))

/**
 * Every chat surface is one component (one-chat-layout-everywhere decision 6):
 * the strip, the full-area terminal, and the at-rest state with its one button.
 */
describe('ChatView', () => {
  it('gives a live session the strip — live dot, context line, End session — over its terminal', () => {
    const out = view({ session: { id: 'sess_live', status: 'live' }, featureId: 'feat_1' })

    expect(out).toContain('aria-label="Live"')
    expect(out).toContain('Chat · lap 2')
    expect(out).toContain('End session')
    expect(out).toContain('data-terminal="sess_live"')
    // A live conversation is answered in the terminal, never resumed beside it.
    expect(out).not.toContain('Resume the conversation')
    expect(out).not.toContain('Start the conversation')
  })

  it('marks a launching session as starting, still with its terminal', () => {
    const out = view({ session: { id: 'sess_up', status: 'launching' } })

    expect(out).toContain('aria-label="Starting"')
    expect(out).toContain('data-terminal="sess_up"')
  })

  it('reads an ended chat back and offers to resume it, with nothing to end', () => {
    const out = view({ transcriptId: 'sess_old', onLaunch: () => undefined })

    expect(out).toContain('why did ticket 25 drop the override path?')
    expect(out).toContain('Resume the conversation')
    expect(out).not.toContain('data-terminal')
    expect(out).not.toContain('End session')
    expect(out).not.toContain('aria-label="Live"')
  })

  it('offers Start on a conversation that never happened', () => {
    const out = view({ onLaunch: () => undefined })

    expect(out).toContain('No conversation yet')
    expect(out).toContain('Start the conversation')
  })

  it('stays mounted but hidden behind another view', () => {
    const out = view({ session: { id: 'sess_live', status: 'live' }, hidden: true })

    expect(out).toContain('hidden=""')
    expect(out).toContain('aria-hidden="true"')
    // Still mounted: xterm keeps its buffer only while it is in the tree.
    expect(out).toContain('data-terminal="sess_live"')
  })

  it('renders its children in a positioned layer over the terminal area', () => {
    const out = view({
      session: { id: 'sess_live', status: 'live' },
      children: createElement('div', { 'data-overlay': '' }),
    })

    expect(out).toMatch(/class="relative[^"]*"><div[^>]*data-chat-terminal[\s\S]*data-overlay/)
  })
})

/** The strip names whichever session kind the Chat tab is hosting (decision 9). */
describe('chatContextLine', () => {
  const waypoint = { id: 'wp_1', title: 'Map the auth flow', claimedBy: 'sess_wp' } as Waypoint

  it('names each kind of feature session', () => {
    expect(chatContextLine(session({ kind: 'chat', lap: 2 }), [])).toBe('Chat · lap 2')
    expect(chatContextLine(session({ id: 'sess_wp', kind: 'waypoint' }), [waypoint])).toBe(
      'Waypoint · Map the auth flow',
    )
    expect(chatContextLine(session({ kind: 'converge' }), [])).toBe('Converge')
    expect(chatContextLine(session({ kind: 'drive-fix' }), [])).toBe('Drive fix')
  })

  it('names a waypoint session by its kind alone when it holds no waypoint', () => {
    expect(chatContextLine(session({ id: 'sess_other', kind: 'waypoint' }), [waypoint])).toBe('Waypoint')
  })
})

describe('featureChat', () => {
  it('reads back the chat that is up, else the newest chat, ignoring other kinds', () => {
    expect(
      featureChat([session({ id: 'old', status: 'ended' }), session({ id: 'live' })])?.id,
    ).toBe('live')
    expect(
      featureChat([session({ id: 'a', status: 'ended' }), session({ id: 'b', status: 'ended' })])?.id,
    ).toBe('b')
    expect(featureChat([session({ kind: 'waypoint' })])).toBeUndefined()
  })
})

/** The feature's Chat tab: whichever session is live, else the chat at rest. */
describe('FeatureChat', () => {
  const tab = (sessions: Session[], lap = 1) => {
    const f = fixture()
    return html(
      createElement(FeatureChat, {
        full: { ...f, feature: { ...f.feature, lap }, sessions },
        hidden: false,
        launching: false,
        onLaunch: () => undefined,
      }),
    )
  }

  for (const [kind, line] of [
    ['chat', 'Chat · lap 1'],
    ['waypoint', 'Waypoint'],
    ['converge', 'Converge'],
    ['drive-fix', 'Drive fix'],
  ] as const) {
    it(`hosts a live ${kind} session full-area`, () => {
      const out = tab([session({ id: `sess_${kind}`, kind })])
      expect(out).toContain(`data-terminal="sess_${kind}"`)
      expect(out).toContain(line)
      expect(out).toContain('End session')
    })
  }

  it('with nothing live, reads back the chat transcript over Resume', () => {
    const out = tab([session({ status: 'ended', ccSessionId: 'cc-1' })], 2)
    expect(out).toContain('Chat · lap 2')
    expect(out).toContain('Resume the conversation')
    expect(out).not.toContain('data-terminal')
  })

  it('offers Start when the feature never had a chat', () => {
    const out = tab([session({ kind: 'converge', status: 'ended' })])
    expect(out).toContain('Start the conversation')
  })
})

describe('the project chat', () => {
  it('renders through the same ChatView', () => {
    const out = html(
      createElement(LiveChat, {
        session: { id: 'ps_1', ccSessionId: 'f5b41d9e-rest', status: 'live' } as NonNullable<ProjectSession>,
        title: 'Untitled',
        branch: 'main',
        hidden: false,
        onBack: () => undefined,
        onEnded: () => undefined,
      }),
    )
    expect(out).toContain('data-chat-view')
    expect(out).toContain('Project chat')
    expect(out).toContain('data-terminal="ps_1"')
    expect(out).toContain('End session')
  })
})

/** Overview | Tickets | Chat on every non-draft feature (decisions 1, 11). */
describe('FeatureViewTabs', () => {
  const tabs = (props: Partial<Parameters<typeof FeatureViewTabs>[0]> = {}) =>
    html(
      createElement(FeatureViewTabs, {
        isDraft: false,
        value: 'overview',
        onChange: () => undefined,
        ticketCount: 0,
        sessionLive: false,
        ...props,
      }),
    )

  it('shows the three views, Chat last, with the ticket count', () => {
    const out = tabs({ ticketCount: 4 })
    const labels = [...out.matchAll(/role="tab"[^>]*>([\s\S]*?)<\/button>/g)].map((m) =>
      m[1]!.replace(/<[^>]+>/g, ''),
    )
    expect(labels).toEqual(['Overview', 'Tickets4', 'Chat'])
    expect(out).not.toContain('Session live')
  })

  it('puts a live dot on Chat while a session is live', () => {
    expect(tabs({ sessionLive: true, value: 'chat' })).toMatch(/aria-selected="true"[^>]*>[\s\S]*Chat[\s\S]*aria-label="Session live"/)
  })

  it('gives a draft no views at all', () => {
    expect(tabs({ isDraft: true })).not.toContain('role="tab"')
  })
})

/** One line on Overview, in every state, whenever a session is live (decision 7). */
describe('the live-session line', () => {
  it('names the live session and its lap', () => {
    expect(liveSessionLine([session({ kind: 'converge', lap: 3 })])).toEqual({
      sessionId: 'sess_1',
      text: 'Converge live · lap 3',
    })
    // A launching terminal is as live as a live one — it is holding the seat.
    expect(liveSessionLine([session({ status: 'launching' })])?.text).toBe('Chat live · lap 1')
  })

  it('says nothing about an ended session, or about no session', () => {
    expect(liveSessionLine([session({ status: 'ended' })])).toBeNull()
    expect(liveSessionLine([])).toBeNull()
  })

  it('offers Open chat and End session', () => {
    const out = html(
      createElement(LiveSessionBar, {
        featureId: 'feat_1',
        line: { sessionId: 'sess_1', text: 'Chat live · lap 2' },
        onOpen: () => undefined,
      }),
    )
    expect(out).toContain('Chat live · lap 2')
    expect(out).toContain('Open chat')
    expect(out).toContain('End session')
  })
})
