import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { clearRuntimeCtx, setRuntimeCtx } from '../src/launcher/runtime'
import { createSessionRow, getSessionRow, markSessionLive } from '../src/launcher/sessions'
import { markAutoResumed, setUntouchedLeaveGrace } from '../src/launcher/untouched'
import { type TerminalSink, ptyRegistry } from '../src/pty/registry'
import hooksApp from '../src/routes/hooks'
import { listAfter } from '../src/services/events'
import { makeTestCtx } from './helpers/db'
import { seedFeature, seedProject } from './helpers/fixtures'

// The process behind the terminal is the system boundary: a fake that exits
// when killed, so ending the session plays out as it would for a real one.
vi.mock('../src/pty/pty', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/pty/pty')>()),
  createPtySession: () => {
    const exits: ((e: { exitCode: number }) => void)[] = []
    const exit = (): void => {
      for (const listener of exits.splice(0)) listener({ exitCode: 0 })
    }
    return {
      pid: 4242,
      killed: false,
      onData: () => ({ dispose() {} }),
      onExit: (listener: (e: { exitCode: number }) => void) => {
        exits.push(listener)
        return { dispose() {} }
      },
      write() {},
      resize() {},
      kill: exit,
      killTree: async () => exit(),
    }
  },
}))

const GRACE_MS = 50

/**
 * Untouched auto-resumed chats close when you leave
 * (`opening-a-feature-shows-its-chat-as-you-left-it` decision 2): one that has
 * received no prompt is ended once no terminal has been attached for the grace;
 * an attach inside the grace keeps it, and any prompt keeps it for good.
 */
describe('the untouched-leave rule', () => {
  let ctx: AppCtx
  let featureId: string
  let sessionId: string
  let restoreGrace: () => void

  beforeEach(async () => {
    ctx = await makeTestCtx()
    featureId = seedFeature(ctx, seedProject(ctx).id, { slug: 'left' }).id
    sessionId = createSessionRow(ctx, { featureId, kind: 'chat', worktreePath: 'w' }).id
    markSessionLive(ctx, sessionId, { ccSessionId: 'cc-auto' })
    ptyRegistry().create({ sessionId, cmd: 'claude', args: [], opts: {} })
    setRuntimeCtx(ctx)
    restoreGrace = setUntouchedLeaveGrace(GRACE_MS)
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    restoreGrace()
    clearRuntimeCtx()
    ptyRegistry().remove(sessionId)
  })

  const sink = (): TerminalSink => ({ sendData() {}, sendControl() {} })
  const status = (): string | undefined => getSessionRow(ctx, sessionId)?.status
  const endedByUser = (): boolean =>
    listAfter(ctx, featureId, 0).some(
      (e) => e.type === 'session.ended' && e.message.includes('resumed by itself and was left unused'),
    )

  async function prompt(text: string): Promise<void> {
    const app = new Hono()
    app.route('/api/hooks', hooksApp)
    await app.request('/api/hooks/user-prompt', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId, payload: { prompt: text, hook_event_name: 'UserPromptSubmit' } }),
    })
  }

  it('ends a chat spawned with nobody watching once the grace runs out', () => {
    markAutoResumed(ctx, sessionId)

    vi.advanceTimersByTime(GRACE_MS - 1)
    expect(status()).toBe('live')
    vi.advanceTimersByTime(1)
    expect(status()).toBe('ended')
    expect(endedByUser()).toBe(true)
  })

  it('ends it once the last terminal detaches and stays away past the grace', () => {
    const watching = sink()
    ptyRegistry().attach(sessionId, watching)
    markAutoResumed(ctx, sessionId)

    vi.advanceTimersByTime(GRACE_MS * 3)
    expect(status()).toBe('live')

    ptyRegistry().detach(sessionId, watching)
    vi.advanceTimersByTime(GRACE_MS)
    expect(status()).toBe('ended')
  })

  it('keeps it when a terminal attaches again inside the grace — a reload', () => {
    const before = sink()
    ptyRegistry().attach(sessionId, before)
    markAutoResumed(ctx, sessionId)
    ptyRegistry().detach(sessionId, before)

    vi.advanceTimersByTime(GRACE_MS - 10)
    ptyRegistry().attach(sessionId, sink())
    vi.advanceTimersByTime(GRACE_MS * 3)
    expect(status()).toBe('live')
  })

  it('keeps it for good once the human has typed into it', async () => {
    markAutoResumed(ctx, sessionId)
    await prompt('where were we?')

    vi.advanceTimersByTime(GRACE_MS * 3)
    expect(status()).not.toBe('ended')
  })

  it('keeps it for good once runcastle has delivered a prompt into it', async () => {
    const watching = sink()
    ptyRegistry().attach(sessionId, watching)
    markAutoResumed(ctx, sessionId)
    await prompt('[runcastle] the round finished')
    ptyRegistry().detach(sessionId, watching)

    vi.advanceTimersByTime(GRACE_MS * 3)
    expect(status()).not.toBe('ended')
  })
})
