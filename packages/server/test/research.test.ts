import type { Feature, Project, RuncastleConfig as RuncastleConfigType, Waypoint, WaypointInput, WorkflowCtx } from '@runcastle/core'
import { RuncastleConfig } from '@runcastle/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { GateError } from '../src/errors'
import { workWaypoint } from '../src/launcher/launcher'
import { listAfter } from '../src/services/events'
import { getRunRow } from '../src/services/repo'
import { frontier, getWaypoint, storeWaypoints } from '../src/services/waypoints'
import type { AgentStreamEvent } from '@ai-hero/sandcastle'
import type { ResearchDeps, ResearchOutcome } from '../src/workflows/research'
import {
  createResearchStreamThrottle,
  research,
  researchDocRel,
  researchRun,
  waypointSlug,
} from '../src/workflows/research'
import { workflowRegistry } from '../src/workflows/registry'
import { cancelRun, startRun } from '../src/workflows/runner'
import { makeTestCtx } from './helpers/db'
import { seedFeature, seedProject } from './helpers/fixtures'

/**
 * Issue #7 — research waypoints AFK. The research workflow's control flow (auth
 * precheck, resolve-on-success, no-resolve-on-failure) is driven through a FAKE
 * `executeResearchRun` (the stubbed sandcastle boundary; SPEC §13.7). The
 * runner-boundary tests drive the same fake through `startRun` to prove the wired
 * `ctx.input` + `ctx.resolveWaypoint` + finalizer auto-release end to end.
 */

const config = RuncastleConfig.parse({ sandbox: 'noSandbox' })

function makeWaypoint(overrides: Partial<Waypoint> = {}): Waypoint {
  return {
    id: 'wpt_1',
    featureId: 'feat_1',
    seq: 1,
    title: 'How does auth work',
    type: 'research',
    question: 'Investigate the auth flow',
    blockedBy: [],
    status: 'claimed',
    ...overrides,
  }
}

function fakeDeps(
  outcome: ResearchOutcome,
  cfg: RuncastleConfigType = config,
  hasAuthToken = true,
): { deps: ResearchDeps; calls: Waypoint[] } {
  const calls: Waypoint[] = []
  return {
    calls,
    deps: {
      config: cfg,
      hasAuthToken,
      executeResearchRun: async (_ctx, wp) => {
        calls.push(wp)
        return outcome
      },
    },
  }
}

// --------------------------------------------------------------------------
// researchRun core — manual WorkflowCtx, no DB, no real sandcastle
// --------------------------------------------------------------------------

describe('researchRun — control flow (stubbed sandcastle)', () => {
  interface Resolved {
    id: string
    disposition: 'resolved' | 'dropped'
    summary: string
  }

  function makeCtx(waypoint: Waypoint | undefined) {
    const events: { type: string; message: string }[] = []
    const resolved: Resolved[] = []
    const ctx: WorkflowCtx = {
      project: {} as Project,
      feature: {} as Feature,
      tickets: [],
      emitEvent: (e) => events.push({ type: e.type, message: e.message }),
      updateTicket: () => {},
      input: waypoint,
      resolveWaypoint: (id, disposition, summary) => resolved.push({ id, disposition, summary }),
      signal: new AbortController().signal,
    }
    return { ctx, events, resolved }
  }

  it('resolves the waypoint with a summary on success', async () => {
    const wp = makeWaypoint()
    const { ctx, events, resolved } = makeCtx(wp)
    const { deps, calls } = fakeDeps({ status: 'done', commits: ['abc123'], docRelPath: 'docs/features/demo/research/1-how-does-auth-work.md' })

    const result = await researchRun(ctx, deps)

    expect(result.status).toBe('succeeded')
    expect(calls).toEqual([wp])
    expect(resolved).toHaveLength(1)
    expect(resolved[0]).toMatchObject({ id: wp.id, disposition: 'resolved' })
    expect(resolved[0].summary).toContain('research/1-how-does-auth-work.md')
    expect(events.map((e) => e.type)).toEqual(['research.started', 'research.done'])
  })

  it('does NOT resolve on a failed outcome (leaves the waypoint for the finalizer to release)', async () => {
    const { ctx, resolved, events } = makeCtx(makeWaypoint())
    const { deps } = fakeDeps({ status: 'failed', error: 'no commits' })

    const result = await researchRun(ctx, deps)

    expect(result.status).toBe('failed')
    expect(result.summary).toContain('no commits')
    expect(resolved).toHaveLength(0)
    expect(events.map((e) => e.type)).toContain('research.failed')
  })

  it('fails fast when docker has no auth token, without touching the sandbox', async () => {
    const { ctx, events } = makeCtx(makeWaypoint())
    const { deps, calls } = fakeDeps(
      { status: 'done', commits: ['x'], docRelPath: 'p' },
      RuncastleConfig.parse({ sandbox: 'docker' }),
      false,
    )

    const result = await researchRun(ctx, deps)

    expect(result.status).toBe('failed')
    expect(calls).toHaveLength(0)
    expect(events.map((e) => e.type)).toContain('auth.missing')
  })

  it('fails when started without a waypoint input', async () => {
    const { ctx } = makeCtx(undefined)
    const { deps, calls } = fakeDeps({ status: 'done', commits: ['x'], docRelPath: 'p' })

    const result = await researchRun(ctx, deps)

    expect(result.status).toBe('failed')
    expect(calls).toHaveLength(0)
  })
})

