import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TranscriptBubbles } from '../src/components/ConversationTranscript'

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
