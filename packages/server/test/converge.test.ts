import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sessionDir, worktreeDir } from '@runcastle/core/paths'
import { simpleGit } from 'simple-git'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { converge } from '../src/launcher/launcher'
import { getSessionRow } from '../src/launcher/sessions'
import { createFeatureBranch } from '../src/services/git'
import { getFeatureRow, setPhase } from '../src/services/repo'
import { claim, storeWaypoints } from '../src/services/waypoints'
import { makeTestCtx } from './helpers/db'
import { seedFeature, seedProject } from './helpers/fixtures'

/**
 * Convergence, after the four-state collapse. The map is a mode inside planning
 * (ADR-0001 survives as such), so converging moves the feature nowhere — it
 * spawns the kind=converge session and leaves the state alone.
 *
 * What is gone is G1. `all-waypoints-terminal` used to refuse convergence while
 * any waypoint was open or claimed, escapable only with an override reason;
 * with the gates retired, an unfinished map is something the human reads and
 * converges anyway. Two refusals remain, and both are about what convergence
 * even means: an unmapped feature has no map, and a feature past planning has
 * nothing left to converge into.
 */

function wp(title: string) {
  return { title, type: 'grilling' as const, question: `q: ${title}`, blockedBy: [] }
}

async function initRepo(dir: string): Promise<void> {
  const g = simpleGit(dir)
  await g.init(['-b', 'main'])
  await g.addConfig('user.email', 'test@runcastle.dev')
  await g.addConfig('user.name', 'Runcastle Test')
  await g.addConfig('core.autocrlf', 'false')
  await g.raw(['commit', '--allow-empty', '-m', 'initial commit'])
}

describe('converge — a mapped feature closing its map', () => {
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
    await createFeatureBranch({ id: projectId, name: 't', repoPath }, slug, 'main')
    cleanup.push(worktreeDir(projectId, slug))
    return feature
  }

  it('spawns a kind=converge session and leaves the feature in planning', async () => {
    const feature = await mappedFeature('ready')
    storeWaypoints(ctx, feature.id, [wp('a'), wp('b')])

    const { sessionId } = await converge(ctx, { featureId: feature.id }, { spawn: false })
    cleanup.push(sessionDir(sessionId))

    expect(getFeatureRow(ctx, feature.id).phase).toBe('planning')
    const session = getSessionRow(ctx, sessionId)
    expect(session?.kind).toBe('converge')
    expect(session?.featureId).toBe(feature.id)
  })

  it('converges past an open and a claimed waypoint — the map no longer refuses', async () => {
    const feature = await mappedFeature('open')
    const [a] = storeWaypoints(ctx, feature.id, [wp('a'), wp('b')])
    claim(ctx, a.id, 'sess_live') // one claimed, one never touched

    const { sessionId } = await converge(ctx, { featureId: feature.id }, { spawn: false })
    cleanup.push(sessionDir(sessionId))

    expect(getSessionRow(ctx, sessionId)?.kind).toBe('converge')
  })

  it('refuses to converge an unmapped feature', async () => {
    const plain = seedFeature(ctx, projectId, { slug: 'plain', mapped: false })
    await expect(converge(ctx, { featureId: plain.id }, { spawn: false })).rejects.toThrow(
      /not mapped/i,
    )
  })

  it('refuses to converge a feature that is already past planning', async () => {
    const feature = await mappedFeature('burning')
    setPhase(ctx, feature.id, 'building', 'burn.started', 'burning tickets — lap 1')

    await expect(converge(ctx, { featureId: feature.id }, { spawn: false })).rejects.toThrow(
      /converge runs during planning/i,
    )
  })
})
