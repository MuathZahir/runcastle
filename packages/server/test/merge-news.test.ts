import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { type Feature, foldThread, type Project, type SessionRow } from '@runcastle/core'
import { eq } from 'drizzle-orm'
import { simpleGit, type SimpleGit } from 'simple-git'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sessions } from '../src/db/schema'
import type { AppCtx } from '../src/db/types'
import { createSessionRow, getSessionRow, markSessionLive } from '../src/launcher/sessions'
import { toolMergeFeature } from '../src/mcp/orchestrator-tools'
import * as leadStart from '../src/services/lead-start'
import { dismissAsAgent, reportFinding } from '../src/services/review-findings'
import { setDependencies, setUpNext } from '../src/services/dependencies'
import { __resetTestDriveState, createFeatureBranch } from '../src/services/git'
import { ORCHESTRATOR_GATHER_MS, startOrchestratorNotifier } from '../src/services/orchestrator-notify'
import { openProject } from '../src/services/projects'
import { getFeatureRow } from '../src/services/repo'
import { createAgentHost, setAgentHostForTests } from '../src/threads/host'
import { readThreadEvents, type AgentHost } from '../src/threads/types'
import { createCallerFactory } from '../src/trpc/context'
import { appRouter } from '../src/trpc/router'
import { createFakeAcp, FAKE_LAUNCH } from './support/fake-acp-agent'
import { promptsOf } from './support/thread-launch'
import { withTempDataDir } from './helpers/data-dir'
import { makeTestCtx } from './helpers/db'
import { rmTemp, seedFeature, tmpRepo } from './helpers/fixtures'

/**
 * `the-epic-hears-when-its-features-merge`, as `autopilot-retires` decision 2
 * left it: every merge, by the Merge button or by `merge_feature`, wakes the
 * merged feature's epic with one line and a "Merged" news row. The line carries
 * the review summary, the decisions marked "Decided without you", the defects
 * dismissed, and the epic's other features in progress (up-next drafts the
 * merge starts included). A dependent's start reaches the epic only when its
 * lead could not launch.
 */

