// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ThreadModels } from '@runcastle/core'
import { fakeTrpc } from './fake-trpc'

/**
 * Every chat surface carries the same model controls (chat-as-web-components
 * decision 13): the project chat and the preparation chat show the effort and
 * fast mode a feature chat shows, before their first message as after it, and
 * their first message runs on what they show.
 */

vi.mock('../src/lib/toast', () => ({ useToast: () => ({ push: () => undefined }) }))
vi.mock('../src/lib/live', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/live')>()),
  useLivePoll: () => false,
}))

const { ProjectChat } = await import('../src/components/project/ProjectChat')
const { PreparationWorkspace } = await import('../src/components/PreparationWorkspace')

/** The catalog as the server answers it: Opus as a session said, Sonnet with its runtime's levels. */
const MODELS: ThreadModels = {
  runtime: 'claude-code',
  models: [
    { id: 'opus', label: 'Opus 5', efforts: ['low', 'medium', 'high', 'max'], defaultEffort: 'high', fast: true },
    { id: 'sonnet', label: 'Sonnet 5', efforts: ['low', 'medium', 'high', 'max'] },
  ],
  current: 'opus',
}

function server() {
  return fakeTrpc({
    'project.list': () => [{ id: 'proj_1', name: 'Demo' }],
    'project.prep': () => ({ prepared: false, preparedAt: null, pendingKeys: [], findings: [] }),
    'project.prepSession': () => null,
    'project.talkToPrep': () => ({ sessionId: 'th_prep' }),
    'thread.list': () => [],
    'thread.models': () => MODELS,
    'thread.view': () => ({ items: [], state: 'idle', plan: [], tasks: [], commands: [], process: 'stopped', cursor: -1 }),
    'thread.events': () => ({ events: [] }),
    'thread.send': () => ({ promptId: 'p1' }),
  })
}

async function expectControls(): Promise<void> {
  expect((await screen.findByRole('button', { name: 'Model' })).textContent).toBe('Opus 5')
  expect(screen.getByRole('combobox', { name: 'Effort' }).textContent).toContain('High')
  expect(screen.getByRole('button', { name: 'Fast mode' })).toBeTruthy()
}

function send(text: string): void {
  fireEvent.change(screen.getByLabelText('Message'), { target: { value: text } })
  fireEvent.keyDown(screen.getByLabelText('Message'), { key: 'Enter' })
}

afterEach(() => {
  cleanup()
  localStorage.clear()
})

describe('the model controls on every chat surface', () => {
  it('the project chat shows effort and fast mode, and its first message carries what the human picked', async () => {
    const api = server()
    const landing = { value: 'main', branches: ['main'], detected: 'main', missing: false, pick: () => undefined, picking: false }
    render(<ProjectChat threadId="th_project" onOpenThread={() => undefined} landing={landing} />, { wrapper: api.Wrapper })
    await expectControls()
    fireEvent.click(screen.getByRole('button', { name: 'Fast mode' }))
    send('Plan the audit')
    await waitFor(() => expect(api.inputs('thread.send')).toEqual([{ threadId: 'th_project', text: 'Plan the audit', fast: true }]))
  })

  it('the preparation chat shows effort and fast mode before it starts, and its untouched first message leaves them to the server', async () => {
    const api = server()
    render(<PreparationWorkspace projectId="proj_1" />, { wrapper: api.Wrapper })
    await expectControls()
    expect(api.inputs('thread.models')).toEqual([{ projectId: 'proj_1', kind: 'prepare' }])
    send('The dev server is bun run dev')
    await waitFor(() => expect(api.inputs('thread.send')).toEqual([{ threadId: 'th_prep', text: 'The dev server is bun run dev' }]))
  })
})
