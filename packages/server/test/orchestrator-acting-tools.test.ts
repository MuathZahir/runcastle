import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Feature, SessionRow } from '@runcastle/core'
import { sessionDir, worktreeDir } from '@runcastle/core/paths'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { simpleGit } from 'simple-git'
import type { SimpleGit } from 'simple-git'
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
import {
  toolAddToBrief,
  withBriefSection,
  toolMergeFeature,
  toolStartFeature,
} from '../src/mcp/orchestrator-tools'
import {
  buildMcpServer,
  featureContext,
  projectFeatureReader,
  toolReadFeatureDoc,
} from '../src/mcp/server'
import { listAfter } from '../src/services/events'
import { featureDocPath } from '../src/services/feature-docs'
import {
  __resetTestDriveState,
  createFeatureBranch,
  ensureTalkWorktree,
} from '../src/services/git'
import { openProject } from '../src/services/projects'
import { getFeatureRow, projectForFeature } from '../src/services/repo'
import { withTempDataDir } from './helpers/data-dir'
import { makeTestCtx } from './helpers/db'
import { rmTemp, seedFeature, tmpRepo } from './helpers/fixtures'

/**
 * The orchestrator's acting tools (`whole-cuts-plan-themselves` decisions 4, 8,
 * 16; `autopilot-retires` decisions 4 and 12): each reaches the service under
 * the human's button, passes that service's own refusals through, and acts
 * only on its own epic's features, a brief edit only on a draft.
 */


