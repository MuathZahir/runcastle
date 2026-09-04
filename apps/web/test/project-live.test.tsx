// @vitest-environment happy-dom
import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ConversationList } from '../src/components/project/ConversationList'
import { LiveChat } from '../src/components/project/LiveChat'
import { NewChatCard } from '../src/components/project/NewChatCard'
import type { ProjectConversation, ProjectSession } from '../src/lib/api'
import type { SessionBranchApi } from '../src/lib/use-session-branch'

const session = {
  id: 'session-row-id',
  ccSessionId: 'f5b41d9e-rest-of-id',
  status: 'live',
} as NonNullable<ProjectSession>

const openConversation = {
  id: session.id,
  title: 'Untitled',
  createdAt: 1,
  status: 'live',
  resumable: true,
} as ProjectConversation

const endedConversation = {
  ...openConversation,
  id: 'older',
  title: 'An older idea',
  status: 'ended',
} as ProjectConversation

const landing: SessionBranchApi = {
  value: 'main',
  branches: ['main'],
  detected: 'main',
  missing: false,
  picking: false,
  pick: () => {},
}

describe('live project chat', () => {
  afterEach(cleanup)

  it('renders the complete live strip', () => {
    render(
      <LiveChat
        session={session}
        title="Untitled"
        branch="main"
        hidden={false}
        onBack={() => {}}
        endControl={<button>End session</button>}
      >
        <div>terminal</div>
      </LiveChat>,
    )

    expect(screen.getByRole('button', { name: '← Conversations' })).toBeTruthy()
    expect(screen.getByText('Untitled')).toBeTruthy()
    expect(screen.getByText('live')).toBeTruthy()
    expect(screen.getByText('→ main')).toBeTruthy()
    expect(screen.getByText('f5b41d9e')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'End session' })).toBeTruthy()
  })

  it('goes back to the list and opens the mounted terminal without launching', () => {
    let launches = 0
    function Harness() {
      const [list, setList] = useState(false)
      return (
        <>
          <LiveChat
            session={session}
            title="Untitled"
            branch="main"
            hidden={list}
            onBack={() => setList(true)}
            endControl={<button>End session</button>}
          >
            <div data-testid="terminal">terminal</div>
          </LiveChat>
          {list && (
            <>
              <NewChatCard
                landing={landing}
                onStart={() => launches++}
                starting={false}
              />
              <ConversationList
                conversations={[endedConversation, openConversation]}
                pending={false}
                busy={false}
                onResume={() => launches++}
                onOpen={() => setList(false)}
                onView={() => {}}
              />
            </>
          )}
        </>
      )
    }
    render(<Harness />)

    fireEvent.click(screen.getByRole('button', { name: '← Conversations' }))
    const open = screen.getByRole('button', { name: 'Open' })
    const terminal = screen.getByTestId('terminal')
    expect(terminal).toBeTruthy()
    expect(terminal.closest('[data-live-chat]')?.classList.contains('hidden')).toBe(true)
    expect(screen.getByText('Talk it through')).toBeTruthy()
    expect(screen.queryByText('A chat is already open.')).toBeNull()

    fireEvent.click(open)
    expect(launches).toBe(0)
    expect(terminal.closest('[data-live-chat]')?.classList.contains('hidden')).toBe(false)
    expect(screen.queryByText('An older idea')).toBeNull()
  })

  it('keeps the open conversation transcript reachable from its title', () => {
    let viewed: ProjectConversation | null = null
    render(
      <ConversationList
        conversations={[openConversation]}
        pending={false}
        busy={false}
        onResume={() => {}}
        onOpen={() => {}}
        onView={(conversation) => {
          viewed = conversation
        }}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Untitled' }))
    expect(viewed).toBe(openConversation)
  })

  it('offers both inline choices when New finds a chat open', () => {
    let opened = 0
    let replaced = 0
    render(
      <NewChatCard
        landing={landing}
        onStart={() => {}}
        starting={false}
        openSession={{ onOpen: () => opened++, onReplace: () => replaced++ }}
      />,
    )

    expect(screen.getByRole('status').textContent).toContain('A chat is already open.')
    expect(screen.getByText('Talk it through')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'New chat' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'landing on main' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Open it' }))
    fireEvent.click(screen.getByRole('button', { name: 'End it and start new' }))
    expect({ opened, replaced }).toEqual({ opened: 1, replaced: 1 })
  })
})
