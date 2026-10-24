import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Feature, SessionRow } from '@runcastle/core'
import { worktreeDir } from '@runcastle/core/paths'
import { simpleGit } from 'simple-git'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { GateError } from '../src/errors'
import { clearRuntimeCtx, setRuntimeCtx } from '../src/launcher/runtime'
import { createSessionRow, getSessionRow, markSessionLive } from '../src/launcher/sessions'
import { toolSendToFeature } from '../src/mcp/orchestrator-run-tools'
import { getFeatureRow } from '../src/services/repo'
import { listAfter } from '../src/services/events'
import { createFeatureBranch } from '../src/services/git'
import { openProject } from '../src/services/projects'
import { updateSettings } from '../src/services/settings'
import { withTempDataDir } from './helpers/data-dir'
import { makeTestCtx } from './helpers/db'
import { rmTemp, seedFeature, tmpRepo } from './helpers/fixtures'

/**
 * `send_to_feature` (`whole-cuts-plan-themselves`, `the-feature-lead-runs-rounds`,
 * "Headless runs on a feature"): it reaches a relay or the lead of a feature
 * the orchestrator owns, and refuses through the shared gate otherwise.
 */

async function gitRepo(): Promise<string> {
  const dir = tmpRepo()
  const g = simpleGit(dir)
  await g.init(['-b', 'main'])
  await g.addConfig('user.email', 'test@runcastle.dev')
  await g.addConfig('user.name', 'Runcastle Test')
  writeFileSync(join(dir, 'README.md'), 'base\n')
  await g.add(['README.md'])
  await g.commit('initial commit')
  return dir
}

describe('the orchestrator’s headless-run tools', () => {
  let ctx: AppCtx
  let repoPath: string
  let projectId: string
  let restoreDataDir: () => void
  const cleanup: string[] = []

  beforeEach(async () => {
    restoreDataDir = withTempDataDir()
    ctx = await makeTestCtx()
    repoPath = await gitRepo()
    projectId = (await openProject(ctx, repoPath)).id
    setRuntimeCtx(ctx)
  })

  afterEach(() => {
    clearRuntimeCtx()
    for (const d of cleanup) rmSync(d, { recursive: true, force: true })
    cleanup.length = 0
    restoreDataDir()
    rmTemp(repoPath)
  })

  function projectSession(purpose?: 'orchestrate'): SessionRow {
    const row = createSessionRow(ctx, {
      projectId,
      kind: 'project',
      worktreePath: repoPath,
      ...(purpose ? { purpose } : {}),
    })
    markSessionLive(ctx, row.id, { ccSessionId: `cc-${row.id}` })
    return getSessionRow(ctx, row.id) as SessionRow
  }

  function orchestrator(): SessionRow {
    updateSettings(ctx, { projectId, key: 'orchestrator', value: true })
    return projectSession('orchestrate')
  }

  async function feature(slug: string, overrides: Partial<Feature> = {}): Promise<Feature> {
    const f = seedFeature(ctx, projectId, { slug, orchestrated: true, ...overrides })
    await createFeatureBranch({ id: projectId, name: 't', repoPath }, slug, 'main')
    cleanup.push(worktreeDir(projectId, slug))
    return f
  }

  /**
   * Every chat on a feature is its lead: the orchestrator's message reaches it
   * as the human's would, through the one lead-delivery path, and counts as a
   * human message — whatever the feature's state, with no planning relay.
   */
  it('send_to_feature reaches the feature’s lead as a human message whatever its state, launching nothing', async () => {
    for (const phase of ['planning', 'building', 'review'] as const) {
      const f = await feature(`led-${phase}`, { phase })
      const result = await toolSendToFeature(ctx, orchestrator(), {
        slug: f.slug,
        message: 'The empty state still says nothing.',
      })

      expect(result).toEqual({ deliveredToLead: true })
      const events = listAfter(ctx, f.id, 0)
      expect(events.some((e) => e.type === 'session.launched')).toBe(false)
      const pending = events.find((e) => e.type === 'lead.message_pending')
      expect(pending?.data).toEqual({
        source: 'human',
        text: 'The empty state still says nothing.',
        sessionId: null,
      })
      expect(getFeatureRow(ctx, f.id).lastHumanMessageAt).toEqual(expect.any(Number))
    }
  })

  describe('refuses through the shared gate', () => {
    it('for a feature the orchestrator does not own', async () => {
      await feature('humans', { orchestrated: false, phase: 'review' })
      const session = orchestrator()
      await expect(
        toolSendToFeature(ctx, session, { slug: 'humans', message: 'x' }),
      ).rejects.toThrow(/the human's feature, not yours/)
    })

    it('from a session that is not orchestrating', async () => {
      await feature('owned', { phase: 'review' })
      updateSettings(ctx, { projectId, key: 'orchestrator', value: true })
      const ordinary = projectSession()
      for (const call of [
        () => toolSendToFeature(ctx, ordinary, { slug: 'owned', message: 'x' }),
      ]) {
        await expect(call()).rejects.toBeInstanceOf(GateError)
        await expect(call()).rejects.toThrow(/only the orchestrator/)
      }
    })

    it('once the setting is off', async () => {
      await feature('stopped', { phase: 'review' })
      const session = orchestrator()
      updateSettings(ctx, { projectId, key: 'orchestrator', value: false })
      await expect(
        toolSendToFeature(ctx, session, { slug: 'stopped', message: 'x' }),
      ).rejects.toThrow(/Orchestrator setting is off/)
    })
  })
})
