// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ThreadEvent } from '@runcastle/core'
import { fakeTrpc } from './fake-trpc'

/**
 * Typing keeps up in a long chat (a-faster-web-app, "Fix typing"): a key in the
 * composer redraws no message, and a chunk an agent streams redraws only the
 * message it grew. Every agent message draws through `Markdown`, so counting
 * its renders counts the messages redrawn.
 */

const renders = vi.hoisted(() => ({ markdown: 0 }))
vi.mock('../src/components/Markdown', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/components/Markdown')>()
  return {
    ...real,
    Markdown: (props: { source: string }) => {
      renders.markdown++
      return <div>{props.source}</div>
    },
  }
})
vi.mock('../src/lib/toast', () => ({ useToast: () => ({ push: () => undefined }) }))
vi.mock('../src/lib/live', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/live')>()),
  useLivePoll: () => false,
}))

const { ThreadColumn } = await import('../src/components/chat/ThreadColumn')
const { SAVE_AFTER_MS, flushDrafts } = await import('../src/lib/drafts')

const at = 1_700_000_000_000
const TURNS = 150

/** A long chat whose agent is streaming its answer to the last question. */
function longChat(): ThreadEvent[] {
  const log: ThreadEvent[] = [{ i: 0, at, type: 'process', state: 'running' }]
  const add = (e: Record<string, unknown>) => log.push({ i: log.length, at, ...e } as ThreadEvent)
  for (let n = 0; n < TURNS; n++) {
    add({ type: 'prompt', id: `p${n}`, text: `Question ${n}`, source: 'human' })
    add({ type: 'turn_started' })
    add({ type: 'agent_text', messageId: `m${n}`, text: `Answer **${n}**` })
    add({ type: 'turn_ended', reason: 'end_turn' })
  }
  add({ type: 'prompt', id: 'p_live', text: 'One more', source: 'human' })
  add({ type: 'turn_started' })
  add({ type: 'agent_text', messageId: 'm_live', text: 'Streaming ' })
  return log
}

function server(log: ThreadEvent[]) {
  return fakeTrpc({
    'thread.events': ({ after }: { after?: number }) => ({ events: log.filter((e) => after === undefined || e.i > after) }),
    'thread.files': () => [],
  })
}

afterEach(() => {
  cleanup()
  flushDrafts()
  localStorage.clear()
  renders.markdown = 0
  vi.useRealTimers()
})

describe('typing in a long chat', () => {
  it('redraws no message for a key, and only the growing message for a streamed chunk', async () => {
    const log = longChat()
    const api = server(log)
    render(<ThreadColumn threadId="th1" />, { wrapper: api.Wrapper })
    await screen.findByText('Streaming')
    expect(renders.markdown).toBeGreaterThanOrEqual(TURNS + 1)

    renders.markdown = 0
    const box = screen.getByLabelText('Message') as HTMLTextAreaElement
    let typed = ''
    for (const ch of 'hello there') {
      typed += ch
      fireEvent.change(box, { target: { value: typed } })
    }
    expect(box.value).toBe('hello there')
    expect(renders.markdown).toBe(0)

    log.push({ i: log.length, at, type: 'agent_text', messageId: 'm_live', text: 'more words' })
    await act(() => api.queryClient.invalidateQueries({ queryKey: [['thread', 'events']] }))
    await screen.findByText('Streaming more words')
    expect(renders.markdown).toBe(1)
  })

  it('saves the draft after a pause, not on every key, and at once when the page hides', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    render(<ThreadColumn threadId="th1" />, { wrapper: server([]).Wrapper })
    const box = screen.getByLabelText('Message')
    fireEvent.change(box, { target: { value: 'half' } })
    expect(localStorage.getItem('runcastle.thread.draft:th1')).toBeNull()
    await act(() => vi.advanceTimersByTimeAsync(SAVE_AFTER_MS))
    expect(localStorage.getItem('runcastle.thread.draft:th1')).toBe('half')

    fireEvent.change(box, { target: { value: 'half a thought' } })
    window.dispatchEvent(new Event('pagehide'))
    expect(localStorage.getItem('runcastle.thread.draft:th1')).toBe('half a thought')
  })

  it('asks for `@` files once the typing pauses', async () => {
    const api = server([])
    render(<ThreadColumn threadId="th1" />, { wrapper: api.Wrapper })
    const box = screen.getByLabelText('Message')
    let typed = 'see @'
    for (const ch of 'src/lib') {
      typed += ch
      fireEvent.change(box, { target: { value: typed } })
    }
    await waitFor(() => expect(api.inputs('thread.files')).toEqual([{ threadId: 'th1', query: 'src/lib', limit: 8 }]))
  })
})
