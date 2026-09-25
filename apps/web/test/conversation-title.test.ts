import { describe, expect, it } from 'vitest'
import { UNTITLED_CHAT, conversationTitle, sentenceCase } from '../src/lib/conversation-title'

/**
 * A project chat is titled with the first thing typed into it, verbatim. The
 * list reads it as a name: the wrappers Claude Code records around pastes and
 * slash commands, terminal colour codes and markdown furniture are dropped.
 */
describe('conversationTitle', () => {
  it('drops a pasted-content wrapper and the heading marks inside it', () => {
    expect(conversationTitle('<pasted_content id="8dcd"> ## Problem: runcastle sandbox ima…')).toBe(
      'Problem: runcastle sandbox ima…',
    )
  })

  it('drops local-command output tags, backticks and ANSI colour codes', () => {
    expect(conversationTitle('<local-command-stdout>Set model to `Fable 5.1` and saved as…')).toBe(
      'Set model to Fable 5.1 and saved as…',
    )
    expect(
      conversationTitle(`<local-command-stdout>Set model to ${String.fromCharCode(27)}[1mFable 5${String.fromCharCode(27)}[22m and save…`),
    ).toBe('Set model to Fable 5 and save…')
  })

  it('drops quote bars, prompts and a stray leading full stop', () => {
    expect(conversationTitle('▎ Title: Codex burns ▎ Slug: cod…')).toBe('Title: Codex burns Slug: cod…')
    expect(conversationTitle('❯ This is one of the review agents I ran')).toBe(
      'This is one of the review agents I ran',
    )
    expect(conversationTitle('. We just finished a long wave')).toBe('We just finished a long wave')
  })

  it('leaves an ordinary sentence exactly as typed', () => {
    expect(conversationTitle("Why can't I start the burn")).toBe("Why can't I start the burn")
    expect(conversationTitle('is a < b here?')).toBe('is a < b here?')
  })

  it('names what is empty, or only the placeholder, "Untitled chat"', () => {
    expect(conversationTitle('Untitled')).toBe(UNTITLED_CHAT)
    expect(conversationTitle('')).toBe(UNTITLED_CHAT)
    expect(conversationTitle(null)).toBe(UNTITLED_CHAT)
    expect(conversationTitle('<local-command-stdout></local-command-stdout>')).toBe(UNTITLED_CHAT)
  })
})

describe('sentenceCase', () => {
  it('capitalises the first letter only', () => {
    expect(sentenceCase('live')).toBe('Live')
    expect(sentenceCase('launching…')).toBe('Launching…')
  })
})
