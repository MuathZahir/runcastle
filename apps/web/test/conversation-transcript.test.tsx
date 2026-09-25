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
            turns: [{ role: 'assistant', text: '## Welcome\n\nWhat are we building?' }],
          },
        }),
      },
    },
  },
}))

import { ConversationTranscript, TranscriptBubbles } from '../src/components/ConversationTranscript'

describe('ConversationTranscript', () => {
  it('renders a populated conversation even when only the assistant spoke after kickoff filtering', () => {
    const html = renderToStaticMarkup(<ConversationTranscript sessionId="session-1" />)

    expect(html).toContain('>Welcome</h2>')
    expect(html).toContain('What are we building?')
    expect(html).not.toContain('nothing was said in this conversation')
  })

  it('renders a slash command as one quiet mono line, not its markup', () => {
    const html = renderToStaticMarkup(
      <TranscriptBubbles
        assistant="Claude"
        turns={[
          { role: 'user', text: '<local-command-caveat>Caveat: ignore these</local-command-caveat>' },
          { role: 'user', text: '<command-name>/clear</command-name>\n<command-message>clear</command-message>\n<command-args></command-args>' },
          { role: 'user', text: '<local-command-stdout>Cleared</local-command-stdout>' },
          { role: 'assistant', text: 'Fresh start.' },
        ]}
      />,
    )
    expect(html).not.toContain('command-name')
    expect(html).not.toContain('Caveat')
    expect(html).toMatch(/data-turn-kind="command"[^>]*font-mono[^>]*>.*\/clear</)
    expect(html).toMatch(/data-turn-kind="output"[^>]*>.*Cleared</)
    // The reading size and colour are props, not `!` overrides.
    expect(html).not.toContain('!')
    expect(html).toContain('text-base')
  })
})
