import { describe, expect, it, vi } from 'vitest'
import { postHook } from '../src/launcher/hook-client'

/**
 * REGRESSION (lap-2 drive): a `session-start` POST that took 3.1s timed out in
 * the hook client with no retry, so the chat never recorded its conversation id
 * and the lead's headless wake started a fresh conversation instead of resuming.
 */
describe('the hook client’s POST', () => {
  /** A fetch that answers each call with the next of `answers` (an Error rejects). */
  function fakeFetch(answers: Array<string | Error>): ReturnType<typeof vi.fn> & typeof fetch {
    let i = 0
    return vi.fn(async () => {
      const next = answers[i++] ?? new Error('no more answers')
      if (next instanceof Error) throw next
      return new Response(next)
    }) as unknown as ReturnType<typeof vi.fn> & typeof fetch
  }
  const timeout = (): Error => new DOMException('The operation timed out.', 'TimeoutError')
  const noSleep = async (): Promise<void> => {}

  it('retries a session-start that timed out, and returns the answer that came back', async () => {
    const fetch = fakeFetch([timeout(), '{"hookSpecificOutput":{}}'])

    expect(await postHook('http://x', 'session-start', { event: 'session-start' }, { fetch, sleep: noSleep })).toBe(
      '{"hookSpecificOutput":{}}',
    )
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(fetch.mock.calls[0]?.[0]).toBe('http://x/api/hooks/session-start')
  })

  it('gives a session-start up after three attempts', async () => {
    const fetch = fakeFetch([timeout(), timeout(), timeout(), '{}'])

    await expect(postHook('http://x', 'session-start', {}, { fetch, sleep: noSleep })).rejects.toThrow(/timed out/)
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('tries every other hook once — it blocks a turn or a tool', async () => {
    for (const event of ['user-prompt', 'stop', 'pre-tool', 'session-end']) {
      const fetch = fakeFetch([timeout(), '{}'])
      await expect(postHook('http://x', event, {}, { fetch, sleep: noSleep })).rejects.toThrow(/timed out/)
      expect(fetch).toHaveBeenCalledTimes(1)
    }
  })
})
