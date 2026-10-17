import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Feature, SessionRow, WorkflowDef } from '@runcastle/core'
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
  activeSessionsForFeature,
  createSessionRow,
  getSessionRow,
  markSessionLive,
} from '../src/launcher/sessions'
import {
  toolAddToBrief,
  toolBurnFeature,
  toolDrive,
  toolMergeFeature,
  toolPlanFeature,
  toolRecordTestNote,
  toolStartFeature,
  toolStopFeatureRun,
} from '../src/mcp/orchestrator-tools'
import {
  buildMcpServer,
  featureContext,
  projectFeatureReader,
  toolGetTicket,
  toolListTickets,
  toolReadFeatureDoc,
} from '../src/mcp/server'
import { listAfter } from '../src/services/events'
import { featureDocPath } from '../src/services/feature-docs'
import {
  __resetTestDriveState,
  activeTestDriveFeatureId,
  createFeatureBranch,
  ensureTalkWorktree,
} from '../src/services/git'
import { openProject } from '../src/services/projects'
import { getFeatureRow, projectForFeature } from '../src/services/repo'
import { updateSettings } from '../src/services/settings'
import { listByFeature as listNotesByFeature } from '../src/services/test-notes'
import { storeTickets } from '../src/services/tickets'
import { workflowRegistry } from '../src/workflows/registry'
import { withTempDataDir } from './helpers/data-dir'
import { makeTestCtx } from './helpers/db'
import { rmTemp, seedFeature, tmpRepo } from './helpers/fixtures'

/**
 * The orchestrator's acting tools (`whole-cuts-plan-themselves` decisions 4, 6,
 * 8, 16): each reaches the service under the human's button, passes that
 * service's own refusals through, and refuses through the one shared gate.
 */

const stubBurner: WorkflowDef = {
  id: 'ticket-burner',
  async run() {
    return { status: 'succeeded', summary: 'stub' }
  },
}

function ticketInput(title: string, kind?: 'review') {
  return {
    title,
    goal: 'g',
    context: 'c',
    acceptanceCriteria: ['a'],
    seams: ['s'],
    blockedBy: [],
    ...(kind ? { kind } : {}),
  }
}

