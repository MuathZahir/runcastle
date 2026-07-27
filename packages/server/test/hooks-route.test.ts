import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { clearRuntimeCtx, setRuntimeCtx } from '../src/launcher/runtime'
import { createSessionRow, getSessionRow } from '../src/launcher/sessions'
import hooksApp from '../src/routes/hooks'
import { listAfter } from '../src/services/events'
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
})