describe('a merge tells the feature’s epic', () => {
  let ctx: AppCtx
  let repoPath: string
  let g: SimpleGit
  let project: Project
  let restoreDataDir: () => void
  let stopNotifier: () => void
  let host: AgentHost
  let caller: ReturnType<ReturnType<typeof createCallerFactory<typeof appRouter>>>
  let launches: ReturnType<typeof vi.spyOn<typeof leadStart, 'launchLeadByLevel'>>

  beforeEach(async () => {
    restoreDataDir = withTempDataDir()
    __resetTestDriveState()
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
    project = await openProject(ctx, repoPath)
    stopNotifier = startOrchestratorNotifier(ctx)
    host = createAgentHost({ ctx, transport: createFakeAcp().transport, launch: FAKE_LAUNCH })
    // The up-next start launches the dependent's lead; faked, so no conversation starts.
    launches = vi.spyOn(leadStart, 'launchLeadByLevel').mockResolvedValue({ sessionId: 'sess_fake' })
    setAgentHostForTests(host)
    caller = createCallerFactory(appRouter)(ctx)
  })

  afterEach(async () => {
    await host.stopAll('shutdown')
    setAgentHostForTests(undefined)
    stopNotifier()
    vi.restoreAllMocks()
    __resetTestDriveState()
    restoreDataDir()
    rmTemp(repoPath)
  })

  /** A live orchestrator chat. */
  function chat(): SessionRow {
    const row = createSessionRow(ctx, { projectId: project.id, kind: 'project', worktreePath: repoPath })
    markSessionLive(ctx, row.id, { ccSessionId: `cc-${row.id}` })
    return getSessionRow(ctx, row.id) as SessionRow
  }

  /** A started feature with a branch holding one commit, ready to merge. */
  async function mergeable(slug: string, overrides: Partial<Feature> = {}, decisions?: string): Promise<Feature> {
    await createFeatureBranch(project, slug, 'main')
    await g.checkout(`feature/${slug}`)
    writeFileSync(join(repoPath, `${slug}.txt`), `${slug}\n`)
    await g.add([`${slug}.txt`])
    if (decisions) {
      mkdirSync(join(repoPath, 'docs', 'features', slug), { recursive: true })
      writeFileSync(join(repoPath, 'docs', 'features', slug, 'decisions.md'), decisions)
      await g.add([`docs/features/${slug}/decisions.md`])
    }
    await g.commit(`feat: ${slug}`)
    await g.checkout('main')
    return seedFeature(ctx, project.id, { slug, phase: 'review', ...overrides })
  }

  const settle = () => new Promise((r) => setTimeout(r, ORCHESTRATOR_GATHER_MS + 100))

  /** The one prompt the thread was told, once it arrives. */
  async function onePrompt(threadId: string) {
    await vi.waitFor(() => expect(promptsOf(threadId)).toHaveLength(1))
    await settle()
    expect(promptsOf(threadId)).toHaveLength(1)
    const prompt = promptsOf(threadId)[0]!
    expect(prompt.source).toBe('runcastle')
    return prompt
  }

  it('wakes the epic while another of its features is in progress, with the review summary', async () => {
    const epic = chat()
    const merged = await mergeable('export-csv', { chatId: epic.id, title: 'Export CSV' })
    seedFeature(ctx, project.id, { slug: 'import-csv', title: 'Import CSV', chatId: epic.id })

    expect((await caller.feature.merge({ featureId: merged.id })).ok).toBe(true)

    const prompt = await onePrompt(epic.id)
    const sha = (await g.revparse(['main^'])).trim()
    expect(prompt.held).toBeUndefined()
    const lines = prompt.text.split('\n')
    expect(lines[0]).toBe('[runcastle] export-csv merged into main by the human.')
    expect(lines[1]).toBe('Review summary:')
    expect(prompt.text).not.toContain('## Review summary')
    expect(prompt.text).toContain('- No review ran')
    expect(prompt.text).toContain('\nIn progress in this epic:\n- import-csv: Import CSV\n')
    expect(lines.at(-1)).toBe(`Read the change: the merge commit ${sha.slice(0, 12)}.`)
    expect(prompt.display).toEqual({
      news: [{ featureId: merged.id, title: 'Export CSV', events: [{ tone: 'done', words: 'Merged by you' }] }],
    })
    await vi.waitFor(() => expect(host.isRunning(epic.id)).toBe(true))
  })

  it('wakes the epic even when nothing of it is in progress, keeping its news row', async () => {
    const epic = chat()
    const merged = await mergeable('export-csv', { chatId: epic.id, title: 'Export CSV' })
    seedFeature(ctx, project.id, { slug: 'later', chatId: epic.id, status: 'draft' })
    seedFeature(ctx, project.id, { slug: 'done', chatId: epic.id, status: 'shipped' })

    await caller.feature.merge({ featureId: merged.id })

    const prompt = await onePrompt(epic.id)
    expect(prompt.text).toMatch(/^\[runcastle\] export-csv merged into main by the human\.\n/)
    expect(prompt.text).toMatch(/\nNothing of this epic is in progress, so there is nothing to check\.$/)
    expect(prompt.held).toBeUndefined()
    const news = { news: [{ featureId: merged.id, title: 'Export CSV', events: [{ tone: 'done', words: 'Merged by you' }] }] }
    expect(prompt.display).toEqual(news)
    const item = foldThread(readThreadEvents(epic.id)).items.find((i) => i.kind === 'user')
    expect(item).toMatchObject({ kind: 'user', from: 'runcastle', display: news })
    await vi.waitFor(() => expect(host.isRunning(epic.id)).toBe(true))
  })

  it('carries the decisions made without the human and the defects dismissed', async () => {
    const epic = chat()
    const decisions = [
      '# Decisions',
      '',
      '## 1. Commas, not semicolons',
      '**Decision:** comma-separated.',
      '',
      '## 2. Dates in ISO',
      '**Decision:** ISO 8601.',
      '**Decided without you.**',
      '',
    ].join('\n')
    const merged = await mergeable('export-csv', { chatId: epic.id, title: 'Export CSV' }, decisions)
    const { finding } = reportFinding(ctx, {
      featureId: merged.id,
      lead: true,
      input: { kind: 'defect', severity: 'low', title: 'Header row repeats', location: 'export.ts:12', citation: 'spec', detail: 'd', reproStep: 'export twice' },
    })
    dismissAsAgent(ctx, merged.id, finding.id, 'only on a second export, out of scope')

    await caller.feature.merge({ featureId: merged.id })

    const prompt = await onePrompt(epic.id)
    expect(prompt.text).toContain('\nDecided without the human:\n- 2. Dates in ISO\n')
    expect(prompt.text).not.toContain('Commas, not semicolons')
    expect(prompt.text).toContain('\nDefects dismissed, not fixed:\n- Header row repeats (low, export.ts:12): only on a second export, out of scope\n')
  })

  it('counts an up-next draft this merge started as in progress, and launches its lead by its level', async () => {
    const epic = chat()
    const merged = await mergeable('core', { chatId: epic.id })
    const waiting = seedFeature(ctx, project.id, { slug: 'ui', title: 'UI', chatId: epic.id, status: 'draft', baseBranch: null, involvement: 'resultOnly' })
    setDependencies(ctx, waiting.id, [merged.id])
    setUpNext(ctx, waiting.id, true)

    await caller.feature.merge({ featureId: merged.id })

    expect(getFeatureRow(ctx, waiting.id).status).toBe('active')
    expect(launches).toHaveBeenCalledTimes(1)
    expect(launches.mock.calls[0]![1]).toMatchObject({ id: waiting.id, involvement: 'resultOnly' })
    const prompt = await onePrompt(epic.id)
    expect(prompt.held).toBeUndefined()
    expect(prompt.text).toContain('\n- ui: UI\n')
    expect(prompt.text).not.toContain('started by itself')
  })

  it('wakes the epic when it merged the feature itself', async () => {
    const epic = chat()
    const merged = await mergeable('export-csv', { chatId: epic.id })
    seedFeature(ctx, project.id, { slug: 'import-csv', title: 'Import CSV', chatId: epic.id })

    const res = await toolMergeFeature(ctx, epic, { slug: 'export-csv' })
    expect(res).toMatchObject({ ok: true, inProgress: [{ slug: 'import-csv', title: 'Import CSV' }] })

    const prompt = await onePrompt(epic.id)
    expect(prompt.held).toBeUndefined()
    expect(prompt.text).toMatch(/^\[runcastle\] export-csv merged into main by this chat\.\n/)
    expect(prompt.text).toContain('- import-csv: Import CSV')
  })

  it('sends nothing for a feature with no epic, even to its holder', async () => {
    const holder = chat()
    const merged = await mergeable('loner', {})
    seedFeature(ctx, project.id, { slug: 'sibling' })

    await caller.feature.merge({ featureId: merged.id })

    await settle()
    expect(promptsOf(holder.id)).toEqual([])
  })

  it('sends nothing when the epic’s chat no longer exists', async () => {
    const epic = chat()
    const merged = await mergeable('orphan', { chatId: epic.id })
    seedFeature(ctx, project.id, { slug: 'sibling', chatId: epic.id })
    ctx.db.delete(sessions).where(eq(sessions.id, epic.id)).run()

    expect((await caller.feature.merge({ featureId: merged.id })).ok).toBe(true)
    await settle()
    expect(promptsOf(epic.id)).toEqual([])
  })

  it('tells a dependent’s epic only when its lead could not launch', async () => {
    const epic = chat()
    const other = chat()
    const merged = await mergeable('core', { chatId: epic.id })
    const waiting = seedFeature(ctx, project.id, { slug: 'ui', status: 'draft', baseBranch: null, chatId: other.id })
    setDependencies(ctx, waiting.id, [merged.id])
    setUpNext(ctx, waiting.id, true)
    launches.mockRejectedValueOnce(new Error('no runtime'))

    await caller.feature.merge({ featureId: merged.id })

    expect(getFeatureRow(ctx, waiting.id).status).toBe('active')
    const told = await onePrompt(other.id)
    expect(told.text).toMatch(/^\[runcastle\] ui started by itself, but its lead could not launch: no runtime/)
    const epicPrompt = await onePrompt(epic.id)
    expect(epicPrompt.text).toMatch(/^\[runcastle\] core merged into main by the human\./)
    expect(epicPrompt.text).not.toContain('could not launch')
  })

  it('says nothing to a dependent’s epic when its lead launched', async () => {
    const epic = chat()
    const other = chat()
    const merged = await mergeable('core', { chatId: epic.id })
    const waiting = seedFeature(ctx, project.id, { slug: 'ui', status: 'draft', baseBranch: null, chatId: other.id })
    setDependencies(ctx, waiting.id, [merged.id])
    setUpNext(ctx, waiting.id, true)

    await caller.feature.merge({ featureId: merged.id })

    await onePrompt(epic.id)
    expect(launches).toHaveBeenCalledTimes(1)
    expect(promptsOf(other.id)).toEqual([])
  })
})
