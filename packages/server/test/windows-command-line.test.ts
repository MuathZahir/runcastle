import { describe, expect, it } from 'vitest'
import { windowsArgsLine, windowsArgv0, windowsCommandLine } from '../src/pty/windows-command-line'

/** What the terminal backend hands Windows, line by line. Pure, so it runs on every OS. */

describe('windowsArgsLine', () => {
  it('leaves plain arguments alone', () => {
    expect(windowsArgsLine(['setup-token'])).toBe('setup-token')
    expect(windowsArgsLine(['auth', 'login'])).toBe('auth login')
    expect(windowsArgsLine([])).toBe('')
  })

  it('quotes an argument with whitespace, and an empty one', () => {
    expect(windowsArgsLine(['a b', ''])).toBe('"a b" ""')
  })

  it('escapes an embedded quote the way a C runtime reads it back', () => {
    expect(windowsArgsLine(['say "hi" now'])).toBe('"say \\"hi\\" now"')
  })

  it('doubles only the backslashes that end up before a quote', () => {
    expect(windowsArgsLine(['C:\\dir with space\\'])).toBe('"C:\\dir with space\\\\"')
    expect(windowsArgsLine(['C:\\dir\\file'])).toBe('C:\\dir\\file')
  })

  it('takes the cmd shim line whole, inside one outer pair of quotes', () => {
    expect(windowsArgsLine(['/d', '/s', '/c', 'npm run dev'])).toBe('/d /s /c "npm run dev"')
    expect(windowsArgsLine(['/d', '/s', '/c', '"C:\\a b\\x.cmd" "two words" && echo ok'])).toBe(
      '/d /s /c ""C:\\a b\\x.cmd" "two words" && echo ok"',
    )
  })

  it('treats a .cmd spawn target as ordinary arguments', () => {
    expect(windowsArgsLine(['/c', 'C:\\Program Files\\x.cmd', 'login'])).toBe(
      '/c "C:\\Program Files\\x.cmd" login',
    )
  })
})

describe('windowsArgv0', () => {
  it('quotes a program whose path has a space', () => {
    expect(windowsArgv0('C:\\Program Files\\x.exe')).toBe('"C:\\Program Files\\x.exe"')
    expect(windowsArgv0('cmd.exe')).toBe('cmd.exe')
  })
})

describe('windowsCommandLine', () => {
  it('is the program then its arguments', () => {
    expect(windowsCommandLine('C:\\a b\\c.exe', ['--flag', 'x y'])).toBe('"C:\\a b\\c.exe" --flag "x y"')
    expect(windowsCommandLine('c.exe', [])).toBe('c.exe')
  })
})
