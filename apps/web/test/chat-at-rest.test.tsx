// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * A chat at rest with something floating over it (the notice deck): the
 * floating layer covers the transcript, never the one button that resumes the
 * conversation — and a launch that fails says why, under that button (the
 * round-7 review drive, where the "Test drive running" card sat over Resume
 * and a refused resume showed nothing). Tier 2: what is asked is which box
 * holds which.
 */
vi.mock('../src/trpc', () => ({
  trpc: {
    project: {
      conversationTranscript: {
        useQuery: () => ({ isPending: false, data: { status: 'ok', runtime: 'claude-code', turns: [] } }),
      },
    },
  },
}))

const { ChatView } = await import('../src/components/chat/ChatView')

afterEach(cleanup)

describe('ChatView at rest', () => {
  it('floats its overlay over the transcript, outside the Resume bar', () => {
    render(
      <ChatView session={null} transcriptId="sess_old" onLaunch={() => {}}>
        <div data-testid="deck" className="absolute right-4 bottom-4" />
      </ChatView>,
    )
    const layer = screen.getByTestId('deck').parentElement!
    expect(layer.className).toContain('relative')
    expect(layer.contains(screen.getByRole('button', { name: 'Resume the conversation' }))).toBe(false)
  })

  it('says why a launch failed, under the button', () => {
    render(
      <ChatView
        session={null}
        transcriptId="sess_old"
        onLaunch={() => {}}
        launchError="could not create talk worktree: already used by worktree"
      />,
    )
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('could not create talk worktree: already used by worktree')
    const button = screen.getByRole('button', { name: 'Resume the conversation' })
    expect(button.compareDocumentPosition(alert) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})
