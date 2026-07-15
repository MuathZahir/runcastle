import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { clearRuntimeCtx, setRuntimeCtx } from '../src/launcher/runtime'
import { createSessionRow, getSessionRow } from '../src/launcher/sessions'
import hooksApp from '../src/routes/hooks'
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
