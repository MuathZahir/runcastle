import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sessionDir, worktreeDir } from '@runcastle/core/paths'
import { simpleGit } from 'simple-git'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { GateError } from '../src/errors'
import { converge } from '../src/launcher/launcher'
import { getSessionRow, markSessionEnded } from '../src/launcher/sessions'
import { listAfter } from '../src/services/events'
import { getFeatureRow } from '../src/services/repo'
import { createFeatureBranch } from '../src/services/git'
import { storeTickets } from '../src/services/tickets'
import { claim, resolve, storeWaypoints } from '../src/services/waypoints'
import { makeTestCtx } from './helpers/db'
import { seedFeature, seedProject } from './helpers/fixtures'

/**
 * Issue #8 — convergence + conditional G1. Once every waypoint is terminal a
 * mapped feature's G1 (`all-waypoints-terminal`) opens: Converge crosses it into
 * `spec` and spawns a fresh kind=converge session. It is refused while any
 * waypoint is open/claimed unless overridden with a reason.
 */

function wp(title: string, blockedBy: (number | string)[] = []) {
  return { title, type: 'grilling' as const, question: `q: ${title}`, blockedBy }
}

async function initRepo(dir: string): Promise<void> {
  const g = simpleGit(dir)
  await g.init(['-b', 'main'])
  await g.addConfig('user.email', 'test@runcastle.dev')
  await g.addConfig('user.name', 'Runcastle Test')
  await g.addConfig('core.autocrlf', 'false')
  await g.raw(['commit', '--allow-empty', '-m', 'initial commit'])
}

