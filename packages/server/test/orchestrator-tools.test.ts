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
  toolTakeFeature,
  requireOrchestratorSession,
  requireProjectFeature,
} from '../src/mcp/orchestrator-tools'
import { emit, listAfter } from '../src/services/events'
import { readThreadEvents } from '../src/threads/types'
import { openProject } from '../src/services/projects'
import { withTempDataDir } from './helpers/data-dir'
import { makeTestCtx } from './helpers/db'
import { rmTemp, seedFeature, tmpRepo } from './helpers/fixtures'

/**
 * The shared gate (`one-orchestrator-no-mode` decision 2): every live project
 * session is the orchestrator; the gate refuses a caller that is not a live
 * orchestrator. What an orchestrator creates carries `actor: 'orchestrator'`.
 * Who may act on which feature is `threads-hold-features`: see holding.test.ts.
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

describe('the orchestrator’s gate', () => {
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

  function projectSession(): SessionRow {
    const row = createSessionRow(ctx, { projectId, kind: 'project', worktreePath: repoPath })
    markSessionLive(ctx, row.id, { ccSessionId: `cc-${row.id}` })
    return getSessionRow(ctx, row.id) as SessionRow
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

  it('create_feature from an orchestrator stamps every event of every shape as the orchestrator’s', async () => {
    const session = projectSession()
    const ordinary = await toolCreateFeature(ctx, session, { title: 'Login form', oneLiner: 'log in' })
    const draft = await toolCreateFeature(ctx, session, {
      title: 'Later thing',
      oneLiner: 'parked',
      draft: true,
    })

    for (const out of [ordinary, draft]) {
      const events = listAfter(ctx, out.id)
      expect(events.length, out.slug).toBeGreaterThan(0)
      for (const e of events) expect((e.data as { actor?: string })?.actor, `${out.slug} ${e.type}`).toBe('orchestrator')
    }
  })

  it('logs a feature_acted in the calling chat for each feature it creates or takes, and none for a refused call', async () => {
    const session = projectSession()
    const made = await toolCreateFeature(ctx, session, { title: 'Login form', oneLiner: 'log in' })
    const parked = await toolCreateFeature(ctx, session, { title: 'Later thing', oneLiner: 'parked', draft: true })
    const other = seedFeature(ctx, projectId, { slug: 'humans' })
    toolTakeFeature(ctx, session, { slug: 'humans' })
    await expect(toolCreateFeature(ctx, session, { title: 'No line', oneLiner: ' ' })).rejects.toThrow()
    expect(() => toolTakeFeature(ctx, session, { slug: 'nope' })).toThrow(GateError)

    const acted = readThreadEvents(session.id).filter((e) => e.type === 'feature_acted')
    expect(acted.map((e) => e.type === 'feature_acted' && [e.featureId, e.title, e.action])).toEqual([
      [made.id, 'Login form', 'created'],
      [parked.id, 'Later thing', 'parked'],
      [other.id, other.title, 'taken'],
    ])
  })

  it('accepts any feature of its project, one it did not create included', () => {
    const session = projectSession()
    const feature = seedFeature(ctx, projectId, { slug: 'humans' })
    expect(requireProjectFeature(ctx, session, 'humans').id).toBe(feature.id)
    expect(requireOrchestratorSession(session)).toBe(projectId)
  })

  it('refuses a session that is not an orchestrator', () => {
    const feature = seedFeature(ctx, projectId, { slug: 'humans' })
    const chat = createSessionRow(ctx, { featureId: feature.id, kind: 'chat', worktreePath: repoPath })
    expect(refusal(() => requireProjectFeature(ctx, chat, 'humans'))).toMatch(/only the orchestrator/)
    expect(refusal(() => requireOrchestratorSession(chat))).toMatch(/only the orchestrator/)
  })

  it('refuses an orchestrator that has ended', () => {
    seedFeature(ctx, projectId, { slug: 'humans' })
    const session = projectSession()
    markSessionEnded(ctx, session.id)
    const ended = getSessionRow(ctx, session.id) as SessionRow
    expect(refusal(() => requireProjectFeature(ctx, ended, 'humans'))).toMatch(/has ended/)
  })

  it('refuses a feature that does not exist in the project', () => {
    expect(refusal(() => requireProjectFeature(ctx, projectSession(), 'nope'))).toMatch(/no feature `nope`/)
  })

  it('get_project_context marks no feature as the orchestrator’s', async () => {
    seedFeature(ctx, projectId, { slug: 'one', title: 'One' })
    const out = await toolGetProjectContext(ctx, projectSession())
    expect(out.featureIndex.find((l) => l.startsWith('one —'))).not.toContain('orchestrated')
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

  it('offers every orchestrator tool to the orchestrator and to no other kind', () => {
    const tools = [
      'start_feature',
      'plan_feature',
      'send_to_feature',
      'read_feature_chat',
      'stop_feature_run',
      'drive',
      'merge_feature',
      'add_to_brief',
      'take_feature',
    ]
    expect(toolsForAudience('project')).toEqual(expect.arrayContaining(tools))
    for (const kind of ['chat', 'drive-fix', 'run'] as const) {
      expect(toolsForAudience(kind).filter((t) => tools.includes(t)), kind).toEqual([])
    }
  })

  it('offers no take_over_feature or record_test_note to the orchestrator', () => {
    const offered = toolsForAudience('project')
    expect(offered).not.toContain('take_over_feature')
    expect(offered).not.toContain('record_test_note')
  })
})