// --------------------------------------------------------------------------
// Stream events — research runs must emit research.*, never burn.* (E2E fix)
// --------------------------------------------------------------------------

describe('createResearchStreamThrottle', () => {
  function textEvent(message: string, iteration = 0): AgentStreamEvent {
    return { type: 'text', message, iteration, timestamp: new Date() }
  }
  function toolEvent(name: string, formattedArgs: string, iteration = 0): AgentStreamEvent {
    return { type: 'toolCall', name, formattedArgs, iteration, timestamp: new Date() }
  }

  it('renames burn.* stream types to research.* with identical payload shapes', () => {
    const emitted: { type: string; message: string; data?: unknown }[] = []
    const th = createResearchStreamThrottle((e) => emitted.push(e), { now: () => 0 })

    th.onEvent(textEvent('reading the auth flow', 2))
    th.onEvent(toolEvent('WebSearch', '{"query":"oauth refresh"}', 2))
    th.flush()

    expect(emitted.map((e) => e.type)).toEqual(['research.text', 'research.tool'])
    // payload shapes stay byte-identical to the burner's (only `type` differs)
    expect(emitted[0]).toEqual({
      type: 'research.text',
      message: 'reading the auth flow',
      data: { iteration: 2 },
    })
    expect(emitted[1]).toEqual({
      type: 'research.tool',
      message: 'WebSearch {"query":"oauth refresh"}',
      data: { name: 'WebSearch', args: '{"query":"oauth refresh"}', iteration: 2 },
    })
    // nothing burner-named leaks into a research timeline
    expect(emitted.some((e) => e.type.startsWith('burn.'))).toBe(false)
  })
})

describe('research doc paths', () => {
  it('slugifies the waypoint title with its seq prefix', () => {
    expect(waypointSlug({ seq: 3, title: 'How does OAuth 2 refresh?' })).toBe('3-how-does-oauth-2-refresh')
    expect(waypointSlug({ seq: 1, title: '???' })).toBe('1-waypoint')
  })

  it('nests the summary under the feature research dir', () => {
    expect(researchDocRel('my-feature', { seq: 2, title: 'Cache strategy' })).toBe(
      'docs/features/my-feature/research/2-cache-strategy.md',
    )
  })

  it('registers the research workflow under id `research`', () => {
    expect(research.id).toBe('research')
    expect(workflowRegistry.get('research')).toBe(research)
  })
})

// --------------------------------------------------------------------------
// Runner boundary — startRun wires input + resolveWaypoint + auto-release
// --------------------------------------------------------------------------

