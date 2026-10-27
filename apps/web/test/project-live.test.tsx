// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fakeTrpc } from './fake-trpc'

vi.mock('../src/lib/toast', () => ({ useToast: () => ({ push: () => undefined }) }))
vi.mock('../src/lib/live', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/live')>()),
  useLivePoll: () => false,
}))

const { ConversationList } = await import('../src/components/project/ConversationList')
const { ProjectChat } = await import('../src/components/project/ProjectChat')
const { NewChatCard } = await import('../src/components/project/NewChatCard')
const { useProjectTalk } = await import('../src/lib/use-project-talk')
import type { ProjectConversation } from '../src/lib/api'
import type { SessionBranchApi } from '../src/lib/use-session-branch'

const openConversation = {
  id: 'session-row-id',
  title: 'Untitled',
  createdAt: 1,
  status: 'live',
  resumable: true,
} as ProjectConversation

const landing: SessionBranchApi = {
  value: 'main',
  branches: ['main'],
  detected: 'main',
  missing: false,
  picking: false,
  pick: () => {},
}

const at = 1_700_000_000_000

/** The project's server: one chat with history, and a fresh one `talkToProject` opens. */
function server() {
  return fakeTrpc({
    'project.projectSession': () => null,
    'project.conversations': () => [],
    'project.talkToProject': () => ({ sessionId: 'th_fresh' }),
    'thread.view': () => ({ items: [], state: 'idle', plan: [], tasks: [], commands: [], process: 'stopped', cursor: -1 }),
    'thread.events': ({ threadId }: { threadId: string }) => ({
      events:
        threadId === 'th_old'
          ? [
              { i: 0, at, type: 'prompt', id: 'p1', text: 'Cut the notes idea into features', source: 'human' },
              { i: 1, at, type: 'agent_text', messageId: 'm1', text: 'Three features: capture, triage, export.' },
            ]
          : [],
    }),
    'thread.send': () => ({ promptId: 'p_new' }),
  })
}

/** The project page's chat column as it wires a project chat. */
function Column({ threadId, onStarted = () => {} }: { threadId: string | null; onStarted?: (id: string) => void }) {
  const talk = useProjectTalk('proj_1')
  return <ProjectChat projectId="proj_1" threadId={threadId} start={talk.begin} onStarted={onStarted} onOpenThread={() => {}} landing="main" />
}

describe('a project chat', () => {
  afterEach(() => {
    cleanup()
    localStorage.clear()
  })

  it('opens at once as its thread, finished or not, with the landing branch under the composer and no End session', async () => {
    const api = server()
    render(<Column threadId="th_old" />, { wrapper: api.Wrapper })

    const chat = screen.getByRole('region', { name: 'Project chat' })
    expect(await screen.findByText('Three features: capture, triage, export.')).toBeTruthy()
    expect(chat.textContent).toContain('Lands on main')
    expect(screen.getByLabelText('Message')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /End session|Resume/ })).toBeNull()
  })

  it('starts a new chat through talkToProject on its first Send, then sends the message to it', async () => {
    const api = server()
    const onStarted = vi.fn()
    render(<Column threadId={null} onStarted={onStarted} />, { wrapper: api.Wrapper })

    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'A notes inbox for the project' } })
    fireEvent.keyDown(screen.getByLabelText('Message'), { key: 'Enter' })

    expect(await screen.findByText('A notes inbox for the project')).toBeTruthy()
    await waitFor(() => expect(api.inputs('thread.send')).toEqual([{ threadId: 'th_fresh', text: 'A notes inbox for the project' }]))
    expect(api.inputs('project.talkToProject')).toEqual([{ projectId: 'proj_1', fresh: true, holdOpening: true }])
    expect(onStarted).toHaveBeenCalledWith('th_fresh')
  })
})

describe('the resting list', () => {
  afterEach(cleanup)

  it('keeps the open conversation transcript reachable from its title', () => {
    let viewed: ProjectConversation | null = null
    render(
      <ConversationList
        conversations={[openConversation]}
        pending={false}
        busy={false}
        onOpen={() => {}}
        onView={(conversation) => {
          viewed = conversation
        }}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /Untitled chat/ }))
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
