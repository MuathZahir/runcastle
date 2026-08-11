import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { SessionKind } from '@runcastle/core'
import type { AppCtx } from '../src/db/types'
import { clearRuntimeCtx, setRuntimeCtx } from '../src/launcher/runtime'
import { createSessionRow, getSessionRow, setSessionPurpose } from '../src/launcher/sessions'
import hooksApp from '../src/routes/hooks'
import { listAfter, listByProject } from '../src/services/events'
import { storeTickets } from '../src/services/tickets'
import { claim, getWaypoint, storeWaypoints } from '../src/services/waypoints'
import { makeTestCtx } from './helpers/db'
import { seedFeature, seedProject } from './helpers/fixtures'

function mount(): Hono {
  const app = new Hono()
  app.route('/api/hooks', hooksApp)
  return app
}

async function post(app: Hono, event: string, body: unknown): Promise<{ status: number; json: any }> {
  const res = await app.request(`/api/hooks/${event}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: res.status, json: await res.json() }
}

describe('hooks route', () => {
  let ctx: AppCtx
  let featureId: string
  let sessionId: string

  beforeEach(async () => {
    ctx = await makeTestCtx()
    const project = seedProject(ctx)
    const feature = seedFeature(ctx, project.id, { slug: 'dark-mode', phase: 'ideation' })
    featureId = feature.id
    const session = createSessionRow(ctx, {
      featureId,
      kind: 'ideation',
      worktreePath: 'C:\\wt\\dark-mode',
    })
    sessionId = session.id
    setRuntimeCtx(ctx)
  })

  afterEach(() => clearRuntimeCtx())

  it('session-start marks the session live, stores cc ids, and injects context', async () => {
    const { status, json } = await post(mount(), 'session-start', {
      sessionId,
      payload: {
        session_id: 'cc-123',
        transcript_path: '/tmp/t.jsonl',
        hook_event_name: 'SessionStart',
        source: 'startup',
      },
    })

    expect(status).toBe(200)
    // exact verified SessionStart shape (additionalContext nested in hookSpecificOutput)
    expect(json.hookSpecificOutput.hookEventName).toBe('SessionStart')
    expect(json.hookSpecificOutput.additionalContext).toContain('[runcastle] Demo feature')
    expect(json.hookSpecificOutput.additionalContext).toContain('phase: ideation')
    expect(json.hookSpecificOutput.additionalContext).toContain('get_feature_context')

    const session = getSessionRow(ctx, sessionId)
    expect(session?.status).toBe('live')
    expect(session?.ccSessionId).toBe('cc-123')
    expect(session?.transcriptPath).toBe('/tmp/t.jsonl')
  })

  /**
   * REGRESSION (merge-conflict "Resolve with agent" opened a terminal that just
   * sat there): a resumed session is a started session. The settings used to
   * register `matcher: 'startup'` alone, so this call never happened for a
   * `--resume` launch — the row stayed `launching`, no `ccSessionId` was ever
   * recorded, and the kickoff was never typed.
   */
  it('session-start with source=resume goes live exactly like a fresh start', async () => {
    const { status } = await post(mount(), 'session-start', {
      sessionId,
      payload: {
        session_id: 'cc-resumed',
        transcript_path: '/tmp/t.jsonl',
        hook_event_name: 'SessionStart',
        source: 'resume',
      },
    })

    expect(status).toBe(200)
    const session = getSessionRow(ctx, sessionId)
    expect(session?.status).toBe('live')
    expect(session?.ccSessionId).toBe('cc-resumed')

    const started = listAfter(ctx, featureId, 0).filter((e) => e.type === 'session.started')
    expect(started).toHaveLength(1)
    expect(started[0].message).toContain('resumed')
  })

  /**
   * `/clear` and compaction start a NEW Claude Code conversation in the same
   * terminal: keep the id current (a stale one resumes the wrong transcript)
   * without re-announcing a session that is already live.
   */
  it('a later session-start refreshes the cc id without a second started event', async () => {
    const app = mount()
    await post(app, 'session-start', {
      sessionId,
      payload: { session_id: 'cc-1', hook_event_name: 'SessionStart', source: 'startup' },
    })
    await post(app, 'session-start', {
      sessionId,
      payload: { session_id: 'cc-2', hook_event_name: 'SessionStart', source: 'clear' },
    })

    expect(getSessionRow(ctx, sessionId)?.ccSessionId).toBe('cc-2')
    expect(listAfter(ctx, featureId, 0).filter((e) => e.type === 'session.started')).toHaveLength(1)
  })

  it('user-prompt injects one compact runcastle line in the verified shape', async () => {
    storeTickets(ctx, featureId, [
      { title: 'a', goal: 'g', context: 'c', acceptanceCriteria: ['x'], seams: ['s'], blockedBy: [] },
      { title: 'b', goal: 'g', context: 'c', acceptanceCriteria: ['x'], seams: ['s'], blockedBy: [] },
    ])

    const { json } = await post(mount(), 'user-prompt', {
      sessionId,
      payload: { hook_event_name: 'UserPromptSubmit', prompt: 'hi' },
    })

    expect(json.hookSpecificOutput.hookEventName).toBe('UserPromptSubmit')
    expect(json.hookSpecificOutput.additionalContext).toBe(
      '[runcastle] feature=dark-mode phase=ideation tickets=2',
    )
  })

  it('session-end marks the session ended and returns {}', async () => {
    const { json } = await post(mount(), 'session-end', {
      sessionId,
      payload: { hook_event_name: 'SessionEnd' },
    })
    expect(json).toEqual({})
    expect(getSessionRow(ctx, sessionId)?.status).toBe('ended')
  })

  it('session-end auto-releases a waypoint the ending session had claimed', async () => {
    const mapped = seedFeature(ctx, seedProject(ctx).id, { slug: 'big', mapped: true })
    const s = createSessionRow(ctx, { featureId: mapped.id, kind: 'waypoint', worktreePath: 'C:\\wt' })
    const [a] = storeWaypoints(ctx, mapped.id, [
      { title: 'a', type: 'grilling', question: 'q', blockedBy: [] },
    ])
    claim(ctx, a.id, s.id)
    // the session actually starts (this is what promotes lastSessionId)...
    await post(mount(), 'session-start', {
      sessionId: s.id,
      payload: { session_id: 'cc-wp-1', hook_event_name: 'SessionStart', source: 'startup' },
    })
    // ...and later ends without resolving
    await post(mount(), 'session-end', { sessionId: s.id, payload: { hook_event_name: 'SessionEnd' } })

    // the waypoint is back on the frontier, remembering the session for Resume
    const back = getWaypoint(ctx, a.id)
    expect(back.status).toBe('open')
    expect(back.lastSessionId).toBe(s.id)
  })

  it('session-start tells the session which LAP the feature is on', async () => {
    const lapFeature = seedFeature(ctx, seedProject(ctx).id, { slug: 'lapper', lap: 3 })
    const s = createSessionRow(ctx, {
      featureId: lapFeature.id,
      kind: 'revisit',
      worktreePath: '/wt/lapper',
    })

    const { json } = await post(mount(), 'session-start', {
      sessionId: s.id,
      payload: { session_id: 'cc-lap', hook_event_name: 'SessionStart', source: 'startup' },
    })

    expect(json.hookSpecificOutput.additionalContext).toContain('lap: 3')
  })

  /**
   * The talk-session edit guard (F2): a grill that was never told what it was
   * there for used to read the docs and start editing source. The prompt rule
   * says so; this hook is what makes it true.
   */
  describe('pre-tool — talk sessions do not write code', () => {
    let talkSession: string

    beforeEach(() => {
      talkSession = createSessionRow(ctx, {
        featureId,
        kind: 'ideation',
        worktreePath: '/wt/dark-mode',
      }).id
    })

    async function preTool(id: string, tool: string, filePath: string): Promise<any> {
      const { json } = await post(mount(), 'pre-tool', {
        sessionId: id,
        payload: {
          hook_event_name: 'PreToolUse',
          tool_name: tool,
          tool_input: { file_path: filePath },
        },
      })
      return json
    }

    it('denies an edit to source, naming the ticket route back', async () => {
      const json = await preTool(talkSession, 'Edit', '/wt/dark-mode/src/theme.ts')
      expect(json.hookSpecificOutput).toMatchObject({
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
      })
      expect(json.hookSpecificOutput.permissionDecisionReason).toMatch(/do not write code/i)
      expect(json.hookSpecificOutput.permissionDecisionReason).toMatch(/ticket/i)
    })

    it('denies Write and NotebookEdit the same way, and a relative path too', async () => {
      for (const tool of ['Write', 'NotebookEdit']) {
        const json = await preTool(talkSession, tool, '/wt/dark-mode/src/theme.ts')
        expect(json.hookSpecificOutput.permissionDecision).toBe('deny')
      }
      const relative = await preTool(talkSession, 'Write', 'src/theme.ts')
      expect(relative.hookSpecificOutput.permissionDecision).toBe('deny')
    })

    it('allows the feature docs — writing them IS the session`s output', async () => {
      for (const path of [
        '/wt/dark-mode/docs/features/dark-mode/decisions.md',
        'docs/features/dark-mode/spec.md',
        'docs/features/dark-mode/test-notes.md',
      ]) {
        expect(await preTool(talkSession, 'Write', path)).toEqual({})
      }
    })

    it('does not deny another feature`s docs dir by prefix accident', async () => {
      const json = await preTool(talkSession, 'Write', 'docs/features/dark-mode-2/spec.md')
      expect(json.hookSpecificOutput.permissionDecision).toBe('deny')
    })

    /**
     * E2E F18 / ADR-0007 §6 — the conflict-resolution session is ordered to
     * merge the base branch in and resolve the conflicts, and was then denied
     * every write that means: "Resolve with agent" could not resolve anything.
     * Only that launch is exempt, and only inside its own worktree.
     */
    describe('the conflict-resolution session, which resolves the merge', () => {
      let conflictSession: string

      beforeEach(() => {
        conflictSession = createSessionRow(ctx, {
          featureId,
          kind: 'revisit',
          worktreePath: '/wt/dark-mode',
        }).id
        setSessionPurpose(conflictSession, 'conflict')
      })

      it('may write the conflicted files on the feature branch', async () => {
        for (const path of [
          '/wt/dark-mode/public/index.html',
          'src/theme.ts',
          'docs/features/dark-mode/decisions.md',
        ]) {
          expect(await preTool(conflictSession, 'Edit', path)).toEqual({})
        }
      })

      it('may not write outside the worktree it was given', async () => {
        const json = await preTool(conflictSession, 'Write', '/etc/hosts')
        expect(json.hookSpecificOutput.permissionDecision).toBe('deny')
        expect(json.hookSpecificOutput.permissionDecisionReason).toMatch(/outside it/i)
      })

      it('exempts only itself — an ordinary revisit still writes docs only', async () => {
        const revisit = createSessionRow(ctx, {
          featureId,
          kind: 'revisit',
          worktreePath: '/wt/dark-mode',
        }).id
        const json = await preTool(revisit, 'Edit', 'src/theme.ts')
        expect(json.hookSpecificOutput.permissionDecision).toBe('deny')
        expect(await preTool(revisit, 'Write', 'docs/features/dark-mode/spec.md')).toEqual({})
      })
    })

    it('leaves a project session alone — it is the one kind that writes code', async () => {
      const projectSession = createSessionRow(ctx, {
        projectId: seedProject(ctx).id,
        kind: 'project',
        worktreePath: '/wt/project',
      }).id
      expect(await preTool(projectSession, 'Edit', '/wt/project/src/index.ts')).toEqual({})
    })

    it('denies a preparation session, which runs in the human`s own checkout', async () => {
      const prep = createSessionRow(ctx, {
        projectId: seedProject(ctx).id,
        kind: 'prepare',
        worktreePath: '/repo',
      }).id
      const json = await preTool(prep, 'Write', '/repo/.env')
      expect(json.hookSpecificOutput.permissionDecision).toBe('deny')
      expect(json.hookSpecificOutput.permissionDecisionReason).toContain('record_finding')
    })

    it('fails open on a payload it cannot read', async () => {
      const { json } = await post(mount(), 'pre-tool', {
        sessionId: talkSession,
        payload: { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls' } },
      })
      expect(json).toEqual({})
      const noPath = await post(mount(), 'pre-tool', {
        sessionId: talkSession,
        payload: { hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: {} },
      })
      expect(noPath.json).toEqual({})
    })
  })

  it('returns {} for an unknown session id (never breaks a session)', async () => {
    const { json } = await post(mount(), 'session-start', {
      sessionId: 'sess_does_not_exist',
      payload: {},
    })
    expect(json).toEqual({})
  })

  it('returns {} when no session id is provided', async () => {
    const { json } = await post(mount(), 'session-start', { payload: {} })
    expect(json).toEqual({})
  })

  /**
   * Ticket 4 — per-session turn state (decisions §3). The server used to hear
   * only that a prompt went IN, so a live session mid-turn and a live session
   * that had been waiting on its human for an hour looked identical, and the
   * triage lanes called both of them "Needs you".
   */
  describe('turn state', () => {
    const awaiting = (): boolean | undefined => getSessionRow(ctx, sessionId)?.awaitingInput

    it('starts out working — a fresh session has not stopped for anyone', () => {
      expect(awaiting()).toBe(false)
    })

    it('marks the session awaiting input when the agent stops, answering {}', async () => {
      const { json } = await post(mount(), 'stop', {
        sessionId,
        payload: { hook_event_name: 'Stop', stop_hook_active: false },
      })

      expect(json).toEqual({})
      expect(awaiting()).toBe(true)
    })

    it('marks the agent working again when a prompt is submitted', async () => {
      await post(mount(), 'stop', { sessionId, payload: { hook_event_name: 'Stop' } })
      await post(mount(), 'user-prompt', {
        sessionId,
        payload: { hook_event_name: 'UserPromptSubmit', prompt: 'carry on' },
      })

      expect(awaiting()).toBe(false)
    })

    // The ordering hazard: the two hooks interleave, and a prompt arriving after
    // a Stop is the human answering — which is the agent working again.
    it('lets the last hook win across a whole conversation', async () => {
      const stop = (): Promise<unknown> =>
        post(mount(), 'stop', { sessionId, payload: { hook_event_name: 'Stop' } })
      const prompt = (): Promise<unknown> =>
        post(mount(), 'user-prompt', {
          sessionId,
          payload: { hook_event_name: 'UserPromptSubmit', prompt: 'more' },
        })

      await prompt()
      await stop()
      await prompt()
      expect(awaiting()).toBe(false)
      await stop()
      expect(awaiting()).toBe(true)
    })

    it('returns {} for a stop on an unknown session', async () => {
      const { json } = await post(mount(), 'stop', {
        sessionId: 'sess_does_not_exist',
        payload: { hook_event_name: 'Stop' },
      })
      expect(json).toEqual({})
    })

    it('tracks a project-scoped conversation the same way', async () => {
      const project = createSessionRow(ctx, {
        projectId: seedProject(ctx).id,
        kind: 'project',
        worktreePath: 'C:\\wt\\proj',
      })

      await post(mount(), 'stop', { sessionId: project.id, payload: { hook_event_name: 'Stop' } })
      expect(getSessionRow(ctx, project.id)?.awaitingInput).toBe(true)

      await post(mount(), 'user-prompt', {
        sessionId: project.id,
        payload: { hook_event_name: 'UserPromptSubmit', prompt: 'hi' },
      })
      expect(getSessionRow(ctx, project.id)?.awaitingInput).toBe(false)
    })
  })
})