describe('converge — mapped feature G1', () => {
  let ctx: AppCtx
  let repoPath: string
  let projectId: string
  const cleanup: string[] = []

  beforeEach(async () => {
    ctx = await makeTestCtx()
    repoPath = mkdtempSync(join(tmpdir(), 'runcastle-conv-'))
    cleanup.push(repoPath)
    await initRepo(repoPath)
    projectId = seedProject(ctx, repoPath).id
  })

  afterEach(() => {
    for (const d of cleanup) rmSync(d, { recursive: true, force: true })
    cleanup.length = 0
  })

  async function mappedFeature(slug: string) {
    const feature = seedFeature(ctx, projectId, { slug, mapped: true })
    await createFeatureBranch({ id: projectId, name: 't', repoPath, mainBranch: 'main' }, slug)
    cleanup.push(worktreeDir(projectId, slug))
    return feature
  }

  it('crosses G1 into spec and spawns a kind=converge session when every waypoint is terminal', async () => {
    const feature = await mappedFeature('ready')
    const [a, b] = storeWaypoints(ctx, feature.id, [wp('a'), wp('b')])
    resolve(ctx, a.id, 'resolved', 'answered')
    resolve(ctx, b.id, 'dropped', 'out of scope')

    const { sessionId } = await converge(ctx, { featureId: feature.id }, { spawn: false })
    cleanup.push(sessionDir(sessionId))

    // rejoined the normal pipeline at spec — no downstream special-casing
    expect(getFeatureRow(ctx, feature.id).phase).toBe('spec')
    const session = getSessionRow(ctx, sessionId)
    expect(session?.kind).toBe('converge')
    expect(session?.featureId).toBe(feature.id)
  })

  it('refuses to converge while a waypoint is still open (no override)', async () => {
    const feature = await mappedFeature('open')
    const [a] = storeWaypoints(ctx, feature.id, [wp('a'), wp('b')])
    resolve(ctx, a.id, 'resolved', 'answered') // b left open

    await expect(converge(ctx, { featureId: feature.id }, { spawn: false })).rejects.toThrow(
      GateError,
    )
    // the feature did not advance
    expect(getFeatureRow(ctx, feature.id).phase).toBe('ideation')
  })

  it('refuses to converge while a waypoint is claimed (no override)', async () => {
    const feature = await mappedFeature('claimed')
    const [a] = storeWaypoints(ctx, feature.id, [wp('a')])
    claim(ctx, a.id, 'sess_live')

    await expect(converge(ctx, { featureId: feature.id }, { spawn: false })).rejects.toThrow(
      GateError,
    )
    expect(getFeatureRow(ctx, feature.id).phase).toBe('ideation')
  })

  it('converges past open waypoints when given an override reason (records a G1 override)', async () => {
    const feature = await mappedFeature('override')
    storeWaypoints(ctx, feature.id, [wp('a'), wp('b')]) // both left open

    const { sessionId } = await converge(
      ctx,
      { featureId: feature.id, overrideReason: 'converging early — the rest is fog' },
      { spawn: false },
    )
    cleanup.push(sessionDir(sessionId))

    expect(getFeatureRow(ctx, feature.id).phase).toBe('spec')
    const overridden = listAfter(ctx, feature.id, 0).find((e) => e.type === 'gate.overridden')
    expect(overridden).toBeTruthy()
    expect(String(overridden?.data && (overridden.data as { gate?: string }).gate)).toBe('G1')
  })

  it('refuses to converge an unmapped feature', async () => {
    const plain = seedFeature(ctx, projectId, { slug: 'plain', mapped: false })
    await expect(converge(ctx, { featureId: plain.id }, { spawn: false })).rejects.toThrow(
      /not mapped/i,
    )
  })

  // --- re-convergence after a mid-run crash (E2E finding 3) ------------------
  // A converge session that dies leaves the feature past G1 (phase spec) with
  // zero tickets. That state must be recoverable: a fresh kind=converge session
  // may be spawned exactly there — and only there.

  it('refuses a second converge while the first converge session is still open', async () => {
    const feature = await mappedFeature('late')
    const [a] = storeWaypoints(ctx, feature.id, [wp('a')])
    resolve(ctx, a.id, 'resolved', 'answered')
    const first = await converge(ctx, { featureId: feature.id }, { spawn: false }) // now in spec
    cleanup.push(sessionDir(first.sessionId))

    // the first converge session row is still launching/live → no second terminal
    await expect(converge(ctx, { featureId: feature.id }, { spawn: false })).rejects.toThrow(
      /already live/i,
    )
  })

  it('allows re-convergence at spec with zero tickets once the crashed session ended', async () => {
    const feature = await mappedFeature('crashed')
    const [a] = storeWaypoints(ctx, feature.id, [wp('a')])
    resolve(ctx, a.id, 'resolved', 'answered')
    const first = await converge(ctx, { featureId: feature.id }, { spawn: false })
    cleanup.push(sessionDir(first.sessionId))
    markSessionEnded(ctx, first.sessionId) // the converge session crashed/was closed

    const second = await converge(ctx, { featureId: feature.id }, { spawn: false })
    cleanup.push(sessionDir(second.sessionId))
    expect(second.sessionId).not.toBe(first.sessionId)
    expect(getSessionRow(ctx, second.sessionId)?.kind).toBe('converge')
    // no double gate-crossing: the phase stays where G1 left it
    expect(getFeatureRow(ctx, feature.id).phase).toBe('spec')
    // the timeline says why this session exists
    const resumed = listAfter(ctx, feature.id, 0).find((e) => e.type === 'converge.resumed')
    expect(resumed).toBeTruthy()
  })

  it('refuses re-convergence once tickets exist (convergence completed)', async () => {
    const feature = await mappedFeature('done')
    const [a] = storeWaypoints(ctx, feature.id, [wp('a')])
    resolve(ctx, a.id, 'resolved', 'answered')
    const first = await converge(ctx, { featureId: feature.id }, { spawn: false })
    cleanup.push(sessionDir(first.sessionId))
    markSessionEnded(ctx, first.sessionId)
    storeTickets(ctx, feature.id, [
      { title: 't', goal: 'g', context: 'c', acceptanceCriteria: ['x'], seams: [], blockedBy: [] },
    ])

    await expect(converge(ctx, { featureId: feature.id }, { spawn: false })).rejects.toThrow(
      /ticket/i,
    )
  })

  it('refuses re-convergence at any later phase', async () => {
    const feature = seedFeature(ctx, projectId, { slug: 'shipped-ish', mapped: true, phase: 'implementation' })
    await expect(converge(ctx, { featureId: feature.id }, { spawn: false })).rejects.toThrow(
      /ideation/i,
    )
  })
})
