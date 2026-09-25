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

/** The opening `<button …>` tag whose text or accessible name is `label`. */
const buttonTag = (html: string, label: string): string => {
  const at = Math.max(html.indexOf(`aria-label="${label}"`), html.indexOf(`>${label}<`))
  const start = html.lastIndexOf('<button', at)
  return html.slice(start, html.indexOf('>', start) + 1)
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

  it('is a quiet row, not a bordered card', () => {
    const html = render()
    expect(html).not.toContain('rounded-lg border')
    expect(html).toContain('bg-surface-hover')
  })

  it('makes New chat the one primary', () => {
    expect(buttonTag(render(), 'New chat')).toContain('data-variant="primary"')
  })

  it('keeps the heading and copy free of UA margins', () => {
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
    expect(buttonTag(render({ missing: true, value: 'release/1.2' }), 'New chat')).toContain(
      'disabled=""',
    )
  })

  it('leaves New chat live while a usable branch is chosen', () => {
    expect(buttonTag(render(), 'New chat')).not.toContain('disabled=""')
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
    const html = render([conversation()])
    expect(html).toContain('opacity-0')
    expect(html).toContain('group-hover/row:opacity-100')
    expect(html).toContain('group-focus-within/row:opacity-100')
  })

  // Titles are the first thing typed: pasted markup and escapes are not a name.
  it('cleans raw pasted markup out of a title, and names an empty one', () => {
    const html = render([
      conversation({ id: 'a', title: '<pasted_content id="8dcd"> ## Problem: the image is stale' }),
      conversation({ id: 'b', title: 'Untitled' }),
    ])
    expect(html).toContain('>Problem: the image is stale<')
    expect(html).not.toContain('pasted_content')
    expect(html).toContain('>Untitled chat<')
  })

  it('pages a long history behind Show more, and offers a filter', () => {
    const many = Array.from({ length: 14 }, (_, i) =>
      conversation({ id: `s${i}`, title: `Chat number ${i}` }),
    )
    const html = render(many)
    expect(html).toContain('Chat number 9')
    expect(html).not.toContain('Chat number 10')
    expect(html).toContain('Show 4 more')
    expect(html).toContain('aria-label="Filter chats"')
    expect(render([conversation()])).not.toContain('Filter chats')
  })

  it('marks a conversation that is still open', () => {
    const open = render([conversation({ status: 'live' })])
    expect(open).toContain('title="live"')
    expect(render([conversation()])).not.toContain('title="live"')
  })

  it('offers no Reopen on a conversation the agent never picked up', () => {
    expect(buttonTag(render([conversation({ resumable: false })]), 'Reopen')).toContain(
      'disabled=""',
    )
  })

  // An EmptyState, never a box: a title and one hint pointing at the door above.
  it('says an empty project has no chats yet', () => {
    const html = render([])
    expect(html).toContain('No chats yet')
    expect(html).toContain('A new chat starts from the row above.')
    expect(html).not.toContain('border')
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
    // the way out is the parent crumb: the project
    expect(html).toContain('aria-label="Breadcrumb"')
    expect(html).toMatch(/<button[^>]*>.*Project<\/span><\/button>/)
    expect(html).toContain('Read the audit handoff and turn it into features')
    expect(html).toContain('Started 3h ago')
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