describe('the orchestrator’s acting tools', () => {
  let ctx: AppCtx
  let repoPath: string
  let g: SimpleGit
  let projectId: string
  let restoreDataDir: () => void
  const cleanup: string[] = []

  beforeEach(async () => {
    __resetTestDriveState()
    restoreDataDir = withTempDataDir()
    ctx = await makeTestCtx()
    repoPath = tmpRepo()
    g = simpleGit(repoPath)
    await g.init(['-b', 'main'])
    await g.addConfig('user.email', 'test@runcastle.dev')
    await g.addConfig('user.name', 'Runcastle Test')
    await g.addConfig('core.autocrlf', 'false')
    writeFileSync(join(repoPath, 'README.md'), 'base\n')
    await g.add(['README.md'])
    await g.commit('initial commit')
    projectId = (await openProject(ctx, repoPath)).id
    setRuntimeCtx(ctx)
  })

  afterEach(() => {
    owner = null
    __resetTestDriveState()
    clearRuntimeCtx()
    for (const d of cleanup.splice(0)) rmSync(d, { recursive: true, force: true })
    restoreDataDir()
    rmTemp(repoPath)
  })

  /** The newest orchestrator, which owns the features `started` seeds after it. */
  let owner: string | null = null

  /** A live orchestrator — the orchestrator. */
  function orchestrator(): SessionRow {
    const row = createSessionRow(ctx, { projectId, kind: 'project', worktreePath: repoPath })
    markSessionLive(ctx, row.id, { ccSessionId: `cc-${row.id}` })
    owner = row.id
    return getSessionRow(ctx, row.id) as SessionRow
  }

  /** A started feature with its branch cut, of the newest orchestrator's epic. */
  async function started(slug: string, overrides: Partial<Feature> = {}): Promise<Feature> {
    const f = seedFeature(ctx, projectId, { slug, chatId: owner, ...overrides })
    await createFeatureBranch({ id: projectId, name: 't', repoPath }, slug, 'main')
    cleanup.push(worktreeDir(projectId, slug))
    return f
  }

  async function refusal(call: () => unknown): Promise<string> {
    try {
      await call()
    } catch (e) {
      expect(e).toBeInstanceOf(GateError)
      return (e as GateError).message
    }
    throw new Error('expected a refusal')
  }

  describe('the shared gate', () => {
    const calls: Record<string, (ctx: AppCtx, s: SessionRow, slug: string) => unknown> = {
      start_feature: (c, s, slug) => toolStartFeature(c, s, { slug }, { spawn: false }),
      merge_feature: (c, s, slug) => toolMergeFeature(c, s, { slug }),
      add_to_brief: (c, s, slug) => toolAddToBrief(c, s, { slug, text: 'x' }),
    }

    for (const [name, call] of Object.entries(calls)) {
      it(`${name} refuses a session that is not an orchestrator, and an ended one`, async () => {
        const f = seedFeature(ctx, projectId, { slug: 'humans' })
        const chat = createSessionRow(ctx, { featureId: f.id, kind: 'chat', worktreePath: repoPath })
        expect(await refusal(() => call(ctx, chat, 'humans'))).toMatch(/only the orchestrator/)

        const session = orchestrator()
        markSessionEnded(ctx, session.id)
        const ended = getSessionRow(ctx, session.id) as SessionRow
        expect(await refusal(() => call(ctx, ended, 'humans'))).toMatch(/not the orchestrator chat runcastle is running/)
      })
    }
  })

  it('start_feature starts a draft it did not create, and passes Start’s refusal through', async () => {
    const session = orchestrator()
    const draft = seedFeature(ctx, projectId, { slug: 'parked', status: 'draft', chatId: session.id })
    cleanup.push(worktreeDir(projectId, 'parked'))

    const out = await toolStartFeature(ctx, session, { slug: 'parked', baseBranch: 'main' }, { spawn: false })
    cleanup.push(sessionDir(out.sessionId))
    expect(out).toEqual({ slug: 'parked', status: 'active', baseBranch: 'main', sessionId: out.sessionId, lead: 'asksFirst' })
    expect(getSessionRow(ctx, out.sessionId)).toMatchObject({ featureId: draft.id, kind: 'chat' })
    expect(getSessionRow(ctx, out.sessionId)?.purpose).toBeFalsy()
    expect(getFeatureRow(ctx, draft.id).status).toBe('active')
    const started = listAfter(ctx, draft.id).find((e) => e.type === 'feature.started')
    expect(started?.data).toMatchObject({ actor: 'orchestrator' })

    markSessionLive(ctx, out.sessionId, { ccSessionId: 'cc-lead' })
    expect(await refusal(() => toolStartFeature(ctx, session, { slug: 'parked' }, { spawn: false }))).toMatch(
      /its lead is running.*send_to_feature/,
    )
  })

  /**
   * Decision 4: a feature cut from the base must carry what the orchestrator
   * prepared, so its commits on `runcastle/project` land before the branch is
   * cut — and a landing that would hurt the human's checkout refuses the start.
   */
  describe('start_feature lands the orchestrator’s commits first', () => {
    async function orchestratorCommits(file: string, content: string): Promise<void> {
      const wt = join(tmpRepo(), 'wt')
      cleanup.push(dirname(wt))
      await g.raw(['worktree', 'add', '-b', 'runcastle/project', wt, 'main'])
      writeFileSync(join(wt, file), content)
      await simpleGit(wt).add([file]).commit(`orchestrator: ${file}`)
    }

    it('cuts the feature from a base that has them', async () => {
      const session = orchestrator()
      seedFeature(ctx, projectId, { slug: 'parked', status: 'draft', chatId: session.id })
      cleanup.push(worktreeDir(projectId, 'parked'))
      await orchestratorCommits('drive-setup.ts', '// prepared\n')

      await toolStartFeature(ctx, session, { slug: 'parked', baseBranch: 'main' }, { spawn: false })

      expect(await g.raw(['show', 'feature/parked:drive-setup.ts'])).toBe('// prepared\n')
      expect(await g.raw(['show', 'main:drive-setup.ts'])).toBe('// prepared\n')
    })

    it('refuses the start, cutting nothing, when the checkout is on another branch', async () => {
      const session = orchestrator()
      const draft = seedFeature(ctx, projectId, { slug: 'parked', status: 'draft', chatId: session.id })
      await orchestratorCommits('drive-setup.ts', '// prepared\n')
      await g.checkoutLocalBranch('elsewhere')

      expect(await refusal(() => toolStartFeature(ctx, session, { slug: 'parked', baseBranch: 'main' }, { spawn: false }))).toMatch(
        /could not land first.*is on elsewhere/,
      )
      expect(getFeatureRow(ctx, draft.id).status).toBe('draft')
      expect((await g.branchLocal()).all).not.toContain('feature/parked')
    })

    it('refuses the start on a conflict', async () => {
      const session = orchestrator()
      const draft = seedFeature(ctx, projectId, { slug: 'parked', status: 'draft', chatId: session.id })
      await orchestratorCommits('README.md', 'the orchestrator\n')
      writeFileSync(join(repoPath, 'README.md'), 'the human\n')
      await g.add(['README.md']).commit('human edit')

      expect(await refusal(() => toolStartFeature(ctx, session, { slug: 'parked', baseBranch: 'main' }, { spawn: false }))).toMatch(
        /conflict with main/,
      )
      expect(getFeatureRow(ctx, draft.id).status).toBe('draft')
    })
  })

  /**
   * `autopilot-retires` decision 12: one rule. The epic acts only on its own
   * features, and edits a brief only while the feature is a draft.
   */
  describe('one rule: its own epic’s features', () => {
    it('starts a started feature whose lead is not running, by its level', async () => {
      const session = orchestrator()
      const f = await started('resumed', { involvement: 'resultOnly' })

      const out = await toolStartFeature(ctx, session, { slug: 'resumed' }, { spawn: false })
      cleanup.push(sessionDir(out.sessionId))
      expect(out).toMatchObject({ slug: 'resumed', status: 'active', lead: 'plansAlone' })
      expect(getSessionRow(ctx, out.sessionId)).toMatchObject({ featureId: f.id, kind: 'chat', purpose: 'self-plan' })
    })

    it('refuses to start a shipped feature', async () => {
      const session = orchestrator()
      await started('built', { status: 'shipped' })
      expect(await refusal(() => toolStartFeature(ctx, session, { slug: 'built' }, { spawn: false }))).toMatch(/has shipped/)
    })

    it('refuses a brief edit once the feature has started, pointing at its lead', async () => {
      const session = orchestrator()
      const f = await started('going')
      expect(await refusal(() => toolAddToBrief(ctx, session, { slug: 'going', text: 'x' }))).toMatch(
        /`going` has started.*send_to_feature/,
      )
      expect(listAfter(ctx, f.id).some((e) => e.type === 'brief.added')).toBe(false)
    })

    it('refuses every acting tool on another epic’s feature, and on the human’s own', async () => {
      const other = orchestrator()
      const session = orchestrator()
      seedFeature(ctx, projectId, { slug: 'theirs', status: 'draft', baseBranch: null, chatId: other.id })
      seedFeature(ctx, projectId, { slug: 'humans', status: 'draft', baseBranch: null, chatId: null })
      for (const slug of ['theirs', 'humans']) {
        for (const call of [
          () => toolStartFeature(ctx, session, { slug, baseBranch: 'main' }, { spawn: false }),
          () => toolAddToBrief(ctx, session, { slug, text: 'x' }),
          () => toolMergeFeature(ctx, session, { slug }),
        ]) {
          expect(await refusal(call)).toMatch(/not one of this epic's features.*Link the human to its chat/)
        }
      }
    })
  })

  it('merge_feature ships a clean feature with its outcome doc', async () => {
    const session = orchestrator()
    const f = await started('landing', {})
    await g.checkout('feature/landing')
    writeFileSync(join(repoPath, 'landing.txt'), 'work\n')
    await g.add(['landing.txt'])
    await g.commit('feat: work')
    await g.checkout('main')

    const res = await toolMergeFeature(ctx, session, { slug: 'landing' })
    expect(res).toMatchObject({ ok: true, base: 'main', files: [] })
    expect(getFeatureRow(ctx, f.id)).toMatchObject({ status: 'shipped' })
    // No decisions.md or spec.md: a one-file feature, whose record is brief.md's review summary.
    expect(await g.raw(['show', 'main:docs/features/landing/brief.md'])).toContain('## Review summary')
  })

  it('merge_feature answers with its epic’s other features in progress, and says who merged on the event', async () => {
    const session = orchestrator()
    const other = createSessionRow(ctx, { projectId, kind: 'project', worktreePath: repoPath })
    const f = await started('fits', { chatId: session.id })
    seedFeature(ctx, projectId, { slug: 'mine', title: 'Mine', chatId: session.id })
    seedFeature(ctx, projectId, { slug: 'theirs', title: 'Theirs', chatId: session.id })
    seedFeature(ctx, projectId, { slug: 'later', chatId: session.id, status: 'draft' })
    seedFeature(ctx, projectId, { slug: 'done', chatId: session.id, status: 'shipped' })
    seedFeature(ctx, projectId, { slug: 'dropped', chatId: session.id, status: 'archived' })
    seedFeature(ctx, projectId, { slug: 'elsewhere', chatId: other.id })
    await g.checkout('feature/fits')
    writeFileSync(join(repoPath, 'fits.txt'), 'work\n')
    await g.add(['fits.txt'])
    await g.commit('feat: work')
    await g.checkout('main')

    const res = await toolMergeFeature(ctx, session, { slug: 'fits' })

    expect(res).toMatchObject({ ok: true, base: 'main' })
    const inProgress = (res as { inProgress?: unknown[] }).inProgress
    expect(inProgress).toHaveLength(2)
    expect(inProgress).toEqual(
      expect.arrayContaining([
        { slug: 'mine', title: 'Mine' },
        { slug: 'theirs', title: 'Theirs' },
      ]),
    )
    const shipped = listAfter(ctx, f.id).find((e) => e.type === 'feature.shipped')
    expect(shipped?.data).toMatchObject({
      mergedBy: session.id,
      base: 'main',
      sha: expect.stringMatching(/^[0-9a-f]{40}$/),
      outcome: 'docs/features/fits/brief.md',
    })
  })

  it('merge_feature refuses a feature of another epic, merging nothing', async () => {
    const session = orchestrator()
    const epic = createSessionRow(ctx, { projectId, kind: 'project', worktreePath: repoPath })
    const f = await started('theirs', { chatId: epic.id })
    expect(await refusal(() => toolMergeFeature(ctx, session, { slug: 'theirs' }))).toMatch(/not one of this epic's features/)
    expect(getFeatureRow(ctx, f.id).status).toBe('active')
  })

  it('merge_feature returns a conflict’s files and records merge.conflict', async () => {
    const session = orchestrator()
    const f = await started('clash', {})
    await g.checkout('feature/clash')
    writeFileSync(join(repoPath, 'README.md'), 'feature-line\n')
    await g.add(['README.md'])
    await g.commit('feat: edit readme')
    await g.checkout('main')
    writeFileSync(join(repoPath, 'README.md'), 'main-line\n')
    await g.add(['README.md'])
    await g.commit('chore: edit readme on main')

    const res = await toolMergeFeature(ctx, session, { slug: 'clash' })
    expect(res).toEqual({ ok: false, conflict: true, base: 'main', files: ['README.md'] })
    const ev = listAfter(ctx, f.id).find((e) => e.type === 'merge.conflict')
    expect(ev?.data).toMatchObject({ base: 'main', files: ['README.md'], actor: 'orchestrator' })
    expect(getFeatureRow(ctx, f.id).status).toBe('active')
  })

  it('add_to_brief inserts above whichever later part comes first', () => {
    const date = new Date().toISOString().slice(0, 10)
    expect(withBriefSection('# B\n\n## Build notes\n\nx\n\n## Decisions\n', 'more')).toBe(
      `# B\n\n## Added by the orchestrator, ${date}\n\nmore\n\n## Build notes\n\nx\n\n## Decisions\n`,
    )
    expect(withBriefSection('# B\n## Review summary\n', 'more')).toBe(
      `# B\n\n## Added by the orchestrator, ${date}\n\nmore\n\n## Review summary\n`,
    )
    // A heading that only starts the same way is not one of the parts.
    expect(withBriefSection('# B\n\n## Decisions we might make\n', 'more')).toBe(
      `# B\n\n## Decisions we might make\n\n## Added by the orchestrator, ${date}\n\nmore\n`,
    )
  })

  it('add_to_brief appends to a draft’s parked brief, and Start lands it in brief.md', async () => {
    const session = orchestrator()
    const draft = seedFeature(ctx, projectId, {
      slug: 'waiting',
      status: 'draft',
      chatId: session.id,
      brief: 'The human wants a changelog.',
    })
    cleanup.push(worktreeDir(projectId, 'waiting'))

    await toolAddToBrief(ctx, session, { slug: 'waiting', text: 'Run it autonomous.' })

    const date = new Date().toISOString().slice(0, 10)
    const expected = `The human wants a changelog.\n\n## Added by the orchestrator, ${date}\n\nRun it autonomous.\n`
    expect(getFeatureRow(ctx, draft.id)).toMatchObject({ status: 'draft', brief: expected })
    expect(listAfter(ctx, draft.id).find((e) => e.type === 'brief.added')?.data).toMatchObject({
      actor: 'orchestrator',
    })

    await toolStartFeature(ctx, session, { slug: 'waiting', baseBranch: 'main' }, { spawn: false })
    expect(await g.raw(['show', 'feature/waiting:docs/features/waiting/brief.md'])).toContain(
      expected,
    )
  })

  describe('feature reads from the orchestrator', () => {
    it('name any feature of the project by slug', async () => {
      const f = await started('readable')
      seedFeature(ctx, projectId, { slug: 'humans' })
      const session = orchestrator()

      const reader = projectFeatureReader(ctx, session, 'readable')
      expect(featureContext(ctx, reader).feature.slug).toBe('readable')
      const project = projectForFeature(ctx, f)
      await ensureTalkWorktree(project, f)
      const briefPath = featureDocPath(project, f, 'brief.md')
      mkdirSync(dirname(briefPath), { recursive: true })
      writeFileSync(briefPath, '# Readable\n')
      expect(toolReadFeatureDoc(ctx, reader, { relPath: 'brief.md' }).content).toBe('# Readable\n')

      expect(projectFeatureReader(ctx, session, 'humans').featureId).toBeTruthy()
      expect(() => projectFeatureReader(ctx, session, 'nope')).toThrow(/no feature in this project/)
    })

    async function readSchemas(
      audience: 'project' | 'chat',
    ): Promise<Record<string, { properties?: Record<string, unknown>; required?: string[] }>> {
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
      const client = new Client({ name: 'orchestrator-reads-test', version: '1' })
      await Promise.all([buildMcpServer(audience).connect(serverTransport), client.connect(clientTransport)])
      const tools = (await client.listTools()).tools
      await client.close()
      return Object.fromEntries(
        tools
          .filter((t) => ['get_feature_context', 'read_feature_doc'].includes(t.name))
          .map((t) => [t.name, t.inputSchema as { properties?: Record<string, unknown>; required?: string[] }]),
      )
    }

    it('take a required slug from an orchestrator, and none from a feature session', async () => {
      const project = await readSchemas('project')
      const chat = await readSchemas('chat')
      for (const name of ['get_feature_context', 'read_feature_doc']) {
        expect(project[name]?.required, name).toContain('slug')
        expect(Object.keys(chat[name]?.properties ?? {}), name).not.toContain('slug')
      }
      expect(Object.keys(chat.get_feature_context?.properties ?? {})).toEqual(['full'])
      expect(chat.read_feature_doc?.required).toEqual(['relPath'])
    })
  })
})
