// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ThreadEvent } from '@runcastle/core'
import { Composer } from '../src/components/chat/thread/Composer'
import { ApprovalDock, QuestionDock } from '../src/components/chat/thread/AskDock'
import { fakeTrpc } from './fake-trpc'
import { atWidth } from './phone-width'

/**
 * A chat by thumb (runcastle-on-your-phone decision 8): on a phone the
 * keyboard's Enter breaks the line and only Send sends, no keyboard hint shows,
 * and the composer's foot holds what fits 390px.
 */

vi.mock('../src/lib/toast', () => ({ useToast: () => ({ push: () => {} }) }))
vi.mock('../src/lib/live', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/live')>()),
  useLivePoll: () => false,
}))

const { ThreadColumn } = await import('../src/components/chat/ThreadColumn')

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  localStorage.clear()
})

function composer(onSend = vi.fn()) {
  render(<Composer value="Ship it" onChange={() => {}} state="idle" onSend={onSend} suggestion="Merge it" />)
  return onSend
}

describe('the composer', () => {
  it('on a phone, Enter is the keyboard’s own new line and only Send sends', () => {
    atWidth(true)
    const onSend = composer()
    const field = screen.getByLabelText('Message')
    // Not prevented: the textarea breaks the line as it would anywhere.
    expect(fireEvent.keyDown(field, { key: 'Enter' })).toBe(true)
    expect(onSend).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(onSend).toHaveBeenCalledOnce()
  })

  it('at desktop width, Enter still sends', () => {
    atWidth(false)
    const onSend = composer()
    expect(fireEvent.keyDown(screen.getByLabelText('Message'), { key: 'Enter' })).toBe(false)
    expect(onSend).toHaveBeenCalledOnce()
  })

  it('on a phone, shows no keyboard hint and no Tab-taken guess, and asks shortly', () => {
    atWidth(true)
    render(<Composer value="" onChange={() => {}} state="idle" onSend={() => {}} suggestion="Merge it" />)
    expect(document.querySelector('kbd')).toBeNull()
    expect(screen.queryByText('Merge it')).toBeNull()
    expect(screen.getByLabelText('Message').getAttribute('placeholder')).toBe('Message the agent')
  })
})

describe('the ask docks on a phone', () => {
  it('show no keyboard hints, and keep their answers', () => {
    atWidth(true)
    const onAnswer = vi.fn()
    render(<QuestionDock questions={[{ question: 'Which?', header: 'Pick', multiSelect: false, options: [{ label: 'A' }, { label: 'B' }] }]} onAnswer={onAnswer} />)
    render(<ApprovalDock call={{ id: 'c1', kind: 'execute', title: 'bun test', status: 'pending' }} onAnswer={() => {}} />)
    expect(document.querySelector('kbd')).toBeNull()
    expect(screen.getByRole('button', { name: 'Deny' })).toBeTruthy()
    fireEvent.click(screen.getByRole('radio', { name: 'B' }))
    expect(onAnswer).toHaveBeenCalledWith({ 'Which?': 'B' })
  })
})

describe('the chat column’s composer on a phone', () => {
  const at = 1_700_000_000_000
  const opened: ThreadEvent[] = [
    { i: 0, at, type: 'model', model: 'claude-opus-5-5', label: 'Opus 5.5' },
    { i: 1, at, type: 'usage', context: { used: 40_000, size: 200_000 } },
    { i: 2, at, type: 'prompt', id: 'p1', text: 'Line the button up', source: 'human' },
    { i: 3, at, type: 'turn_started' },
  ]
  const server = (log: ThreadEvent[]) =>
    fakeTrpc({
      'thread.view': () => ({ items: [], state: 'idle', plan: [], tasks: [], commands: [], process: 'running', cursor: -1 }),
      'thread.events': ({ after }: { after?: number }) => ({ events: log.filter((e) => after === undefined || e.i > after) }),
    })

  it('keeps the model controls and the context meter, and drops the line under it, while idle', async () => {
    atWidth(true)
    const ended: ThreadEvent[] = [...opened, { i: 4, at, type: 'turn_ended', reason: 'end_turn' }]
    render(<ThreadColumn threadId="th1" meta="Feature worktree · feature/x" />, { wrapper: server(ended).Wrapper })
    expect(await screen.findByRole('button', { name: 'Model' })).toBeTruthy()
    // The meter shows on the phone as on the desktop (phone-fixes decision 4).
    expect(screen.getByRole('button', { name: /Context \d+% used/ })).toBeTruthy()
    expect(screen.queryByText('Feature worktree · feature/x')).toBeNull()
  })

  it('shows only the working clock, Stop and Send while the agent works', async () => {
    atWidth(true)
    render(<ThreadColumn threadId="th1" />, { wrapper: server(opened).Wrapper })
    expect(await screen.findByRole('button', { name: 'Stop' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Model' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Context/ })).toBeNull()
    expect(screen.getByRole('status').textContent).toContain('Working')
  })
})
