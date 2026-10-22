import { describe, expect, it } from 'vitest'
import { exitTail } from '../src/pty/exit-tail'

/**
 * What a Vite design server printed under ConPTY on Windows (the round-7 review
 * drive): the console's window title as an OSC sequence, colour and cursor
 * moves, then the ready block — painted once, and repainted whole.
 */
const VITE_READY = [
  '\x1b[?25l\x1b[2J\x1b[m\x1b[H',
  '\x1b]0;C:\\WINDOWS\\system32\\cmd.exe\x07\x1b[?25h',
  '\x1b[32m\x1b[1mVITE\x1b[22m v7.1.3\x1b[39m  \x1b[2mready in \x1b[0m\x1b[1m412\x1b[22m\x1b[2m\x1b[0m ms\r\n',
  '\r\n',
  '  \x1b[32m➜\x1b[39m  \x1b[1mLocal\x1b[22m:   \x1b[36mhttp://localhost:\x1b[1m4600\x1b[22m/\x1b[39m\r\n',
  '  \x1b[32m➜\x1b[39m  \x1b[1mNetwork\x1b[22m: \x1b[2muse \x1b[22m\x1b[1m--host\x1b[22m\x1b[2m to expose\x1b[22m\r\n',
  '  \x1b[32m➜\x1b[39m  \x1b[2mpress \x1b[22m\x1b[1mh + enter\x1b[22m\x1b[2m to show help\x1b[22m\r\n',
].join('')

const READY_TAIL = [
  'VITE v7.1.3  ready in 412 ms',
  '  ➜  Local:   http://localhost:4600/',
  '  ➜  Network: use --host to expose',
  '  ➜  press h + enter to show help',
].join('\n')

describe('exitTail', () => {
  it('drops the window-title sequence and every other escape', () => {
    const tail = exitTail(Buffer.from(VITE_READY))
    expect(tail).toBe(READY_TAIL)
    expect(tail).not.toMatch(/WINDOWS|cmd\.exe/)
    // eslint-disable-next-line no-control-regex
    expect(tail).not.toMatch(/[\x00-\x08\x0b-\x1f\x7f]/)
  })

  it('keeps one copy of a block the console repainted', () => {
    const repainted = `${VITE_READY}\x1b[H${VITE_READY}error: the server exited\r\n`
    expect(exitTail(Buffer.from(repainted))).toBe(`${READY_TAIL}\nerror: the server exited`)
  })

  it('keeps the newest lines when the output is long', () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line ${i}`)
    expect(exitTail(Buffer.from(lines.join('\n')))).toBe(lines.slice(-20).join('\n'))
  })
})