/**
 * The two featureless kinds share this branch of the route, and they must not
 * share its briefing. Observed live: a `project` session opened by measuring
 * setup/verify commands instead of engaging the human, because the branch handed
 * it the preparation agenda — the prep digest plus "record what you establish
 * with `record_finding`" — that only the `prepare` kind's job asks for.
 */
describe('hooks route, project-scoped sessions', () => {
  let ctx: AppCtx
  let projectId: string

  beforeEach(async () => {
    ctx = await makeTestCtx()
    projectId = seedProject(ctx).id
    setRuntimeCtx(ctx)
  })

  afterEach(() => clearRuntimeCtx())

  function projectScopedSession(kind: SessionKind): string {
    return createSessionRow(ctx, { projectId, kind, worktreePath: 'C:\\wt\\proj' }).id
  }

  it('a project session is told its scope, not the preparation agenda', async () => {
    const sessionId = projectScopedSession('project')
    const { json } = await post(mount(), 'session-start', {
      sessionId,
      payload: { session_id: 'cc-p1', hook_event_name: 'SessionStart', source: 'startup' },
    })

    const context: string = json.hookSpecificOutput.additionalContext
    expect(json.hookSpecificOutput.hookEventName).toBe('SessionStart')
    expect(context).toContain('[runcastle] project session for test')
    expect(context).not.toContain('preparation session')
    expect(context).not.toContain('Still unestablished')
    expect(context).not.toContain('record_finding')
  })

  it('a project session still gets the whole lifecycle', async () => {
    const sessionId = projectScopedSession('project')
    await post(mount(), 'session-start', {
      sessionId,
      payload: {
        session_id: 'cc-p2',
        transcript_path: '/tmp/p.jsonl',
        hook_event_name: 'SessionStart',
        source: 'startup',
      },
    })

    const live = getSessionRow(ctx, sessionId)
    expect(live?.status).toBe('live')
    expect(live?.ccSessionId).toBe('cc-p2')
    expect(live?.transcriptPath).toBe('/tmp/p.jsonl')

    const { json } = await post(mount(), 'session-end', {
      sessionId,
      payload: { hook_event_name: 'SessionEnd' },
    })
    expect(json).toEqual({})
    expect(getSessionRow(ctx, sessionId)?.status).toBe('ended')
  })

  it('labels a project session as one on every turn', async () => {
    const { json } = await post(mount(), 'user-prompt', {
      sessionId: projectScopedSession('project'),
      payload: { hook_event_name: 'UserPromptSubmit', prompt: 'hi' },
    })
    expect(json.hookSpecificOutput.additionalContext).toBe('[runcastle] project session')
  })

  it('leaves the prepare session its agenda, unchanged', async () => {
    const sessionId = projectScopedSession('prepare')
    const { json } = await post(mount(), 'session-start', {
      sessionId,
      payload: { session_id: 'cc-prep', hook_event_name: 'SessionStart', source: 'startup' },
    })

    const context: string = json.hookSpecificOutput.additionalContext
    expect(context).toContain('[runcastle] preparation session for test')
    expect(context).toContain('Still unestablished')
    expect(context).toContain('record_finding')

    const turn = await post(mount(), 'user-prompt', {
      sessionId,
      payload: { hook_event_name: 'UserPromptSubmit', prompt: 'hi' },
    })
    expect(turn.json.hookSpecificOutput.additionalContext).toBe(
      '[runcastle] preparation session (project-scoped, no feature)',
    )
  })

  it('announces each kind by its own name in its lifecycle events', async () => {
    for (const [kind, noun] of [
      ['project', 'project session'],
      ['prepare', 'preparation session'],
    ] as const) {
      const sessionId = projectScopedSession(kind)
      const before = listByProject(ctx, projectId, 0).at(-1)?.id ?? 0
      await post(mount(), 'session-start', {
        sessionId,
        payload: { session_id: `cc-${kind}`, hook_event_name: 'SessionStart', source: 'startup' },
      })
      await post(mount(), 'session-end', { sessionId, payload: { hook_event_name: 'SessionEnd' } })

      const messages = listByProject(ctx, projectId, before).map((e) => e.message)
      expect(messages).toEqual([`${noun} live`, `${noun} ended`])
    }
  })
})
