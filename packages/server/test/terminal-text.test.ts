import { describe, expect, it } from 'vitest'
import { terminalText } from './fixtures/terminal-text'

describe('terminalText (fixture helper)', () => {
  it('turns a ConPTY cursor-forward back into the space it drew', () => {
    expect(terminalText('nest pid\x1b[1C26724')).toBe('nest pid 26724')
    expect(terminalText('a\x1b[Cb\x1b[3Cc')).toBe('a b   c')
  })

  it('drops OSC title sequences and other CSI escapes', () => {
    const raw =
      '\x1b]0;C:\\Program Files\\nodejs\\node.exe\x07claude-stub pid \x1b[33m17416\x1b[39m mcp pid\x1b[1C92072\x1b[?25h'
    expect(terminalText(raw)).toBe('claude-stub pid 17416 mcp pid 92072')
  })
})
