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

import { ConversationTranscript } from '../src/components/ConversationTranscript'

describe('ConversationTranscript', () => {
  it('renders a populated conversation even when only the assistant spoke after kickoff filtering', () => {
    const html = renderToStaticMarkup(<ConversationTranscript sessionId="session-1" />)

    expect(html).toContain('<h2>Welcome</h2>')
    expect(html).toContain('What are we building?')
    expect(html).not.toContain('nothing was said in this conversation')
  })
})
