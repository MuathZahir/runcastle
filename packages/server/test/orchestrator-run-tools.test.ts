import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Feature, SessionRow } from '@runcastle/core'
import { sessionDir, worktreeDir } from '@runcastle/core/paths'
import { simpleGit } from 'simple-git'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { GateError } from '../src/errors'
import { clearRuntimeCtx, setRuntimeCtx } from '../src/launcher/runtime'
import { createSessionRow, getSessionRow, markSessionLive } from '../src/launcher/sessions'
import { toolSendToFeature, toolStartFeatureLap } from '../src/mcp/orchestrator-run-tools'
import { listAfter } from '../src/services/events'
import { createFeatureBranch } from '../src/services/git'
import { openProject } from '../src/services/projects'
import { updateSettings } from '../src/services/settings'
import { withTempDataDir } from './helpers/data-dir'
import { makeTestCtx } from './helpers/db'
import { rmTemp, seedFeature, tmpRepo } from './helpers/fixtures'

/**
 * `send_to_feature` and `start_feature_lap` (`whole-cuts-plan-themselves`,
 * "Headless runs on a feature"): each reaches its headless launch for a feature
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

  const spawnOff = { spawn: false } as const

  it('send_to_feature relays the message to an owned feature, headless', async () => {
    const f = await feature('sent-back')
    const { sessionId } = await toolSendToFeature(
      ctx,
      orchestrator(),
      { slug: 'sent-back', message: 'Keep the list; drop the grid.' },
      spawnOff,
    )
    cleanup.push(sessionDir(sessionId))

    const row = getSessionRow(ctx, sessionId)
    expect(row?.purpose).toBe('relay')
    expect(row?.headless).toBe(true)
    const launched = listAfter(ctx, f.id, 0).find((e) => e.type === 'session.launched')
    expect(String(launched?.data?.command)).toContain('Keep the list; drop the grid.')
  })

  it('start_feature_lap starts an owned feature’s next lap, headless', async () => {
    await feature('next-lap', { phase: 'review' })
    const { sessionId } = await toolStartFeatureLap(
      ctx,
      orchestrator(),
      { slug: 'next-lap', message: 'Fix the empty state.' },
      spawnOff,
    )
    cleanup.push(sessionDir(sessionId))

    const row = getSessionRow(ctx, sessionId)
    expect(row?.purpose).toBe('start-lap')
    expect(row?.headless).toBe(true)
  })

  it('start_feature_lap is refused where the human’s Start lap is', async () => {
    await feature('still-planning')
    await expect(
      toolStartFeatureLap(ctx, orchestrator(), { slug: 'still-planning' }, spawnOff),
    ).rejects.toThrow(/not review, so there is no next lap to start/)
  })

  describe('refuses through the shared gate', () => {
    it('for a feature the orchestrator does not own', async () => {
      await feature('humans', { orchestrated: false, phase: 'review' })
      const session = orchestrator()
      await expect(
        toolSendToFeature(ctx, session, { slug: 'humans', message: 'x' }, spawnOff),
      ).rejects.toThrow(/the human's feature, not yours/)
      await expect(toolStartFeatureLap(ctx, session, { slug: 'humans' }, spawnOff)).rejects.toThrow(
        /the human's feature, not yours/,
      )
    })

    it('from a session that is not orchestrating', async () => {
      await feature('owned', { phase: 'review' })
      updateSettings(ctx, { projectId, key: 'orchestrator', value: true })
      const ordinary = projectSession()
      for (const call of [
        () => toolSendToFeature(ctx, ordinary, { slug: 'owned', message: 'x' }, spawnOff),
        () => toolStartFeatureLap(ctx, ordinary, { slug: 'owned' }, spawnOff),
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
        toolSendToFeature(ctx, session, { slug: 'stopped', message: 'x' }, spawnOff),
      ).rejects.toThrow(/Orchestrator setting is off/)
      await expect(toolStartFeatureLap(ctx, session, { slug: 'stopped' }, spawnOff)).rejects.toThrow(
        /Orchestrator setting is off/,
      )
    })
  })
})
