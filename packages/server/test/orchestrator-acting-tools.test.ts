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
  markSessionEnded,
  markSessionLive,
} from '../src/launcher/sessions'
import {
  toolAddToBrief,
  toolDrive,
  toolMergeFeature,
  toolPlanFeature,
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
import { deliverToLead } from '../src/services/lead-delivery'
import { leadMessageKey, takeOrchestratorLines } from '../src/services/orchestrator-messages'
import {
  __resetTestDriveState,
  activeTestDriveFeatureId,
  createFeatureBranch,
  ensureTalkWorktree,
} from '../src/services/git'
import { openProject } from '../src/services/projects'
import { getFeatureRow, projectForFeature } from '../src/services/repo'
import { storeTickets } from '../src/services/tickets'
import { workflowRegistry } from '../src/workflows/registry'
import { withTempDataDir } from './helpers/data-dir'
import { makeTestCtx } from './helpers/db'
import { rmTemp, seedFeature, tmpRepo } from './helpers/fixtures'

/**
 * The orchestrator's acting tools (`whole-cuts-plan-themselves` decisions 4, 6,
 * 8, 16; `one-orchestrator-no-mode` decision 2): each reaches the service under
 * the human's button on any feature of the project, passes that service's own
 * refusals through, and refuses through the one shared gate.
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

  /** A live project session — the orchestrator. */
  function orchestrator(): SessionRow {
    const row = createSessionRow(ctx, { projectId, kind: 'project', worktreePath: repoPath })
    markSessionLive(ctx, row.id, { ccSessionId: `cc-${row.id}` })
    return getSessionRow(ctx, row.id) as SessionRow
  }

  /** A started feature with its branch cut — one the orchestrator did not create. */
  async function started(slug: string, overrides: Partial<Feature> = {}): Promise<Feature> {
    const f = seedFeature(ctx, projectId, { slug, ...overrides })
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
      drive: (c, s, slug) => toolDrive(c, s, { slug, action: 'start' }),
      merge_feature: (c, s, slug) => toolMergeFeature(c, s, { slug }),
      add_to_brief: (c, s, slug) => toolAddToBrief(c, s, { slug, text: 'x' }),
    }

    for (const [name, call] of Object.entries(calls)) {
      it(`${name} refuses a session that is not a project session, and an ended one`, async () => {
        const f = seedFeature(ctx, projectId, { slug: 'humans' })
        const chat = createSessionRow(ctx, { featureId: f.id, kind: 'chat', worktreePath: repoPath })
        expect(await refusal(() => call(ctx, chat, 'humans'))).toMatch(/only the orchestrator/)

        const session = orchestrator()
        markSessionEnded(ctx, session.id)
        const ended = getSessionRow(ctx, session.id) as SessionRow
        expect(await refusal(() => call(ctx, ended, 'humans'))).toMatch(/has ended/)
      })
    }

    it('drive without a slug refuses through the session gate', async () => {
      const f = seedFeature(ctx, projectId, { slug: 'humans' })
      const chat = createSessionRow(ctx, { featureId: f.id, kind: 'chat', worktreePath: repoPath })
      expect(await refusal(() => toolDrive(ctx, chat, { action: 'start' }))).toMatch(
        /only the orchestrator/,
      )
    })
  })

  it('start_feature starts a draft it did not create, and passes Start’s refusal through', async () => {
    const session = orchestrator()
    const draft = seedFeature(ctx, projectId, { slug: 'parked', status: 'draft' })
    cleanup.push(worktreeDir(projectId, 'parked'))

    const out = await toolStartFeature(ctx, session, { slug: 'parked', baseBranch: 'main' })
    expect(out).toEqual({ slug: 'parked', status: 'active', baseBranch: 'main' })
    expect(getFeatureRow(ctx, draft.id).status).toBe('active')
    const started = listAfter(ctx, draft.id).find((e) => e.type === 'feature.started')
    expect(started?.data).toMatchObject({ actor: 'orchestrator' })

    expect(await refusal(() => toolStartFeature(ctx, session, { slug: 'parked' }))).toMatch(
      /not in the backlog/,
    )
  })

  it('plan_feature launches a headless self-planning run, and stop_feature_run ends it', async () => {
    const session = orchestrator()
    const f = await started('planner')

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
    await started('built', { status: 'shipped' })
    expect(
      await refusal(() => toolPlanFeature(ctx, session, { slug: 'built' }, { spawn: false })),
    ).toMatch(/is shipped/)
  })

  it('a lead message while it plans itself, then stop_feature_run: the woken lead is never ended', async () => {
    const session = orchestrator()
    const f = await started('mid-plan')
    const { sessionId } = await toolPlanFeature(ctx, session, { slug: 'mid-plan' }, { spawn: false })
    cleanup.push(sessionDir(sessionId))
    markSessionLive(ctx, sessionId, { ccSessionId: 'cc-plan' })

    await deliverToLead(ctx, getFeatureRow(ctx, f.id), { text: 'Go given', source: 'runcastle' })
    expect(getSessionRow(ctx, sessionId)?.status).toBe('live')
    const types = listAfter(ctx, f.id, 0).map((e) => e.type)
    expect(types).toContain('lead.message_pending')
    expect(types).not.toContain('session.ended')

    // The plan ran out; runcastle woke the lead headless with Go.
    toolStopFeatureRun(ctx, session, { slug: 'mid-plan' })
    const wake = createSessionRow(ctx, {
      featureId: f.id,
      kind: 'chat',
      purpose: 'lead-wake',
      worktreePath: repoPath,
      headless: true,
    })
    markSessionLive(ctx, wake.id, { ccSessionId: 'cc-plan' })
    expect(await refusal(() => toolStopFeatureRun(ctx, session, { slug: 'mid-plan' }))).toMatch(
      /no headless run going/,
    )
    expect(getSessionRow(ctx, wake.id)?.status).toBe('live')
    takeOrchestratorLines(leadMessageKey(f.id))
  })

  it('stop_feature_run leaves a human’s interactive session alone', async () => {
    const session = orchestrator()
    const f = await started('chatting')
    const chat = createSessionRow(ctx, { featureId: f.id, kind: 'chat', worktreePath: repoPath })
    markSessionLive(ctx, chat.id, { ccSessionId: 'cc-chat' })
    expect(await refusal(() => toolStopFeatureRun(ctx, session, { slug: 'chatting' }))).toMatch(
      /no headless run going/,
    )
    expect(getSessionRow(ctx, chat.id)?.status).toBe('live')
  })

  it('drive starts and stops a feature drive, and the project drive is refused while it holds the slot', async () => {
    const session = orchestrator()
    const f = await started('drivable')

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
    expect(await g.raw(['show', 'main:docs/features/landing/outcome.md'])).toContain('# Outcome')
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

  it('add_to_brief appends a dated section to brief.md and commits it as a runcastle docs commit', async () => {
    const session = orchestrator()
    const f = await started('briefed')
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
    it('name any feature of the project by slug', async () => {
      const f = await started('readable')
      seedFeature(ctx, projectId, { slug: 'humans' })
      const session = orchestrator()
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