describe('research run through the runner (stubbed sandcastle)', () => {
  let ctx: AppCtx
  let feature: Feature

  function wpInput(title: string, blockedBy: (number | string)[] = []): WaypointInput {
    return { title, type: 'research', question: `q: ${title}`, blockedBy }
  }

  /** Register a research workflow whose sandcastle boundary is a controllable fake. */
  function stubResearch(
    executeResearchRun: (ctx: WorkflowCtx, wp: Waypoint) => Promise<ResearchOutcome>,
  ): void {
    workflowRegistry.set('research', {
      id: 'research',
      run: (c) => researchRun(c, { config, hasAuthToken: true, executeResearchRun }),
    })
  }

  beforeEach(async () => {
    ctx = await makeTestCtx()
    const project = seedProject(ctx)
    feature = seedFeature(ctx, project.id, { mapped: true, phase: 'ideation' })
  })

  afterEach(() => {
    workflowRegistry.set('research', research) // restore the real def
  })

  it('claims the waypoint for the run and resolves it with a summary on success', async () => {
    const [w] = storeWaypoints(ctx, feature.id, [wpInput('root')])
    let releaseGate!: () => void
    const gate = new Promise<void>((r) => {
      releaseGate = r
    })
    stubResearch(async () => {
      await gate
      return { status: 'done', commits: ['sha1'], docRelPath: researchDocRel(feature.slug, w) }
    })

    const { runId, done } = await startRun(ctx, feature.id, 'research', { input: w, claimWaypointId: w.id })
    // claimed by the run id while it runs (before the boundary completes)
    expect(getWaypoint(ctx, w.id).claimedBy).toBe(runId)
    releaseGate()
    await done

    const resolved = getWaypoint(ctx, w.id)
    expect(resolved.status).toBe('resolved')
    expect(resolved.summary).toContain('research/')
    expect(resolved.claimedBy).toBeUndefined()
    expect(getRunRow(ctx, runId).status).toBe('succeeded')
  })

  it('auto-releases the waypoint back to the frontier when the run fails', async () => {
    const [w] = storeWaypoints(ctx, feature.id, [wpInput('root')])
    stubResearch(async () => ({ status: 'failed', error: 'agent produced no commits' }))

    const { runId, done } = await startRun(ctx, feature.id, 'research', { input: w, claimWaypointId: w.id })
    await done

    const back = getWaypoint(ctx, w.id)
    expect(back.status).toBe('open')
    expect(back.claimedBy).toBeUndefined()
    // a run is not a resumable conversation — it must never become the resume
    // pointer (lastSessionId is only promoted when an HITL session goes live)
    expect(back.lastSessionId).toBeUndefined()
    expect(frontier(ctx, feature.id).map((f) => f.id)).toContain(w.id)
    expect(getRunRow(ctx, runId).status).toBe('failed')
  })

  it('auto-releases the waypoint when the run is cancelled', async () => {
    const [w] = storeWaypoints(ctx, feature.id, [wpInput('root')])
    let releaseGate!: () => void
    const gate = new Promise<void>((r) => {
      releaseGate = r
    })
    stubResearch(async (c) => {
      await gate
      c.signal.throwIfAborted()
      return { status: 'done', commits: ['x'], docRelPath: 'p' }
    })

    const { runId, done } = await startRun(ctx, feature.id, 'research', { input: w, claimWaypointId: w.id })
    cancelRun(runId)
    releaseGate()
    await done

    expect(getRunRow(ctx, runId).status).toBe('cancelled')
    expect(getWaypoint(ctx, w.id).status).toBe('open')
    expect(frontier(ctx, feature.id).map((f) => f.id)).toContain(w.id)
  })

  it('finalizes the run failed and rethrows when the waypoint is not on the frontier', async () => {
    const [, blocked] = storeWaypoints(ctx, feature.id, [wpInput('a'), wpInput('b', [1])])
    stubResearch(async () => ({ status: 'done', commits: ['x'], docRelPath: 'p' }))

    await expect(
      startRun(ctx, feature.id, 'research', { input: blocked, claimWaypointId: blocked.id }),
    ).rejects.toThrow(GateError)
    // the blocked waypoint was never claimed
    expect(getWaypoint(ctx, blocked.id).status).toBe('open')
  })
})

// --------------------------------------------------------------------------
// workWaypoint routing — research goes to a run, not a session
// --------------------------------------------------------------------------

describe('workWaypoint routes research to a run', () => {
  let ctx: AppCtx
  let feature: Feature

  beforeEach(async () => {
    ctx = await makeTestCtx()
    const project = seedProject(ctx)
    feature = seedFeature(ctx, project.id, { mapped: true, phase: 'ideation' })
    workflowRegistry.set('research', {
      id: 'research',
      run: (c) =>
        researchRun(c, {
          config,
          hasAuthToken: true,
          executeResearchRun: async () => ({ status: 'done', commits: ['x'], docRelPath: 'p' }),
        }),
    })
  })

  afterEach(() => {
    workflowRegistry.set('research', research)
  })

  it('returns a runId (not a sessionId) and starts a research run', async () => {
    const [w] = storeWaypoints(ctx, feature.id, [
      { title: 'dig', type: 'research', question: 'q', blockedBy: [] },
    ])

    const result = await workWaypoint(ctx, { featureId: feature.id, waypointId: w.id })

    expect(result).toHaveProperty('runId')
    expect(result).not.toHaveProperty('sessionId')
    const runId = (result as { runId: string }).runId
    expect(getRunRow(ctx, runId).workflow).toBe('research')
    const types = listAfter(ctx, feature.id, 0).map((e) => e.type)
    expect(types).toContain('run.started')
  })

  it('refuses a research waypoint that is not on the frontier', async () => {
    const [, blocked] = storeWaypoints(ctx, feature.id, [
      { title: 'a', type: 'research', question: 'q', blockedBy: [] },
      { title: 'b', type: 'research', question: 'q', blockedBy: [1] },
    ])
    await expect(
      workWaypoint(ctx, { featureId: feature.id, waypointId: blocked.id }),
    ).rejects.toThrow(GateError)
  })
})
