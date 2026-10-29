// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ThreadEntry } from '@runcastle/core'
import { fakeTrpc } from './fake-trpc'

vi.mock('../src/lib/toast', () => ({ useToast: () => ({ push: () => undefined }) }))
vi.mock('../src/lib/live', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/live')>()),
  useLivePoll: () => false,
}))

const { ConversationList } = await import('../src/components/project/ConversationList')
const { ProjectChat } = await import('../src/components/project/ProjectChat')

const at = 1_700_000_000_000

/** The project's server: one chat with history, and a new empty one. */
function server() {
  return fakeTrpc({
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

describe('a project chat', () => {
  afterEach(() => {
    cleanup()
    localStorage.clear()
  })

  it('opens at once as its thread, finished or not, with the landing branch under the composer and no End session', async () => {
    const api = server()
    render(<ProjectChat threadId="th_old" onOpenThread={() => {}} landing="main" />, { wrapper: api.Wrapper })

    const chat = screen.getByRole('region', { name: 'Project chat' })
    expect(await screen.findByText('Three features: capture, triage, export.')).toBeTruthy()
    expect(chat.textContent).toContain('Lands on main')
    expect(screen.getByLabelText('Message')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /End session|Resume/ })).toBeNull()
  })

  it('sends the first message of a new, empty chat to its own thread', async () => {
    const api = server()
    render(<ProjectChat threadId="th_new" onOpenThread={() => {}} landing="main" />, { wrapper: api.Wrapper })

    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'A notes inbox for the project' } })
    fireEvent.keyDown(screen.getByLabelText('Message'), { key: 'Enter' })

    expect(await screen.findByText('A notes inbox for the project')).toBeTruthy()
    await waitFor(() => expect(api.inputs('thread.send')).toEqual([{ threadId: 'th_new', text: 'A notes inbox for the project' }]))
  })
})

describe('the resting list', () => {
  afterEach(cleanup)

  it('opens a chat as its thread from its row', () => {
    const opened: string[] = []
    const chat: ThreadEntry = { id: 'th_1', title: 'New chat', role: 'project', state: 'working', createdAt: at, updatedAt: at, runtime: 'claude-code' }
    render(<ConversationList threads={[chat]} pending={false} onOpen={(id) => opened.push(id)} />)

    fireEvent.click(screen.getByRole('button', { name: /New chat/ }))
    expect(opened).toEqual(['th_1'])
  })
})
