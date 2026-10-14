import { describe, expect, it } from 'vitest'
import { handlePtyExit } from '../src/launcher/launcher'
import { claudeRuntime, findBackgroundSessionIn } from '../src/launcher/runtimes/claude'
import { codexRuntime } from '../src/launcher/runtimes/codex'
import { createSessionRow } from '../src/launcher/sessions'
import { listAfter } from '../src/services/events'
import { makeTestCtx } from './helpers/db'
import { seedFeature, seedProject } from './helpers/fixtures'

/**
 * A Claude Code conversation that was sent to the background (left arrow, before
 * CLAUDE_CODE_DISABLE_AGENT_VIEW) is held by Claude Code's background supervisor,
 * and every `claude --resume` of it is refused. The resume failure must say so,
 * and name the way out, instead of calling the conversation "still resumable".
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

describe('a resume that dies before going live', () => {
  async function diedResuming(listing: unknown | Error) {
    const ctx = await makeTestCtx()
    const feature = seedFeature(ctx, seedProject(ctx).id)
    const session = createSessionRow(ctx, {
      featureId: feature.id,
      kind: 'chat',
      worktreePath: 'C:\\wt',
      model: { id: 'claude-opus-5-5', runtime: 'claude-code' },
    })
    await handlePtyExit(
      ctx,
      feature,
      session,
      {
        resumeSessionId: HELD,
        findBackgroundSession: async (id) => {
          if (listing instanceof Error) throw listing
          return findBackgroundSessionIn(listing, id)
        },
      },
      1,
    )
    const failed = listAfter(ctx, feature.id, 0).filter((e) => e.type === 'session.resume_failed')
    expect(failed).toHaveLength(1)
    return { failed: failed[0]!, sessionId: session.id }
  }

  it('held by a background session: says so and names attach, stop, relaunch', async () => {
    const { failed, sessionId } = await diedResuming(LISTING)
    expect(failed.message).toContain('running as a Claude Code background session (3f2a9c71)')
    expect(failed.message).toContain('`claude attach 3f2a9c71`')
    expect(failed.message).toContain('`claude stop 3f2a9c71` (stopping keeps the conversation)')
    expect(failed.message).toContain('then relaunch')
    expect(failed.message).not.toContain('still resumable')
    expect(failed.data).toEqual({
      sessionId,
      resumeSessionId: HELD,
      exitCode: 1,
      backgroundSessionId: '3f2a9c71',
    })
  })

  it('not held by one: the conversation is still resumable, as before', async () => {
    const { failed, sessionId } = await diedResuming([LISTING[0]])
    expect(failed.message).toContain('the previous conversation is still resumable')
    expect(failed.data).toEqual({ sessionId, resumeSessionId: HELD, exitCode: 1 })
  })

  it('a listing that cannot be read still reports the failure', async () => {
    const { failed } = await diedResuming(new Error('claude agents failed'))
    expect(failed.message).toContain('the previous conversation is still resumable')
  })
})
