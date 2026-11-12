import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { type Feature, foldThread, type Project, type SessionRow } from '@runcastle/core'
import { eq } from 'drizzle-orm'
import { simpleGit, type SimpleGit } from 'simple-git'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sessions } from '../src/db/schema'
import type { AppCtx } from '../src/db/types'
import { createSessionRow, getSessionRow, markSessionLive } from '../src/launcher/sessions'
import { toolMergeFeature } from '../src/mcp/orchestrator-tools'
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
 * `the-epic-hears-when-its-features-merge`: a merge, by the Merge button or by
 * `merge_feature`, says one line into the merged feature's epic, woken while
 * another of the epic's features is in progress (up-next drafts the merge
 * starts included), held otherwise, with a "Merged" news row either way.
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
  async function mergeable(slug: string, overrides: Partial<Feature> = {}): Promise<Feature> {
    await createFeatureBranch(project, slug, 'main')
    await g.checkout(`feature/${slug}`)
    writeFileSync(join(repoPath, `${slug}.txt`), `${slug}\n`)
    await g.add([`${slug}.txt`])
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

  it('wakes the epic while another of its features is in progress', async () => {
    const epic = chat()
    const merged = await mergeable('export-csv', { chatId: epic.id, title: 'Export CSV' })
    seedFeature(ctx, project.id, { slug: 'import-csv', title: 'Import CSV', chatId: epic.id })

    expect((await caller.feature.merge({ featureId: merged.id })).ok).toBe(true)

    const prompt = await onePrompt(epic.id)
    const sha = (await g.revparse(['main^'])).trim()
    expect(prompt.held).toBeUndefined()
    expect(prompt.text).toBe(
      [
        '[runcastle] export-csv merged into main by the human.',
        'In progress in this epic:',
        '- import-csv: Import CSV (owned by the human)',
        `Read the change: the merge commit ${sha.slice(0, 12)} and docs/features/export-csv/outcome.md.`,
      ].join('\n'),
    )
    expect(prompt.display).toEqual({
      news: [{ featureId: merged.id, title: 'Export CSV', events: [{ tone: 'done', words: 'Merged by you' }] }],
    })
    await vi.waitFor(() => expect(host.isRunning(epic.id)).toBe(true))
  })

  it('holds the line, with its news row, when nothing of the epic is in progress', async () => {
    const epic = chat()
    const merged = await mergeable('export-csv', { chatId: epic.id, title: 'Export CSV' })
    seedFeature(ctx, project.id, { slug: 'later', chatId: epic.id, status: 'draft' })
    seedFeature(ctx, project.id, { slug: 'done', chatId: epic.id, status: 'shipped' })

    await caller.feature.merge({ featureId: merged.id })

    const prompt = await onePrompt(epic.id)
    expect(prompt.text).toBe(
      '[runcastle] export-csv merged into main by the human. Nothing of this epic is in progress, so there is nothing to check.',
    )
    expect(prompt.held).toBe(true)
    // The held prompt keeps its news row in the log, as a woken one does, and the chat folds it.
    const news = { news: [{ featureId: merged.id, title: 'Export CSV', events: [{ tone: 'done', words: 'Merged by you' }] }] }
    expect(prompt.display).toEqual(news)
    const item = foldThread(readThreadEvents(epic.id)).items.find((i) => i.kind === 'user')
    expect(item).toMatchObject({ kind: 'user', held: true, from: 'runcastle', display: news })
    expect(host.isRunning(epic.id)).toBe(false)
  })

  it('counts an up-next draft this merge started as in progress', async () => {
    const epic = chat()
    const merged = await mergeable('core', { chatId: epic.id })
    const waiting = seedFeature(ctx, project.id, { slug: 'ui', title: 'UI', chatId: epic.id, status: 'draft', baseBranch: null })
    setDependencies(ctx, waiting.id, [merged.id])
    setUpNext(ctx, waiting.id, true)

    await caller.feature.merge({ featureId: merged.id })

    expect(getFeatureRow(ctx, waiting.id).status).toBe('active')
    const prompt = await onePrompt(epic.id)
    expect(prompt.held).toBeUndefined()
    expect(prompt.text).toContain('\n- ui: UI (owned by the human)\n')
  })

  it('holds the line when the epic merged the feature itself, saying so', async () => {
    const epic = chat()
    const merged = await mergeable('export-csv', { chatId: epic.id, heldBy: epic.id })
    seedFeature(ctx, project.id, { slug: 'import-csv', title: 'Import CSV', chatId: epic.id, heldBy: epic.id })

    const res = await toolMergeFeature(ctx, epic, { slug: 'export-csv' })
    expect(res).toMatchObject({ ok: true, inProgress: [{ slug: 'import-csv', title: 'Import CSV', owner: 'this chat' }] })

    const prompt = await onePrompt(epic.id)
    expect(prompt.held).toBe(true)
    expect(prompt.text).toMatch(/^\[runcastle\] export-csv merged into main by this chat\.\n/)
    expect(prompt.text).toContain('- import-csv: Import CSV (owned by this chat)')
  })

  it('wakes the epic when another chat merged it, naming that chat', async () => {
    const epic = chat()
    const other = chat()
    await mergeable('export-csv', { chatId: epic.id, heldBy: other.id })
    seedFeature(ctx, project.id, { slug: 'import-csv', chatId: epic.id })

    await toolMergeFeature(ctx, other, { slug: 'export-csv' })

    const prompt = await onePrompt(epic.id)
    expect(prompt.held).toBeUndefined()
    expect(prompt.text).toMatch(/^\[runcastle\] export-csv merged into main by the chat "[^"]+"\.\n/)
    expect(prompt.display?.news?.[0]?.events[0]?.words).toMatch(/^Merged by (?!you$)/)
    expect(promptsOf(other.id)).toEqual([])
  })

  it('sends nothing for a feature with no epic, even to its holder', async () => {
    const holder = chat()
    const merged = await mergeable('loner', { heldBy: holder.id })
    seedFeature(ctx, project.id, { slug: 'sibling', heldBy: holder.id })

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

  it('keeps every other line with the holder: a draft the merge started is told to whoever holds it', async () => {
    const epic = chat()
    const holder = chat()
    const merged = await mergeable('core', { chatId: epic.id })
    const waiting = seedFeature(ctx, project.id, { slug: 'ui', status: 'draft', baseBranch: null, chatId: epic.id, heldBy: holder.id })
    setDependencies(ctx, waiting.id, [merged.id])
    setUpNext(ctx, waiting.id, true)

    await caller.feature.merge({ featureId: merged.id })

    const told = await onePrompt(holder.id)
    expect(told.text).toMatch(/^\[runcastle\] ui started by itself because core shipped\./)
    const epicPrompt = await onePrompt(epic.id)
    expect(epicPrompt.text).toMatch(/^\[runcastle\] core merged into main by the human\.\n/)
    expect(epicPrompt.text).not.toContain('started by itself')
  })
})
