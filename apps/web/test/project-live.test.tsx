// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionBranchApi } from '../src/lib/use-session-branch'
import { fakeTrpc } from './fake-trpc'

vi.mock('../src/lib/toast', () => ({ useToast: () => ({ push: () => undefined }) }))
vi.mock('../src/lib/live', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/live')>()),
  useLivePoll: () => false,
}))

const { ProjectChat } = await import('../src/components/project/ProjectChat')

const at = 1_700_000_000_000

const landing: SessionBranchApi = {
  value: 'main',
  branches: ['main', 'develop'],
  detected: 'main',
  missing: false,
  pick: () => {},
  picking: false,
}

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
    render(<ProjectChat threadId="th_old" onOpenThread={() => {}} landing={landing} />, { wrapper: api.Wrapper })

    const chat = screen.getByRole('region', { name: 'Project chat' })
    expect(await screen.findByText('Three features: capture, triage, export.')).toBeTruthy()
    expect(chat.textContent).toContain('Lands on main')
    expect(screen.getByLabelText('Message')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /End session|Resume/ })).toBeNull()
  })

  it('offers the landing branch as a menu only while nothing has been said', async () => {
    const api = server()
    render(<ProjectChat threadId="th_new" onOpenThread={() => {}} landing={landing} />, { wrapper: api.Wrapper })
    expect(await screen.findByRole('button', { name: /Lands on main/ })).toBeTruthy()
    cleanup()

    render(<ProjectChat threadId="th_old" onOpenThread={() => {}} landing={landing} />, { wrapper: api.Wrapper })
    await screen.findByText('Three features: capture, triage, export.')
    expect(screen.queryByRole('button', { name: /Lands on main/ })).toBeNull()
  })

  it('asks what we are building while nothing has been said', async () => {
    const api = server()
    render(<ProjectChat threadId="th_new" onOpenThread={() => {}} landing={landing} />, { wrapper: api.Wrapper })
    expect(await screen.findByRole('heading', { name: 'What are we building?' })).toBeTruthy()
    expect(screen.queryByText('New thread')).toBeNull()
  })

  it('sends the first message of a new, empty chat to its own thread', async () => {
    const api = server()
    render(<ProjectChat threadId="th_new" onOpenThread={() => {}} landing={landing} />, { wrapper: api.Wrapper })

    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'A notes inbox for the project' } })
    fireEvent.keyDown(screen.getByLabelText('Message'), { key: 'Enter' })

    expect(await screen.findByText('A notes inbox for the project')).toBeTruthy()
    await waitFor(() => expect(api.inputs('thread.send')).toEqual([{ threadId: 'th_new', text: 'A notes inbox for the project' }]))
  })
})
