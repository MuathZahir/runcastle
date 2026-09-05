import { describe, expect, it } from 'vitest'
import { fmtClock, ticketTitleFromNote } from '../src/format'

/**
 * The walkthrough moment, as every reader of it sees it: the player's time
 * readout, the note thumbnail's tooltip, and the promoted ticket's context
 * paragraph. It lives here because those readers straddle the wire — lap 1
 * shipped a server copy that dropped hours and a web copy that kept them, so
 * the same note read `61:40` in one place and `1:01:40` in the other.
 *
 * Reads a `<video>`'s seconds, so it also has to survive the two values an
 * element hands out before it knows the recording: NaN and Infinity.
 */
describe('fmtClock', () => {
  it('reads as a clock, with seconds always two digits', () => {
    expect(fmtClock(0)).toBe('0:00')
    expect(fmtClock(7.4)).toBe('0:07')
    expect(fmtClock(151)).toBe('2:31')
  })

  it('grows an hours field only when there are hours', () => {
    expect(fmtClock(3599)).toBe('59:59')
    expect(fmtClock(3600)).toBe('1:00:00')
    expect(fmtClock(3700)).toBe('1:01:40')
    expect(fmtClock(3852)).toBe('1:04:12')
  })

  it('says unknown rather than a number it does not have', () => {
    expect(fmtClock(Number.NaN)).toBe('--:--')
    expect(fmtClock(Number.POSITIVE_INFINITY)).toBe('--:--')
    expect(fmtClock(-1)).toBe('--:--')
  })
})

describe('ticketTitleFromNote', () => {
  it.each([
    ['Short text', 'Short text'],
    ['First sentence. Second sentence.', 'First sentence.'],
    ['First line\nSecond line', 'First line'],
    ['This sentence is deliberately made much longer than eighty characters so its title is cut cleanly at a word boundary without punctuation added', 'This sentence is deliberately made much longer than eighty characters so its title is'],
  ])('formats a note title', (text, expected) => {
    expect(ticketTitleFromNote(text)).toBe(expected)
    expect(ticketTitleFromNote(text)).not.toContain('…')
  })
})
