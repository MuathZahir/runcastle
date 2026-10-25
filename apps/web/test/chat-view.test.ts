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
    feature: {
      endSession: { useMutation: () => ({ mutate: () => undefined, isPending: false }) },
      openSideSession: { useMutation: () => ({ mutate: () => undefined, isPending: false }) },
      sessions: { useQuery: () => ({ data: [] }) },
    },
    useUtils: () => ({
      feature: {
        get: { invalidate: () => undefined },
        list: { invalidate: () => undefined },
        sessions: { invalidate: () => undefined },
      },
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
import { ProjectChat } from '../src/components/project/ProjectChat'
import { FeatureChat } from '../src/components/workspace/FeatureChat'
import { PanelToggle } from '../src/components/workspace/FeaturePanel'
import { full as fixture } from './fixtures'

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

const html = (node: ReactNode): string =>
  renderToStaticMarkup(createElement(ToastProvider, null, node))

const view = (props: Partial<Parameters<typeof ChatView>[0]> = {}): string =>
  html(createElement(ChatView, { session: null, ...props }))

/**
 * Every chat surface is one component (one-chat-layout-everywhere decision 6):
 * the full-area terminal and the at-rest state with its one button — no header
 * row of its own (design-mode decision 12).
 */
describe('ChatView', () => {
  it('gives a live session its terminal, edge to edge, with no header row of its own', () => {
    const out = view({ session: { id: 'sess_live', status: 'live' } })

    expect(out).toContain('data-terminal="sess_live"')
    expect(out).not.toContain('End session')
    expect(out).not.toContain('<header')
    expect(out).not.toContain('border-b')
    // A live conversation is answered in the terminal, never resumed beside it.
    expect(out).not.toContain('Resume the conversation')
    expect(out).not.toContain('Start the conversation')
  })

  it('a launching session has its terminal too', () => {
    expect(view({ session: { id: 'sess_up', status: 'launching' } })).toContain('data-terminal="sess_up"')
  })

  it('puts the notices it is handed above the terminal', () => {
    const out = view({ session: { id: 'sess_live', status: 'live' }, notices: createElement('p', null, 'Resume failed.') })
    expect(out.indexOf('Resume failed.')).toBeLessThan(out.indexOf('data-terminal'))
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
  it('names each kind of feature session', () => {
    expect(chatContextLine(session({ kind: 'chat' }))).toBe('Feature chat')
    expect(chatContextLine(session({ kind: 'drive-fix' }))).toBe('Drive fix')
    expect(chatContextLine(session({ kind: 'scenario' }))).toBe('Scenario')
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
    expect(featureChat([session({ kind: 'drive-fix' })])).toBeUndefined()
  })
})

/** The feature's Chat tab: whichever session is live, else the chat at rest. */
describe('FeatureChat', () => {
  const tab = (sessions: Session[]) => {
    const f = fixture()
    return html(
      createElement(FeatureChat, {
        full: { ...f, sessions },
        events: [],
        hidden: false,
        launching: false,
        onLaunch: () => undefined,
        onView: () => undefined,
      }),
    )
  }

  for (const kind of ['chat', 'drive-fix'] as const) {
    it(`hosts a live ${kind} session full-area, its End session in the page header's switcher`, () => {
      const out = tab([session({ id: `sess_${kind}`, kind })])
      expect(out).toContain(`data-terminal="sess_${kind}"`)
      expect(out).not.toContain('End session')
    })
  }

  it('never attaches a terminal to a live self-planning run, and says it is planning itself', () => {
    const out = tab([session({ id: 'sess_self', purpose: 'self-plan' })])
    expect(out).not.toContain('data-terminal')
    expect(out).toContain('This feature is planning itself.')
  })

  it('with nothing live, reads back the chat transcript over Resume', () => {
    const out = tab([session({ status: 'ended', ccSessionId: 'cc-1' })])
    expect(out).toContain('Resume the conversation')
    expect(out).not.toContain('data-terminal')
  })

  /** A side session has its own row in the switcher; it never stands in for the main chat. */
  it('keeps the main chat in view while only a side session is live', () => {
    const out = tab([
      session({ id: 'sess_main', status: 'ended', ccSessionId: 'cc-1' }),
      session({ id: 'sess_side', kind: 'side' }),
    ])
    expect(out).not.toContain('data-terminal')
    expect(out).toContain('Resume the conversation')
  })

  it('offers Start when the feature never had a chat', () => {
    const out = tab([session({ kind: 'drive-fix', status: 'ended' })])
    expect(out).toContain('Start the conversation')
  })

  it('carries the notice deck over the chat', () => {
    expect(tab([session({ id: 'sess_1' })])).toContain('aria-label="Chat notifications"')
  })

  /** opening-a-feature-shows-its-chat-as-you-left-it decision 6. */
  describe('while opening it resumes the chat by itself', () => {
    const resumingTab = (sessions: Session[]) => {
      const f = fixture()
      return html(
        createElement(FeatureChat, {
          full: { ...f, sessions },
          events: [],
          hidden: false,
          launching: false,
          autoResuming: true,
          onLaunch: () => undefined,
          onView: () => undefined,
        }),
      )
    }
    const ended = session({ id: 'sess_old', status: 'ended', ccSessionId: 'cc-1' })

    it('keeps the transcript up with Resuming… where the button was', () => {
      const out = resumingTab([ended])
      expect(out).toContain('why did ticket 25 drop the override path?')
      expect(out).toContain('Resuming…')
      expect(out).not.toContain('Resume the conversation')
      expect(out).not.toContain('data-terminal')
    })

    it('keeps the ended transcript in front while the session is launching, its terminal attached out of sight', () => {
      const out = resumingTab([ended, session({ id: 'sess_new', status: 'launching' })])
      expect(out).toContain('why did ticket 25 drop the override path?')
      expect(out).toContain('Resuming…')
      expect(out).toMatch(/class="hidden" data-chat-terminal=""><div data-terminal="sess_new"/)
    })

    it('shows the terminal once the session is live', () => {
      const out = resumingTab([ended, session({ id: 'sess_new', status: 'live' })])
      expect(out).not.toContain('Resuming…')
      expect(out).toMatch(/class="min-h-0 flex-1" data-chat-terminal=""><div data-terminal="sess_new"/)
    })
  })

  it('shows a launching terminal at once when nothing is resuming by itself', () => {
    const out = tab([session({ id: 'sess_new', status: 'launching' })])
    expect(out).not.toContain('Resuming…')
    expect(out).toMatch(/class="min-h-0 flex-1" data-chat-terminal=""/)
  })
})

describe('the project chat', () => {
  it('renders through the same ChatView', () => {
    const out = html(
      createElement(ProjectChat, {
        session: { id: 'ps_1', ccSessionId: 'f5b41d9e-rest', status: 'live' } as NonNullable<ProjectSession>,
        hidden: false,
        onEnded: () => undefined,

      }),
    )
    expect(out).toContain('data-chat-view')
    expect(out).toContain('Project chat')
    expect(out).toContain('data-terminal="ps_1"')
    // The deck is the feature Chat tab's; the project chat has none.
    expect(out).not.toContain('Chat notifications')
    // End session is the page header's switcher's (design-mode decision 12).
    expect(out).not.toContain('End session')
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
