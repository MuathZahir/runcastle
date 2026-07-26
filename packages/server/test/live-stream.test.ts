import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import streamApp from '../src/routes/stream'
import { appendTranscript, beginTranscript, clearAllTranscripts } from '../src/services/agent-stream'
import { liveSubscriberCount, publishLive, subscribeLive } from '../src/services/bus'
import { emit, emitProject } from '../src/services/events'
import { makeTestCtx } from './helpers/db'
import { seedFeature, seedProject } from './helpers/fixtures'

/**
 * The live-update path: every emit publishes on the bus, and `GET /api/stream`
 * turns those publishes into SSE frames. This is what makes the UI realtime
 * instead of dependent on poll timers the browser throttles in a hidden tab.
 */

/**
 * Mount the sub-app the way `buildApp` does. Importing `src/index` directly
 * would drag in `bun:sqlite`, which vitest's node runtime cannot load — same
 * reason `hooks-route.test.ts` mounts its sub-app by hand.
 */
function mount(): Hono {
  const app = new Hono()
  app.route('/api/stream', streamApp)
  return app
}

/**
 * A single long-lived reader over one SSE response. The connection has to stay
 * open across several reads — cancelling between them would look like a closed
 * tab and tear down the very subscription under test.
 */
function sseReader(res: Response) {
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let text = ''

  return {
    /** Accumulate frames until `predicate` matches; returns everything seen. */
    async until(predicate: (text: string) => boolean, timeoutMs = 5000): Promise<string> {
      const deadline = Date.now() + timeoutMs
      if (predicate(text)) return text
      while (Date.now() < deadline) {
        const race = await Promise.race([
          reader.read(),
          new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), Math.max(0, deadline - Date.now()))),
        ])
        if (race === 'timeout' || race.done) break
        text += decoder.decode(race.value, { stream: true })
        if (predicate(text)) return text
      }
      return text
    },
    /** What a closed browser tab looks like to the server. */
    async disconnect(): Promise<void> {
      await reader.cancel().catch(() => {})
    },
  }
}

describe('live bus', () => {
  let ctx: AppCtx
  let projectId: string
  let featureId: string

  beforeEach(async () => {
    ctx = await makeTestCtx()
    projectId = seedProject(ctx).id
    featureId = seedFeature(ctx, projectId).id
  })

  afterEach(() => {
    clearAllTranscripts()
  })

  it('publishes a signal for every emitted event, feature- and project-scoped', () => {
    const seen: unknown[] = []
    const off = subscribeLive((s) => seen.push(s))

    const e = emit(ctx, featureId, { type: 'spec.written', message: 'spec' })
    emitProject(ctx, projectId, { type: 'project.renamed', message: 'renamed' })
    off()

    expect(seen).toEqual([
      { kind: 'event', projectId, featureId, eventId: e.id },
      { kind: 'event', projectId, featureId: undefined, eventId: e.id + 1 },
    ])
  })

  it('publishes transcript signals as the agent streams', () => {
    const seen: unknown[] = []
    const off = subscribeLive((s) => seen.push(s))

    beginTranscript('t1')
    appendTranscript('t1', { kind: 'text', text: 'hello' })
    off()

    expect(seen).toEqual([
      { kind: 'transcript', ticketId: 't1' },
      { kind: 'transcript', ticketId: 't1' },
    ])
  })

  it('unsubscribes cleanly and survives a throwing subscriber', () => {
    const before = liveSubscriberCount()
    const off = subscribeLive(() => {
      throw new Error('boom')
    })
    expect(liveSubscriberCount()).toBe(before + 1)

    // A broken subscriber must never break the mutation that emitted.
    expect(() => publishLive({ kind: 'transcript', ticketId: 't1' })).not.toThrow()

    off()
    expect(liveSubscriberCount()).toBe(before)
  })
})

describe('GET /api/stream', () => {
  let ctx: AppCtx
  let featureId: string

  beforeEach(async () => {
    ctx = await makeTestCtx()
    featureId = seedFeature(ctx, seedProject(ctx).id).id
  })

  it('opens an SSE stream and pushes events as they are emitted', async () => {
    const res = await mount().request('/api/stream')

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/event-stream')
    expect(res.body).toBeTruthy()

    const sse = sseReader(res)
    // `ready` lands first; only then is the subscription guaranteed attached.
    expect(await sse.until((t) => t.includes('event: ready'))).toContain('event: ready')

    emit(ctx, featureId, { type: 'spec.written', message: 'spec' })
    const text = await sse.until((t) => t.includes('event: live'))

    expect(text).toContain('event: live')
    expect(text).toContain('"kind":"event"')
    await sse.disconnect()
  })

  it('releases its bus subscription when the client disconnects', async () => {
    const before = liveSubscriberCount()
    const res = await mount().request('/api/stream')
    const sse = sseReader(res)

    await sse.until((t) => t.includes('event: ready'))
    expect(liveSubscriberCount()).toBe(before + 1)

    // The loop must notice the disconnect and detach, or every page reload
    // would leak a subscriber and its flush timer for the process's lifetime.
    await sse.disconnect()
    const deadline = Date.now() + 5000
    while (liveSubscriberCount() > before && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50))
    }
    expect(liveSubscriberCount()).toBe(before)
  })

  it('coalesces a burst of transcript chunks instead of one frame per token', async () => {
    const res = await mount().request('/api/stream')
    const sse = sseReader(res)
    await sse.until((t) => t.includes('event: ready'))

    beginTranscript('t1')
    for (let i = 0; i < 200; i++) appendTranscript('t1', { kind: 'text', text: `chunk ${i}` })

    const text = await sse.until((t) => t.includes('event: live'))
    const frames = text.split('event: live').length - 1
    expect(frames).toBeGreaterThan(0)
    // 201 publishes must not become 201 frames — the flush window collapses
    // them onto the single `transcript:t1` dedupe key.
    expect(frames).toBeLessThan(5)
    await sse.disconnect()
  })
})
