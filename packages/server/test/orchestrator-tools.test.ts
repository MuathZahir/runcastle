import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { SessionRow } from '@runcastle/core'
import { simpleGit } from 'simple-git'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { GateError } from '../src/errors'
import { clearRuntimeCtx, setRuntimeCtx } from '../src/launcher/runtime'
import {
  createSessionRow,
  getSessionRow,
  markSessionEnded,
  markSessionLive,
} from '../src/launcher/sessions'
import { toolCreateFeature, toolGetProjectContext, toolsForAudience } from '../src/mcp/server'
import {
  orchestratorTool,
  requireOrchestratedFeature,
  requireOrchestratorSession,
  toolTakeOverFeature,
} from '../src/mcp/orchestrator-tools'
import { emit, listAfter } from '../src/services/events'
import { openProject } from '../src/services/projects'
import { getFeatureRow } from '../src/services/repo'
import { updateSettings } from '../src/services/settings'
import { withTempDataDir } from './helpers/data-dir'
import { makeTestCtx } from './helpers/db'
import { rmTemp, seedFeature, tmpRepo } from './helpers/fixtures'

/**
 * Ownership and the shared gate (`whole-cuts-plan-themselves` decisions 6, 9):
 * what an `orchestrate` session creates is its own, it can take over what the
 * human hands it, and every orchestrator tool refuses through one gate.
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

describe('the orchestrator’s ownership and gate', () => {
  let ctx: AppCtx
  let repoPath: string
  let projectId: string
  let restoreDataDir: () => void

  beforeEach(async () => {
    restoreDataDir = withTempDataDir()
    ctx = await makeTestCtx()
    repoPath = await gitRepo()
    projectId = (await openProject(ctx, repoPath)).id
    setRuntimeCtx(ctx)
  })

  afterEach(() => {
    clearRuntimeCtx()
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

  function refusal(call: () => unknown): string {
    try {
      call()
    } catch (e) {
      expect(e).toBeInstanceOf(GateError)
      return (e as GateError).message
    }
    throw new Error('expected a refusal')
  }

  it('create_feature from an orchestrate session marks every shape it creates as owned', async () => {
    const session = orchestrator()
    const ordinary = await toolCreateFeature(ctx, session, { title: 'Login form', oneLiner: 'log in' })
    const draft = await toolCreateFeature(ctx, session, {
      title: 'Later thing',
      oneLiner: 'parked',
      draft: true,
    })
    const quick = await toolCreateFeature(ctx, session, { title: 'Quick fix', tickets: ['Fix the typo.'] })

    for (const out of [ordinary, draft, quick]) {
      expect(getFeatureRow(ctx, out.id).orchestrated, out.slug).toBe(true)
      expect(listAfter(ctx, out.id).map((e) => e.type), out.slug).toContain('feature.orchestrated')
    }
  })

  it('create_feature from an ordinary project session leaves the feature the human’s', async () => {
    const out = await toolCreateFeature(ctx, projectSession(), { title: 'Mine', oneLiner: 'human' })
    expect(getFeatureRow(ctx, out.id).orchestrated).toBe(false)
  })

  it('take_over_feature makes a human feature the orchestrator’s and says so on the timeline', () => {
    const session = orchestrator()
    const feature = seedFeature(ctx, projectId, { slug: 'handed' })
    expect(() => requireOrchestratedFeature(ctx, session, 'handed')).toThrow(GateError)

    expect(toolTakeOverFeature(ctx, session, { slug: 'handed' })).toEqual({
      slug: 'handed',
      orchestrated: true,
    })
    expect(getFeatureRow(ctx, feature.id).orchestrated).toBe(true)
    expect(listAfter(ctx, feature.id).map((e) => e.type)).toContain('feature.orchestrated')
    expect(requireOrchestratedFeature(ctx, session, 'handed').id).toBe(feature.id)
  })

  it('refuses from a project session that is not orchestrating', () => {
    seedFeature(ctx, projectId, { slug: 'handed', orchestrated: true })
    updateSettings(ctx, { projectId, key: 'orchestrator', value: true })
    const ordinary = projectSession()
    expect(refusal(() => toolTakeOverFeature(ctx, ordinary, { slug: 'handed' }))).toMatch(
      /only the orchestrator/,
    )
    expect(refusal(() => requireOrchestratedFeature(ctx, ordinary, 'handed'))).toMatch(
      /only the orchestrator/,
    )
  })

  it('refuses from an orchestrator session that has ended', () => {
    seedFeature(ctx, projectId, { slug: 'handed', orchestrated: true })
    const session = orchestrator()
    markSessionEnded(ctx, session.id)
    const ended = getSessionRow(ctx, session.id) as SessionRow
    expect(refusal(() => toolTakeOverFeature(ctx, ended, { slug: 'handed' }))).toMatch(/has ended/)
    expect(refusal(() => requireOrchestratedFeature(ctx, ended, 'handed'))).toMatch(/has ended/)
  })

  it('refuses once the setting is turned off', () => {
    seedFeature(ctx, projectId, { slug: 'handed', orchestrated: true })
    const session = orchestrator()
    updateSettings(ctx, { projectId, key: 'orchestrator', value: false })
    expect(refusal(() => toolTakeOverFeature(ctx, session, { slug: 'handed' }))).toMatch(
      /setting is off/,
    )
    expect(refusal(() => requireOrchestratorSession(ctx, session))).toMatch(/setting is off/)
    expect(refusal(() => requireOrchestratedFeature(ctx, session, 'handed'))).toMatch(
      /setting is off/,
    )
  })

  it('the feature gate refuses a feature the orchestrator does not own, or one that does not exist', () => {
    const session = orchestrator()
    seedFeature(ctx, projectId, { slug: 'humans' })
    expect(refusal(() => requireOrchestratedFeature(ctx, session, 'humans'))).toMatch(
      /the human's feature, not yours/,
    )
    expect(refusal(() => requireOrchestratedFeature(ctx, session, 'nope'))).toMatch(
      /no feature `nope`/,
    )
  })

  it('get_project_context marks the orchestrator’s features in its index', async () => {
    seedFeature(ctx, projectId, { slug: 'owned', title: 'Owned', orchestrated: true })
    seedFeature(ctx, projectId, { slug: 'humans', title: 'Humans' })
    const out = await toolGetProjectContext(ctx, projectSession())
    expect(out.featureIndex.find((l) => l.startsWith('owned —'))).toMatch(/ · orchestrated$/)
    expect(out.featureIndex.find((l) => l.startsWith('humans —'))).not.toContain('orchestrated')
  })

  it('stamps events emitted inside an orchestrator tool with the orchestrator as actor', async () => {
    const feature = seedFeature(ctx, projectId, { slug: 'stamped' })
    await orchestratorTool(async () => {
      await Promise.resolve()
      emit(ctx, feature.id, { type: 'test.inside', message: 'inside', data: { n: 1 } })
      emit(ctx, feature.id, { type: 'test.bare', message: 'no data' })
    })()
    emit(ctx, feature.id, { type: 'test.outside', message: 'outside', data: { n: 2 } })

    const byType = new Map(listAfter(ctx, feature.id).map((e) => [e.type, e.data]))
    expect(byType.get('test.inside')).toEqual({ n: 1, actor: 'orchestrator' })
    expect(byType.get('test.bare')).toEqual({ actor: 'orchestrator' })
    expect(byType.get('test.outside')).toEqual({ n: 2 })
  })

  it('offers every orchestrator tool to the project session and to no other kind', () => {
    const tools = [
      'take_over_feature',
      'start_feature',
      'plan_feature',
      'send_to_feature',
      'stop_feature_run',
      'burn_feature',
      'drive',
      'record_test_note',
      'start_feature_lap',
      'merge_feature',
      'add_to_brief',
    ]
    expect(toolsForAudience('project')).toEqual(expect.arrayContaining(tools))
    for (const kind of ['chat', 'prepare', 'drive-fix', 'run'] as const) {
      expect(toolsForAudience(kind).filter((t) => tools.includes(t)), kind).toEqual([])
    }
  })
})
