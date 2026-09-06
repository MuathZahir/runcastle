import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TranscriptBubbles } from '../src/components/ConversationTranscript'
import { ConversationList } from '../src/components/project/ConversationList'
import { NewChatCard } from '../src/components/project/NewChatCard'
import { TranscriptPane } from '../src/components/project/TranscriptPane'
import type { ProjectConversation } from '../src/lib/api'
import type { SessionBranchApi } from '../src/lib/use-session-branch'

/**
 * The resting project workspace (decisions.md #3, #6, #11). Tier 1: every one of
 * these pieces is the markup it emits — what copy survives, which control is
 * offered, and which state disables it. The landing menu's own behaviour, which
 * only exists once it is open, is tier 2 in `branch-menu.test.tsx`.
 */

const landing = (over: Partial<SessionBranchApi> = {}): SessionBranchApi => ({
  value: 'main',
  branches: ['main', 'develop'],
  detected: 'main',
  missing: false,
  pick: () => {},
  picking: false,
  ...over,
})

/**
 * The opening tag of the element whose text is `label`. Asserting on the tag
 * rather than on the whole string is what keeps `disabled=""` from being
 * answered by the `disabled:opacity-40` in every button's class list.
 */
const tagBefore = (html: string, label: string): string => {
  const text = html.indexOf(`>${label}`)
  return html.slice(html.lastIndexOf('<', text), text + 1)
}

const conversation = (over: Partial<ProjectConversation> = {}): ProjectConversation => ({
  id: 'sess_1',
  title: 'Read the audit handoff and turn it into features',
  createdAt: Date.now() - 3 * 60 * 60 * 1000,
  status: 'ended',
  resumable: true,
  ...over,
})

describe('NewChatCard', () => {
  const render = (over: Partial<SessionBranchApi> = {}, starting = false) =>
    renderToStaticMarkup(
      <NewChatCard landing={landing(over)} onStart={() => {}} starting={starting} />,
    )

  it('is one heading, one line and one door', () => {
    const html = render()
    expect(html).toContain('Talk it through')
    expect(html).toContain(
      'Bring a raw idea; the chat checks it against what’s built and cuts it into features.',
    )
    expect(html).toContain('New chat')
  })

  it('keeps the heading and copy on the 8px card rhythm', () => {
    const html = render()
    expect(tagBefore(html, 'Talk it through')).toContain('m-0')
    expect(tagBefore(html, 'Bring a raw idea;')).toContain('m-0')
  })

  // The card carried a paragraph about what the chat would do with the idea, on
  // every visit; the chat's own greeting says it better on arrival.
  it('explains nothing a returning human has already read', () => {
    expect(render()).not.toContain('looks at what this project has already built')
  })

  it('names the branch the next chat lands on, beside the button that launches it', () => {
    expect(render()).toContain('landing on main')
  })

  // The one error state (decisions.md #3): the stored pick is gone, so the
  // launch would refuse server-side. It is refused here instead, in place.
  it('blocks New chat while the landing branch is gone', () => {
    expect(tagBefore(render({ missing: true, value: 'release/1.2' }), 'New chat')).toContain(
      'disabled=""',
    )
  })

  it('leaves New chat live while a usable branch is chosen', () => {
    expect(tagBefore(render(), 'New chat')).not.toContain('disabled=""')
  })
})

describe('ConversationList', () => {
  const render = (conversations: ProjectConversation[], pending = false) =>
    renderToStaticMarkup(
      <ConversationList
        conversations={conversations}
        pending={pending}
        busy={false}
        onResume={() => {}}
        onView={() => {}}
      />,
    )

  it('shows a title, when it was, and the way back into it', () => {
    const html = render([conversation()])
    expect(html).toContain('Read the audit handoff and turn it into features')
    expect(html).toContain('3h')
    expect(html).toContain('Reopen')
  })

  // Reopening is the deliberate act; the row's own job is to open the transcript.
  it('keeps Reopen out of the way until the row is hovered or focused', () => {
    expect(render([conversation()])).toContain('opacity-0 group-hover:opacity-100')
  })

  it('marks a conversation that is still open', () => {
    const open = render([conversation({ status: 'live' })])
    expect(open).toContain('title="live"')
    expect(render([conversation()])).not.toContain('title="live"')
  })

  it('offers no Reopen on a conversation the agent never picked up', () => {
    expect(tagBefore(render([conversation({ resumable: false })]), 'Reopen')).toContain(
      'disabled=""',
    )
  })

  // One dim line, not a designed blank area: the door is directly above it.
  it('says an empty project has no conversations in one line', () => {
    const html = render([])
    expect(html).toContain('No conversations yet.')
    expect(html).not.toContain('the first one starts above')
  })

  it('shows nothing at all while the list is still in flight', () => {
    expect(render([], true)).toBe('')
  })
})

describe('TranscriptPane', () => {
  const html = renderToStaticMarkup(
    <TranscriptPane
      conversation={conversation()}
      onBack={() => {}}
      onReopen={() => {}}
      reopening={false}
    >
      <div>the turns</div>
    </TranscriptPane>,
  )

  it('carries the way out, the name, the date and the way in', () => {
    expect(html).toContain('← Conversations')
    expect(html).toContain('Read the audit handoff and turn it into features')
    expect(html).toContain('3h')
    expect(html).toContain('Reopen')
  })

  it('renders whatever reads the transcript inside it', () => {
    expect(html).toContain('<div>the turns</div>')
  })
})

describe('TranscriptBubbles', () => {
  const html = renderToStaticMarkup(
    <TranscriptBubbles
      turns={[
        { role: 'assistant', text: '## Whats decided\n\n- **Decision 3** — the phases' },
        { role: 'user', text: 'make the **whole** workflow custom' },
      ]}
      assistant="Claude"
    />,
  )

  // Real transcripts showed their `##` and `**` literally (decisions.md #11).
  it('renders the agent turn as the Markdown it was written as', () => {
    expect(html).toContain('>Whats decided</h2>')
    expect(html).toContain('>Decision 3</strong>')
  })

  // A human's turn is what they typed, so it is shown as typed.
  it('leaves the human turn as plain text', () => {
    expect(html).toContain('make the **whole** workflow custom')
  })

  it('labels each side with whoever said it', () => {
    expect(html).toContain('Claude')
    expect(html).toContain('You')
  })
})
