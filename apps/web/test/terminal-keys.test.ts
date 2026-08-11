import { describe, expect, it } from 'vitest'
import { IMAGE_PASTE_BYTES, mapTerminalKey, NEWLINE_BYTES, type TerminalKeyEvent } from '../src/lib/terminal-keys'

/**
 * Streamlining-ux ticket 4 — the embedded terminal maps modifier+Enter to a
 * prompt newline (ESC+CR) instead of a submit. Tested at the pure-function seam,
 * no xterm dependency.
 */

function ev(overrides: Partial<TerminalKeyEvent>): TerminalKeyEvent {
  return {
    type: 'keydown',
    key: 'a',
    code: 'KeyA',
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
  })
})

/**
 * Fix-ctrl-v-for-paste ticket 1 — Ctrl+V must reach the browser's clipboard and
 * Alt+V must reach Claude Code's image paste. Same pure-function seam.
 */
describe('mapTerminalKey — paste', () => {
  const ctrlV = { key: 'v', code: 'KeyV', ctrlKey: true }
  /** macOS composes Option+V into '√' before the event is dispatched. */
  const altV = { key: 'v', code: 'KeyV', altKey: true }
  const optionV = { key: '√', code: 'KeyV', altKey: true }

  it('swallows Ctrl+V without sending, so the browser paste event survives', () => {
    // Stock xterm sends ^V here AND preventDefaults, which kills the native
    // paste. Sending nothing (and not cancelling) is what makes paste work.
    expect(mapTerminalKey(ev(ctrlV))).toEqual({ intercept: true, bytes: '' })
  })

  it('sends ESC+v for Alt+V so Claude Code pastes an image', () => {
    expect(mapTerminalKey(ev(altV))).toEqual({ intercept: true, bytes: IMAGE_PASTE_BYTES })
    expect(IMAGE_PASTE_BYTES).toBe('\x1bv')
  })

  it('recognises Alt+V on macOS, where the composed key is "√" not "v"', () => {
    expect(mapTerminalKey(ev(optionV))).toEqual({ intercept: true, bytes: IMAGE_PASTE_BYTES })
  })

  it('swallows the matching keypress so xterm cannot also emit the key', () => {
    expect(mapTerminalKey(ev({ ...ctrlV, type: 'keypress' }))).toEqual({ intercept: true, bytes: '' })
    expect(mapTerminalKey(ev({ ...optionV, type: 'keypress' }))).toEqual({ intercept: true, bytes: '' })
  })

  it('passes the keyup through (it never emits data)', () => {
    expect(mapTerminalKey(ev({ ...ctrlV, type: 'keyup' }))).toEqual({ intercept: false })
    expect(mapTerminalKey(ev({ ...altV, type: 'keyup' }))).toEqual({ intercept: false })
  })

  it('leaves Cmd+V and Ctrl+Shift+V to the browser — xterm already pastes those', () => {
    expect(mapTerminalKey(ev({ key: 'v', code: 'KeyV', metaKey: true }))).toEqual({ intercept: false })
    expect(mapTerminalKey(ev({ ...ctrlV, shiftKey: true }))).toEqual({ intercept: false })
  })

  it('leaves Ctrl+Alt+V alone — that is AltGr+V on Windows, an ordinary character', () => {
    expect(mapTerminalKey(ev({ ...ctrlV, altKey: true }))).toEqual({ intercept: false })
  })

  it('does not catch a plain "v" or a "v" on some other physical key', () => {
    expect(mapTerminalKey(ev({ key: 'v', code: 'KeyV' }))).toEqual({ intercept: false })
    expect(mapTerminalKey(ev({ key: 'b', code: 'KeyB', ctrlKey: true }))).toEqual({ intercept: false })
  })
})
