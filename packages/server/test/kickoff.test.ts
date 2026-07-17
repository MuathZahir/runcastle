import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CONVERGE_KICKOFF_LINE,
  CONVERGE_KICKOFF_SUBMIT_DELAY_MS,
  writeKickoffSequence,
} from '../src/launcher/sessions'

/**
 * Converge-kickoff regression (E2E finding): the kickoff used to write
 * `text + "\r"` in ONE chunk — claude's TUI treated the trailing carriage
 * return as pasted text, so the line sat unsubmitted in the input box until a
 * human pressed Enter. The fix is a two-write sequence: the text alone, then
 * `\r` as its OWN keystroke after a short settle delay.
 */

describe('writeKickoffSequence — two-write submit', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('writes the text first WITHOUT a carriage return, then \\r as a separate delayed write', () => {
    const writes: string[] = []
    const submitted = vi.fn()
    writeKickoffSequence({ write: (d) => writes.push(d), alive: () => true, onSubmitted: submitted })

    // immediately: exactly one write — the bare text, no \r or \n anywhere
    expect(writes).toEqual([CONVERGE_KICKOFF_LINE])
    expect(writes[0]).not.toMatch(/[\r\n]/)
    expect(submitted).not.toHaveBeenCalled()

    // just before the submit delay: still nothing
    vi.advanceTimersByTime(CONVERGE_KICKOFF_SUBMIT_DELAY_MS - 1)
    expect(writes).toHaveLength(1)

    // at the delay: the second write is EXACTLY the carriage return, alone
    vi.advanceTimersByTime(1)
    expect(writes).toEqual([CONVERGE_KICKOFF_LINE, '\r'])
    expect(submitted).toHaveBeenCalledTimes(1)
  })

  it('fires once — no further writes after the submit keystroke', () => {
    const writes: string[] = []
    writeKickoffSequence({ write: (d) => writes.push(d), alive: () => true })
    vi.advanceTimersByTime(CONVERGE_KICKOFF_SUBMIT_DELAY_MS * 10)
    expect(writes).toEqual([CONVERGE_KICKOFF_LINE, '\r'])
  })

  it('skips entirely when the PTY is already gone', () => {
    const writes: string[] = []
    const submitted = vi.fn()
    writeKickoffSequence({ write: (d) => writes.push(d), alive: () => false, onSubmitted: submitted })
    vi.advanceTimersByTime(CONVERGE_KICKOFF_SUBMIT_DELAY_MS + 100)
    expect(writes).toEqual([])
    expect(submitted).not.toHaveBeenCalled()
  })

  it('withholds the \\r (and the kickoff event) when the PTY dies between the two writes', () => {
    const writes: string[] = []
    const submitted = vi.fn()
    let up = true
    writeKickoffSequence({ write: (d) => writes.push(d), alive: () => up, onSubmitted: submitted })
    expect(writes).toEqual([CONVERGE_KICKOFF_LINE])

    up = false // PTY exits during the settle window
    vi.advanceTimersByTime(CONVERGE_KICKOFF_SUBMIT_DELAY_MS + 100)
    expect(writes).toEqual([CONVERGE_KICKOFF_LINE]) // no stray \r
    expect(submitted).not.toHaveBeenCalled() // session.kickoff means SUBMITTED
  })

  it('honours a custom submit delay', () => {
    const writes: string[] = []
    writeKickoffSequence({ write: (d) => writes.push(d), alive: () => true }, 50)
    vi.advanceTimersByTime(49)
    expect(writes).toEqual([CONVERGE_KICKOFF_LINE])
    vi.advanceTimersByTime(1)
    expect(writes).toEqual([CONVERGE_KICKOFF_LINE, '\r'])
  })
})
