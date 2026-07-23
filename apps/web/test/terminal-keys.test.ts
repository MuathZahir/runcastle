import { describe, expect, it } from 'vitest'
import { mapTerminalKey, NEWLINE_BYTES, type TerminalKeyEvent } from '../src/lib/terminal-keys'

/**
 * Streamlining-ux ticket 4 — the embedded terminal maps modifier+Enter to a
 * prompt newline (ESC+CR) instead of a submit. Tested at the pure-function seam,
 * no xterm dependency.
 */

function ev(overrides: Partial<TerminalKeyEvent>): TerminalKeyEvent {
  return {
    type: 'keydown',
    key: 'a',
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    ...overrides,
  }
}

describe('mapTerminalKey', () => {
  it('lets plain Enter through so xterm submits the prompt', () => {
    expect(mapTerminalKey(ev({ key: 'Enter' }))).toEqual({ intercept: false })
  })

  it('intercepts Shift+Enter on keydown and sends ESC+CR (newline, no submit)', () => {
    expect(mapTerminalKey(ev({ key: 'Enter', shiftKey: true }))).toEqual({
      intercept: true,
      bytes: NEWLINE_BYTES,
    })
    expect(NEWLINE_BYTES).toBe('\x1b\r')
  })

  it('intercepts Ctrl+Enter on keydown and sends ESC+CR', () => {
    expect(mapTerminalKey(ev({ key: 'Enter', ctrlKey: true }))).toEqual({
      intercept: true,
      bytes: NEWLINE_BYTES,
    })
  })

  it('leaves Alt+Enter and Meta+Enter to xterm (Alt already ESC-prefixes to \\x1b\\r)', () => {
    expect(mapTerminalKey(ev({ key: 'Enter', altKey: true }))).toEqual({ intercept: false })
    expect(mapTerminalKey(ev({ key: 'Enter', metaKey: true }))).toEqual({ intercept: false })
  })

  it('swallows the matching keypress without sending, so xterm cannot emit a bare CR', () => {
    expect(mapTerminalKey(ev({ type: 'keypress', key: 'Enter', shiftKey: true }))).toEqual({
      intercept: true,
      bytes: '',
    })
  })

  it('passes modifier+Enter keyup through (it never emits data)', () => {
    expect(mapTerminalKey(ev({ type: 'keyup', key: 'Enter', shiftKey: true }))).toEqual({
      intercept: false,
    })
  })

  it('passes ordinary keys through untouched, modifiers or not', () => {
    expect(mapTerminalKey(ev({ key: 'a' }))).toEqual({ intercept: false })
    expect(mapTerminalKey(ev({ key: 'c', ctrlKey: true }))).toEqual({ intercept: false })
    expect(mapTerminalKey(ev({ key: 'ArrowUp' }))).toEqual({ intercept: false })
    expect(mapTerminalKey(ev({ key: 'v', metaKey: true }))).toEqual({ intercept: false })
  })
})
