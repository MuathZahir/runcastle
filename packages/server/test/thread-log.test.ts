import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { Hono } from 'hono'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { newId } from '@runcastle/core'
import streamApp from '../src/routes/stream'
import { subscribeLive, type LiveSignal } from '../src/services/bus'
import { CHUNK_COALESCE_MS, flushThreadLog, threadLogPath } from '../src/threads/log'
import { appendThreadEvent, readThreadEvents } from '../src/threads/types'

/**
 * The thread log (chat-as-web-components ticket 1): JSONL in the thread's
 * session dir, monotonic indices, streaming chunks coalesced, malformed lines
 * skipped, and a live signal per write.
 */

afterEach(() => {
  vi.useRealTimers()
})

describe('the thread log', () => {
  it('appends events with monotonic indices and reads them back after a cursor', () => {
    const id = newId('sess')
    const a = appendThreadEvent(id, { type: 'process', state: 'starting' })
    const b = appendThreadEvent(id, { type: 'turn_started' })
    const c = appendThreadEvent(id, { type: 'turn_ended', reason: 'end_turn' })
    expect([a.i, b.i, c.i]).toEqual([0, 1, 2])
    expect(readThreadEvents(id).map((e) => e.type)).toEqual(['process', 'turn_started', 'turn_ended'])
    expect(readThreadEvents(id, 0).map((e) => e.i)).toEqual([1, 2])
    expect(readThreadEvents(id, 2)).toEqual([])
    expect(readFileSync(threadLogPath(id), 'utf8').trim().split('\n')).toHaveLength(3)
  })

  it('reads an absent log as empty', () => {
    expect(readThreadEvents(newId('sess'))).toEqual([])
  })

  it('skips a malformed line rather than refusing the whole thread', () => {
    const id = newId('sess')
    appendThreadEvent(id, { type: 'turn_started' })
    appendFileSync(threadLogPath(id), '{"i":1,"at":5,"type":"turn_en\n{"i":2,"type":"nonsense"}\n')
    appendThreadEvent(id, { type: 'turn_ended', reason: 'end_turn' })
    expect(readThreadEvents(id).map((e) => e.type)).toEqual(['turn_started', 'turn_ended'])
  })

  it('joins rapid chunks of one message into one event, and writes it before anything later', () => {
    vi.useFakeTimers()
    const id = newId('sess')
    appendThreadEvent(id, { type: 'turn_started' })
    appendThreadEvent(id, { type: 'agent_text', messageId: 'm1', text: 'Hel' })
    appendThreadEvent(id, { type: 'agent_text', messageId: 'm1', text: 'lo' })
    // Held: not in the log until its window closes or something else arrives.
    expect(readThreadEvents(id).map((e) => e.type)).toEqual(['turn_started'])
    appendThreadEvent(id, { type: 'thought', thoughtId: 't1', text: 'hmm' })
    appendThreadEvent(id, { type: 'turn_ended', reason: 'end_turn' })
    const events = readThreadEvents(id)
    expect(events.map((e) => e.type)).toEqual(['turn_started', 'agent_text', 'thought', 'turn_ended'])
    expect(events[1]).toMatchObject({ i: 1, text: 'Hello' })
    expect(events.map((e) => e.i)).toEqual([0, 1, 2, 3])
  })

  it('starts a new event once the coalescing window has passed, or for another message', () => {
    vi.useFakeTimers()
    const id = newId('sess')
    appendThreadEvent(id, { type: 'agent_text', messageId: 'm1', text: 'a' })
    vi.advanceTimersByTime(CHUNK_COALESCE_MS + 1)
    appendThreadEvent(id, { type: 'agent_text', messageId: 'm1', text: 'b' })
    appendThreadEvent(id, { type: 'agent_text', messageId: 'm2', text: 'c' })
    flushThreadLog(id)
    expect(readThreadEvents(id).map((e) => (e.type === 'agent_text' ? e.text : ''))).toEqual(['a', 'b', 'c'])
  })

  it('recovers the next index from the file when the process has no memory of it', async () => {
    const id = newId('sess')
    mkdirSync(dirname(threadLogPath(id)), { recursive: true })
    appendFileSync(threadLogPath(id), `${JSON.stringify({ i: 7, at: 1, type: 'turn_started' })}\n`)
    expect(appendThreadEvent(id, { type: 'turn_ended', reason: 'end_turn' }).i).toBe(8)
  })

  it('publishes a thread signal for every write', () => {
    const seen: LiveSignal[] = []
    const off = subscribeLive((s) => seen.push(s))
    const id = newId('sess')
    appendThreadEvent(id, { type: 'turn_started' })
    off()
    expect(seen).toEqual([{ kind: 'thread', threadId: id }])
  })

  it('dedupes a burst of thread signals per thread on /api/stream', async () => {
    const app = new Hono()
    app.route('/api/stream', streamApp)
    const res = await app.request('/api/stream')
    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    let text = ''
    const until = async (pred: (t: string) => boolean) => {
      const deadline = Date.now() + 3000
      while (!pred(text) && Date.now() < deadline) {
        const r = await Promise.race([reader.read(), new Promise<'t'>((ok) => setTimeout(() => ok('t'), 200))])
        if (r !== 't' && !r.done) text += decoder.decode(r.value, { stream: true })
      }
    }
    await until((t) => t.includes('event: ready'))
    const a = newId('sess')
    const b = newId('sess')
    for (let n = 0; n < 50; n++) {
      appendThreadEvent(a, { type: 'usage', context: { used: n, size: 100 } })
      appendThreadEvent(b, { type: 'usage', context: { used: n, size: 100 } })
    }
    await until((t) => t.includes(a) && t.includes(b))
    const frames = text.split('event: live').length - 1
    expect(text).toContain(`"threadId":"${a}"`)
    expect(text).toContain(`"threadId":"${b}"`)
    expect(frames).toBeLessThan(6)
    await reader.cancel().catch(() => {})
  })
})