describe('the orchestrator’s acting tools', () => {
  let ctx: AppCtx
  let repoPath: string
  let g: SimpleGit
  let projectId: string
  let restoreDataDir: () => void
  let originalBurner: WorkflowDef | undefined
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
    originalBurner = workflowRegistry.get('ticket-burner')
    workflowRegistry.set('ticket-burner', stubBurner)
  })

  afterEach(() => {
    __resetTestDriveState()
    if (originalBurner) workflowRegistry.set('ticket-burner', originalBurner)
    else workflowRegistry.delete('ticket-burner')
    clearRuntimeCtx()
    for (const d of cleanup.splice(0)) rmSync(d, { recursive: true, force: true })
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

  /** An owned, started feature with its branch cut. */
  async function owned(slug: string, overrides: Partial<Feature> = {}): Promise<Feature> {
    const f = seedFeature(ctx, projectId, { slug, orchestrated: true, ...overrides })
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
      start_feature: (c, s, slug) => toolStartFeature(c, s, { slug }),
      plan_feature: (c, s, slug) => toolPlanFeature(c, s, { slug }, { spawn: false }),
      stop_feature_run: (c, s, slug) => toolStopFeatureRun(c, s, { slug }),
      burn_feature: (c, s, slug) => toolBurnFeature(c, s, { slug }),
      drive: (c, s, slug) => toolDrive(c, s, { slug, action: 'start' }),
      record_test_note: (c, s, slug) =>
        toolRecordTestNote(c, s, { slug, text: 'x', observedBy: 'orchestrator' }),
      merge_feature: (c, s, slug) => toolMergeFeature(c, s, { slug }),
      add_to_brief: (c, s, slug) => toolAddToBrief(c, s, { slug, text: 'x' }),
    }

    for (const [name, call] of Object.entries(calls)) {
      it(`${name} refuses a non-orchestrate session, the mode off, and a feature not owned`, async () => {
        seedFeature(ctx, projectId, { slug: 'mine', orchestrated: true })
        seedFeature(ctx, projectId, { slug: 'humans' })
        updateSettings(ctx, { projectId, key: 'orchestrator', value: true })
        expect(await refusal(() => call(ctx, projectSession(), 'mine'))).toMatch(/only the orchestrator/)

        const session = orchestrator()
        expect(await refusal(() => call(ctx, session, 'humans'))).toMatch(/the human's feature/)

        updateSettings(ctx, { projectId, key: 'orchestrator', value: false })
        expect(await refusal(() => call(ctx, session, 'mine'))).toMatch(/setting is off/)
      })
    }

    it('drive without a slug refuses through the session gate', async () => {
      updateSettings(ctx, { projectId, key: 'orchestrator', value: true })
      expect(await refusal(() => toolDrive(ctx, projectSession(), { action: 'start' }))).toMatch(
        /only the orchestrator/,
      )
    })
  })

  it('start_feature starts an owned draft, and passes Start’s refusal through', async () => {
    const session = orchestrator()
    const draft = seedFeature(ctx, projectId, { slug: 'parked', status: 'draft', orchestrated: true })
    cleanup.push(worktreeDir(projectId, 'parked'))

    const out = await toolStartFeature(ctx, session, { slug: 'parked', baseBranch: 'main' })
    expect(out).toEqual({ slug: 'parked', status: 'active', baseBranch: 'main' })
    expect(getFeatureRow(ctx, draft.id).status).toBe('active')
    const started = listAfter(ctx, draft.id).find((e) => e.type === 'feature.started')
    expect(started?.data).toMatchObject({ actor: 'orchestrator' })

    expect(await refusal(() => toolStartFeature(ctx, session, { slug: 'parked' }))).toMatch(
      /not a draft/,
    )
  })

  it('plan_feature launches a headless self-planning run, and stop_feature_run ends it', async () => {
    const session = orchestrator()
    const f = await owned('planner')

    const { sessionId } = await toolPlanFeature(ctx, session, { slug: 'planner' }, { spawn: false })
    cleanup.push(sessionDir(sessionId))
    const run = getSessionRow(ctx, sessionId)
    expect(run).toMatchObject({ featureId: f.id, kind: 'chat', purpose: 'self-plan' })

    expect(toolStopFeatureRun(ctx, session, { slug: 'planner' })).toMatchObject({ sessionId, ok: true })
    expect(activeSessionsForFeature(ctx, f.id)).toEqual([])
    expect(await refusal(() => toolStopFeatureRun(ctx, session, { slug: 'planner' }))).toMatch(
      /no headless run going/,
    )
  })

  it('plan_feature passes the self-plan launch’s own refusal through', async () => {
    const session = orchestrator()
    await owned('built', { phase: 'building' })
    expect(
      await refusal(() => toolPlanFeature(ctx, session, { slug: 'built' }, { spawn: false })),
    ).toMatch(/past planning/)
  })

  it('stop_feature_run leaves a human’s interactive session alone', async () => {
    const session = orchestrator()
    const f = await owned('chatting')
    const chat = createSessionRow(ctx, { featureId: f.id, kind: 'chat', worktreePath: repoPath })
    markSessionLive(ctx, chat.id, { ccSessionId: 'cc-chat' })
    expect(await refusal(() => toolStopFeatureRun(ctx, session, { slug: 'chatting' }))).toMatch(
      /no headless run going/,
    )
    expect(getSessionRow(ctx, chat.id)?.status).toBe('live')
  })

  it('burn_feature burns an owned feature, and passes burn’s refusals through', async () => {
    const session = orchestrator()
    const f = await owned('burnable', { phase: 'building' })
    storeTickets(ctx, f.id, [ticketInput('Do the work'), ticketInput('Review it', 'review')])
    const { runId } = await toolBurnFeature(ctx, session, { slug: 'burnable' })
    expect(runId).toMatch(/^run/)

    seedFeature(ctx, projectId, { slug: 'drafty', status: 'draft', orchestrated: true })
    expect(await refusal(() => toolBurnFeature(ctx, session, { slug: 'drafty' }))).toMatch(/is a draft/)
  })

  it('drive starts and stops a feature drive, and the project drive is refused while it holds the slot', async () => {
    const session = orchestrator()
    const f = await owned('drivable')

    expect((await toolDrive(ctx, session, { slug: 'drivable', action: 'start' })).ok).toBe(true)
    expect(activeTestDriveFeatureId(projectId)).toBe(f.id)
    expect(await toolDrive(ctx, session, { action: 'start' })).toMatchObject({
      ok: false,
      deniedReason: 'A test drive of feature/drivable is running — stop it first',
    })
    expect((await toolDrive(ctx, session, { slug: 'drivable', action: 'stop' })).ok).toBe(true)
    expect(activeTestDriveFeatureId(projectId)).toBeUndefined()

    expect((await toolDrive(ctx, session, { action: 'start' })).ok).toBe(true)
    expect((await toolDrive(ctx, session, { action: 'stop' })).ok).toBe(true)
  })

  it('record_test_note files the note as the human’s or the agent’s, as asked', async () => {
    const session = orchestrator()
    const f = await owned('noted')
    toolRecordTestNote(ctx, session, { slug: 'noted', text: 'The button is grey.', observedBy: 'human' })
    toolRecordTestNote(ctx, session, {
      slug: 'noted',
      text: 'The list never loads.',
      observedBy: 'orchestrator',
    })
    expect(listNotesByFeature(ctx, f.id).map((n) => [n.text, n.author])).toEqual([
      ['The button is grey.', 'human'],
      ['The list never loads.', 'agent'],
    ])
    const added = listAfter(ctx, f.id).filter((e) => e.type === 'note.added')
    expect(added.map((e) => e.data?.actor)).toEqual(['orchestrator', 'orchestrator'])
  })

  it('merge_feature ships a clean feature with its outcome doc', async () => {
    const session = orchestrator()
    const f = await owned('landing', { phase: 'review' })
    await g.checkout('feature/landing')
    writeFileSync(join(repoPath, 'landing.txt'), 'work\n')
    await g.add(['landing.txt'])
    await g.commit('feat: work')
    await g.checkout('main')

    const res = await toolMergeFeature(ctx, session, { slug: 'landing' })
    expect(res).toMatchObject({ ok: true, base: 'main', files: [] })
    expect(getFeatureRow(ctx, f.id)).toMatchObject({ phase: 'shipped', status: 'shipped' })
    expect(await g.raw(['show', 'main:docs/features/landing/outcome.md'])).toContain('# Outcome')
  })

  it('merge_feature returns a conflict’s files and records merge.conflict', async () => {
    const session = orchestrator()
    const f = await owned('clash', { phase: 'review' })
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

  it('add_to_brief appends a dated section to brief.md and commits it as a runcastle docs commit', async () => {
    const session = orchestrator()
    const f = await owned('briefed')
    const project = projectForFeature(ctx, f)
    const worktree = await ensureTalkWorktree(project, f)
    const briefPath = featureDocPath(project, f, 'brief.md')
    expect(briefPath.startsWith(worktree)).toBe(true)

    await toolAddToBrief(ctx, session, { slug: 'briefed', text: 'The human wants it dark too.' })

    const date = new Date().toISOString().slice(0, 10)
    expect(readFileSync(briefPath, 'utf8')).toBe(
      `## Added by the orchestrator, ${date}\n\nThe human wants it dark too.\n`,
    )
    const wt = simpleGit(worktree)
    expect((await wt.raw(['log', '-1', '--pretty=%s', 'feature/briefed'])).trim()).toBe(
      'runcastle: add to briefed brief',
    )
    expect(await wt.raw(['status', '--porcelain'])).toBe('')
    expect(listAfter(ctx, f.id).find((e) => e.type === 'brief.added')?.data).toMatchObject({
      actor: 'orchestrator',
    })

    await toolAddToBrief(ctx, session, { slug: 'briefed', text: 'And keyboard first.' })
    expect(readFileSync(briefPath, 'utf8')).toContain(
      `dark too.\n\n## Added by the orchestrator, ${date}\n\nAnd keyboard first.\n`,
    )
    expect(existsSync(join(repoPath, 'docs'))).toBe(false)
  })

  it('add_to_brief appends to a draft’s parked brief, and Start lands it in brief.md', async () => {
    const session = orchestrator()
    const draft = seedFeature(ctx, projectId, {
      slug: 'waiting',
      status: 'draft',
      orchestrated: true,
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

    await toolStartFeature(ctx, session, { slug: 'waiting', baseBranch: 'main' })
    expect(await g.raw(['show', 'feature/waiting:docs/features/waiting/brief.md'])).toContain(
      expected,
    )
  })

  describe('feature reads from the project session', () => {
    it('name any feature of the project by slug, owned or not, with the mode off', async () => {
      const f = await owned('readable')
      seedFeature(ctx, projectId, { slug: 'humans' })
      const session = projectSession()
      const [ticket] = storeTickets(ctx, f.id, [ticketInput('Read me')])

      const reader = projectFeatureReader(ctx, session, 'readable')
      expect(featureContext(ctx, reader).feature.slug).toBe('readable')
      expect(toolListTickets(ctx, reader, {}).tickets.map((t) => t.title)).toEqual(['Read me'])
      expect(toolGetTicket(ctx, reader, { seq: ticket.seq }).title).toBe('Read me')
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
          .filter((t) => ['get_feature_context', 'read_feature_doc', 'list_tickets', 'get_ticket'].includes(t.name))
          .map((t) => [t.name, t.inputSchema as { properties?: Record<string, unknown>; required?: string[] }]),
      )
    }

    it('take a required slug from a project session, and none from a feature session', async () => {
      const project = await readSchemas('project')
      const chat = await readSchemas('chat')
      for (const name of ['get_feature_context', 'read_feature_doc', 'list_tickets', 'get_ticket']) {
        expect(project[name]?.required, name).toContain('slug')
        expect(Object.keys(chat[name]?.properties ?? {}), name).not.toContain('slug')
      }
      expect(Object.keys(chat.get_feature_context?.properties ?? {})).toEqual([])
      expect(chat.read_feature_doc?.required).toEqual(['relPath'])
      expect(chat.get_ticket?.required).toEqual(['seq'])
    })
  })
})
