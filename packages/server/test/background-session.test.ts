import { describe, expect, it } from 'vitest'
import { claudeRuntime, findBackgroundSessionIn } from '../src/launcher/runtimes/claude'
import { codexRuntime } from '../src/launcher/runtimes/codex'

/**
 * A Claude Code conversation that was sent to the background (left arrow, before
 * CLAUDE_CODE_DISABLE_AGENT_VIEW) is held by Claude Code's background supervisor,
 * and every `claude --resume` of it is refused. The Claude adapter's lookup
 * finds the background session that holds a conversation.
 */

const HELD = '3f2a9c71-5b0e-4d8a-9e21-7c4b6d0f1a23'

/** A `claude agents --json` listing, as Claude Code 2.1.x prints it. */
const LISTING = [
  {
    pid: 101,
    cwd: 'C:\\repo',
    kind: 'interactive',
    startedAt: 1791965640619,
    sessionId: 'ef4aa388-ed14-419b-86c0-80a2773e881a',
    name: 'repo-d9',
    status: 'busy',
  },
  {
    id: '3f2a9c71',
    cwd: 'C:\\repo\\.worktrees\\talk',
    kind: 'background',
    startedAt: 1791965000000,
    sessionId: HELD,
    name: 'talk-3f',
    state: 'idle',
  },
]

describe('finding the background session in a `claude agents --json` listing', () => {
  it('finds a background session holding the conversation, with its short id', () => {
    expect(findBackgroundSessionIn(LISTING, HELD)).toEqual({ sessionId: HELD, shortId: '3f2a9c71' })
  })

  it('names the short id Claude Code gives the background entry, not one derived from the session id', () => {
    const listing = [{ id: 'abc12345', kind: 'background', sessionId: HELD, state: 'idle' }]
    expect(findBackgroundSessionIn(listing, HELD)).toEqual({ sessionId: HELD, shortId: 'abc12345' })
  })

  it('falls back to the leading block of the session id when the entry carries no id', () => {
    const listing = [{ kind: 'background', sessionId: HELD, state: 'idle' }]
    expect(findBackgroundSessionIn(listing, HELD)).toEqual({ sessionId: HELD, shortId: '3f2a9c71' })
  })

  it('does not count an interactive session as holding it', () => {
    expect(findBackgroundSessionIn(LISTING, 'ef4aa388-ed14-419b-86c0-80a2773e881a')).toBeUndefined()
  })

  it('finds nothing for a conversation not in the listing, or a listing that is not one', () => {
    expect(findBackgroundSessionIn(LISTING, 'cc-elsewhere')).toBeUndefined()
    expect(findBackgroundSessionIn(undefined, HELD)).toBeUndefined()
    expect(findBackgroundSessionIn({ sessionId: HELD, kind: 'background' }, HELD)).toBeUndefined()
    expect(findBackgroundSessionIn([null, 'x', 7], HELD)).toBeUndefined()
  })

  it('is asked of Claude Code only — Codex has no background sessions', () => {
    expect(claudeRuntime.findBackgroundSession).toBeTypeOf('function')
    expect(codexRuntime.findBackgroundSession).toBeUndefined()
  })
})

