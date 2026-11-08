import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { simpleGit } from 'simple-git'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as z from 'zod'
import type { DiscoverySnapshot, RunStatus, Ticket, TicketInput } from '@runcastle/core'
import { SessionKind, TicketInput as TicketInputSchema } from '@runcastle/core'
import { projects } from '../src/db/schema'
import type { AppCtx } from '../src/db/types'
import { InvalidInputError, NotFoundError } from '../src/errors'
import { clearRuntimeCtx, setRuntimeCtx } from '../src/launcher/runtime'
import { createSessionRow, markSessionLive } from '../src/launcher/sessions'
import mcpApp, {
  buildMcpServer,
  featureContext,
  featureContextWithGit,
  featureScenarios,
  resolveSession,
  toolGetFeatureContext,
  toolReadFeatureDoc,
  toolRecordEvent,
  toolsForAudience,
} from '../src/mcp/server'
import { emit, listAfter } from '../src/services/events'
import { listDriveScenarios } from '../src/services/git'
import { getFeatureRow, getProjectById } from '../src/services/repo'
import { listFeatureScenarios } from '../src/services/scenarios'
import { reportFinding } from '../src/services/review-findings'
import { writeDiscoverySnapshot } from '../src/services/model-discovery'
import { addNote } from '../src/services/test-notes'
import { getTicket, listByFeature } from '../src/services/tickets'
import { storeTickets, updateTicket } from './helpers/tickets'
import { createCallerFactory } from '../src/trpc/context'
import { appRouter } from '../src/trpc/router'
import { makeTestCtx } from './helpers/db'
import { rmTemp, seedFeature, seedProject, tmpRepo } from './helpers/fixtures'

function ticket(title: string, blockedBy: number[] = []): TicketInput {
  return { title, goal: 'g', context: 'c', acceptanceCriteria: ['a'], seams: ['s'], blockedBy }
}

describe('mcp tools', () => {
  let ctx: AppCtx
  let repoPath: string
  let featureId: string
  let slug: string
  let session: ReturnType<typeof createSessionRow>

  beforeEach(async () => {
    ctx = await makeTestCtx()
    repoPath = tmpRepo()
    const project = seedProject(ctx, repoPath)
    slug = 'dark-mode'
    const feature = seedFeature(ctx, project.id, { slug })
    featureId = feature.id
    session = createSessionRow(ctx, { featureId, kind: 'chat', worktreePath: repoPath })
    markSessionLive(ctx, session.id)
    setRuntimeCtx(ctx)
  })

  afterEach(() => clearRuntimeCtx())

  /**
   * The 2026-09-24 regression: a resumed session stamped `claude-opus-5` from
   * memory while only another model was annotated. The id is curated — on the
   * roster — so the store took it; the session surfaces must not.
   */
  it('get_feature_context offers only the annotated roster entries, empty when none', () => {
    // Nothing annotated: the emitting session is offered no candidates at all,
    // which is what keeps today's behaviour (never assign) the default.
    expect(toolGetFeatureContext(ctx, session).annotatedModels).toEqual([])

    ctx.config = {
      ...ctx.config,
      models: [
        // A curated entry the operator annotated in place…
        { id: 'claude-opus-5', runtime: 'claude-code', note: 'UI/UX taste' },
        // …one of their own, annotated…
        { id: 'my-proxy-model', runtime: 'codex', note: 'cheap bulk edits' },
        // …one they added but never described…
        { id: 'unlabelled-model', runtime: 'codex' },
        // …and one whose note they cleared to whitespace, which is no note at
        // all: a blank cell is how the operator takes a model back off the
        // per-ticket menu.
        { id: 'blanked-model', runtime: 'codex', note: '   ' },
      ],
    }
    expect(toolGetFeatureContext(ctx, session).annotatedModels).toEqual([
      { id: 'claude-opus-5', runtime: 'claude-code', note: 'UI/UX taste' },
      { id: 'my-proxy-model', runtime: 'codex', note: 'cheap bulk edits' },
    ])
  })

  it('offers and accepts an annotated discovered model but hides unannotated discovery', () => {
    const previousDataDir = process.env.RUNCASTLE_DATA_DIR
    const discoveryDir = mkdtempSync(join(tmpdir(), 'runcastle-mcp-discovery-'))
    process.env.RUNCASTLE_DATA_DIR = discoveryDir
    try {
      const snapshot: DiscoverySnapshot = {
        sources: {
          'claude-code': { status: 'never', models: [], newIds: [] },
          codex: {
            status: 'ok',
            models: [
              { id: 'gpt-next', runtime: 'codex' },
              { id: 'gpt-hidden', runtime: 'codex' },
            ],
            newIds: [],
          },
        },
      }
      writeDiscoverySnapshot(snapshot)
      ctx.config = {
        ...ctx.config,
        models: [{ id: 'gpt-next', runtime: 'codex', note: 'provider-discovered refactors' }],
      }

      expect(toolGetFeatureContext(ctx, session).annotatedModels).toEqual([
        { id: 'gpt-next', runtime: 'codex', note: 'provider-discovered refactors' },
      ])
    } finally {
      if (previousDataDir === undefined) delete process.env.RUNCASTLE_DATA_DIR
      else process.env.RUNCASTLE_DATA_DIR = previousDataDir
      rmTemp(discoveryDir)
    }
  })

  it('get_feature_context returns the feature and docs contents, and no rounds, runs or ticket rows', () => {
    const docsDir = join(repoPath, 'docs', 'features', slug)
    mkdirSync(docsDir, { recursive: true })
    writeFileSync(join(docsDir, 'brief.md'), '# Brief\n\nseed', 'utf8')
    writeFileSync(join(docsDir, 'decisions.md'), '# Decisions\n\nD1', 'utf8')
    storeTickets(ctx, featureId, [ticket('one')])

    const out = toolGetFeatureContext(ctx, session)
    expect(out.feature.id).toBe(featureId)
    for (const key of ['tickets', 'ticketsNotInlined', 'ticketsNote', 'rounds', 'latestRun', 'burnConcurrency']) {
      expect(key in out).toBe(false)
    }
    const byPath = Object.fromEntries(out.docs.map((d) => [d.relPath, d.content]))
    expect(byPath['brief.md']).toContain('seed')
    expect(byPath['decisions.md']).toContain('D1')
  })

  /**
   * The state a chat used to have no channel to (decisions.md #7): how the last
   * burn went lives on the `runs` table, and what this round's review found lives
   * in `review_findings` and in host scratch space outside the repo. One call
   * states all of it.
   */
  /**
   * The docs allowlist (`packages/core/src/docs.ts`). What is worth pinning is
   * both halves at once: the payload must SHRINK, and nothing may become
   * unreachable — an index entry that the agent cannot cash in would be a
   * silent deletion wearing a filename.
   */
  it('get_feature_context inlines only the canonical docs, and indexes the rest with a reason', () => {
    const docsDir = join(repoPath, 'docs', 'features', slug)
    mkdirSync(join(docsDir, 'research'), { recursive: true })
    writeFileSync(join(docsDir, 'brief.md'), '# Brief\n\nseed', 'utf8')
    writeFileSync(join(docsDir, 'spec.md'), '# Spec\n\nthe build order', 'utf8')
    writeFileSync(join(docsDir, 'outcome.md'), `# Outcome\n\n${'postmortem '.repeat(400)}`, 'utf8')
    writeFileSync(join(docsDir, 'test-notes.md'), '# Test notes\n\nalready triaged', 'utf8')
    writeFileSync(join(docsDir, 'scratch.md'), '# Scratch\n\nsomething a session wrote', 'utf8')

    const out = toolGetFeatureContext(ctx, session)

    // Inlined: the canonical four only, in reading order (brief before spec).
    expect(out.docs.map((d) => d.relPath)).toEqual(['brief.md', 'spec.md'])
    // Indexed: everything else, addressed and measured, never inlined.
    const index = Object.fromEntries(out.moreDocs.map((d) => [d.relPath, d]))
    expect(Object.keys(index).sort()).toEqual(['outcome.md', 'scratch.md', 'test-notes.md'])
    expect(index['outcome.md'].bytes).toBeGreaterThan(1000)
    expect(index['outcome.md'].title).toBe('Outcome')
    // The two the contract withholds BY NAME say why; an ordinary uncanonical
    // doc is simply not canonical, which is not the same as discouraged.
    expect(index['outcome.md'].withheld).toMatch(/outcome/i)
    expect(index['test-notes.md'].withheld).toMatch(/triaged/i)
    expect(index['scratch.md'].withheld).toBeUndefined()

    // The 4.4 KB of postmortem is not in the payload at any depth…
    expect(JSON.stringify(out)).not.toContain('postmortem postmortem')
    // …and the payload itself says how to go and get it.
    expect(out.docsNote).toMatch(/read_feature_doc/)

    // The other half of the contract: the index cashes in.
    const fetched = toolReadFeatureDoc(ctx, { featureId, sessionId: session.id }, {
      relPath: 'outcome.md',
    })
    expect(fetched.content).toContain('postmortem')
    // …and only within the feature's own docs dir.
    expect(() =>
      toolReadFeatureDoc(ctx, { featureId }, { relPath: '../../../CONTEXT.md' }),
    ).toThrow(InvalidInputError)
  })

  /**
   * `outcome.md` IS the ticket digests re-concatenated (`services/outcome.ts`),
   * so a payload carrying both pays twice for one set of facts — the same rule
   * `get_work_record` already applies to the run-level aggregate (decision 7).
   */
  it('record_event drops a timeline note', () => {
    const out = toolRecordEvent(ctx, session, { type: 'decision.recorded', message: 'chose sqlite' })
    expect(out.ok).toBe(true)
    const ev = listAfter(ctx, featureId, 0).find((e) => e.type === 'decision.recorded')
    expect(ev?.message).toBe('chose sqlite')
  })

})

/**
 * Mapped ideation is retired (ADR-0012): every feature is an ordinary one, so
 * its context carries no map state at all.
 */
describe('get_feature_context after the map retirement', () => {
  it('carries no mapped flag, frontierIds, assignedWaypointId or waypoints', async () => {
    const ctx = await makeTestCtx()
    const repoPath = tmpRepo()
    const feature = seedFeature(ctx, seedProject(ctx, repoPath).id)
    const session = createSessionRow(ctx, { featureId: feature.id, kind: 'chat', worktreePath: repoPath })

    const out = toolGetFeatureContext(ctx, session)
    expect(out.feature.id).toBe(feature.id)
    expect(out.feature).not.toHaveProperty('mapped')
    expect(out).not.toHaveProperty('frontierIds')
    expect(out).not.toHaveProperty('assignedWaypointId')
    expect(out).not.toHaveProperty('waypoints')
  })
})

describe('mcp chat write contract', () => {
  let ctx: AppCtx
  let repoPath: string
  let featureId: string
  let qa: ReturnType<typeof createSessionRow>

  beforeEach(async () => {
    ctx = await makeTestCtx()
    repoPath = tmpRepo()
    const feature = seedFeature(ctx, seedProject(ctx, repoPath).id, { slug: 'q' })
    featureId = feature.id
    qa = createSessionRow(ctx, { featureId, kind: 'chat', worktreePath: repoPath })
    setRuntimeCtx(ctx)
  })

  afterEach(() => clearRuntimeCtx())

  it('still reads', () => {
    expect(toolGetFeatureContext(ctx, qa).feature.id).toBe(featureId)
  })
})

describe('mcp session resolution', () => {
  let ctx: AppCtx

  beforeEach(async () => {
    ctx = await makeTestCtx()
    const project = seedProject(ctx)
    seedFeature(ctx, project.id, { slug: 'f1' })
  })

  it('prefers the header session id, falling back to the most recent live session', () => {
    const project = seedProject(ctx)
    const feature = seedFeature(ctx, project.id, { slug: 'f2' })
    const s1 = createSessionRow(ctx, { featureId: feature.id, kind: 'chat', worktreePath: 'x' })
    const s2 = createSessionRow(ctx, { featureId: feature.id, kind: 'chat', worktreePath: 'y' })
    markSessionLive(ctx, s1.id)
    markSessionLive(ctx, s2.id)

    expect(resolveSession(ctx, s1.id)?.id).toBe(s1.id) // header wins
    expect(resolveSession(ctx, undefined)?.id).toBe(s2.id) // fallback = most recent live
    expect(resolveSession(ctx, 'sess_missing')?.id).toBe(s2.id) // bad header -> fallback
  })
})

/**
 * Kind-filtered registration. The permission allowlist grants every tool to
 * every session and is right that an inert RULE costs nothing; a tool
 * DEFINITION is re-sent on every turn, so the same argument does not carry.
 */
describe('mcp tool registration by audience', () => {
  it('registers neither complete_phase nor go_feature for any session kind', () => {
    for (const audience of [...SessionKind.options, undefined]) {
      const tools = toolsForAudience(audience)
      expect(tools, String(audience)).not.toContain('complete_phase')
      expect(tools, String(audience)).not.toContain('go_feature')
    }
  })

  it('offers each kind only the tools its own runtime gates can let through', () => {
    const chat = toolsForAudience('chat')
    expect(chat).toContain('get_feature_context')
    // The ticket and round tools are gone for every audience (burns-become-workers):
    // work is handed to workers, and get_work_record reads the frozen history.
    const retired = ['emit_tickets', 'update_ticket', 'cancel_ticket', 'list_tickets', 'get_ticket', 'dispatch_round', 'stop_round']
    for (const audience of [...SessionKind.options, 'review' as const, undefined]) {
      for (const tool of retired) expect(toolsForAudience(audience), `${audience}/${tool}`).not.toContain(tool)
    }
    for (const tool of ['start_worker', 'resolve_finding', 'declare_ready']) expect(chat, tool).toContain(tool)

    // An orchestrator has no feature, so none of the feature surface beyond
    // the four reads it names a feature to by slug.
    const project = toolsForAudience('project')
    expect(project).toEqual(
      expect.arrayContaining([
        'create_feature',
        'get_project_context',
        'read_adr',
        'get_work_record',
        'read_feature_brief',
        'list_project_notes',
        'triage_project_note',
        'update_project_note',
        'get_feature_context',
        'read_feature_doc',
      ]),
    )
    // …and the project's fetch-one stays the project's.
    expect(toolsForAudience('chat')).not.toContain('read_feature_brief')
    expect(toolsForAudience('review')).not.toContain('read_feature_brief')
    for (const tool of ['list_project_notes', 'triage_project_note', 'update_project_note']) {
      expect(toolsForAudience('scenario-worker'), tool).not.toContain(tool)
      expect(toolsForAudience('chat'), tool).not.toContain(tool)
      expect(toolsForAudience('review'), tool).not.toContain(tool)
    }

    // Single-kind tools stay single-kind.
    expect(toolsForAudience('project')).toContain('dry_run_drive')
    expect(toolsForAudience('scenario-worker')).not.toContain('dry_run_drive')
    expect(toolsForAudience('chat')).not.toContain('dry_run_drive')
    expect(toolsForAudience('fix-drive-worker')).toContain('retry_drive')
    expect(toolsForAudience('chat')).not.toContain('retry_drive')

    // A scenario session's scope follows its drive, so it gets only the
    // either-scope note plus its own two tools and show_file.
    expect(toolsForAudience('scenario-worker')).toEqual(['hand_back', 'record_event', 'run_scenario', 'set_scenario_runner', 'show_file'])
    for (const audience of ['chat', 'project', 'fix-drive-worker', 'review'] as const) {
      expect(toolsForAudience(audience)).not.toContain('run_scenario')
      expect(toolsForAudience(audience)).not.toContain('set_scenario_runner')
    }

    // The review wires are a drive review's alone (a gates review reports over its relay).
    for (const audience of SessionKind.options.filter((k) => k !== 'drive-fix' && k !== 'scenario')) {
      expect(toolsForAudience(audience), audience).not.toContain('review_drive')
      expect(toolsForAudience(audience), audience).not.toContain('report_finding')
    }
    expect(toolsForAudience(undefined)).not.toContain('add_test_note')

    // A drive review on the host (burns-become-workers decision 3): its drive,
    // its findings, its hand-back, its own chat and the feature reads; none of
    // the lead's tools. Only the lead starts one.
    expect(toolsForAudience('review').sort()).toEqual([
      'get_feature_context',
      'hand_back',
      'read_feature_doc',
      'report_finding',
      'review_drive',
      'show_file',
    ])
    expect(toolsForAudience('chat')).toContain('start_review')
    for (const audience of ['project', 'worker', 'review'] as const) {
      expect(toolsForAudience(audience), audience).not.toContain('start_review')
    }
  })

  // Mapped ideation is retired (ADR-0012): its three tools are not registered at
  // all, so no audience — not even the unidentified one — is offered them.
  it('offers no audience the retired map tools', () => {
    const audiences = [...SessionKind.options, undefined]
    for (const audience of audiences) {
      const tools = toolsForAudience(audience)
      for (const retired of ['escalate_to_map', 'emit_waypoints', 'resolve_waypoint']) {
        expect(tools, `${audience}: ${retired}`).not.toContain(retired)
      }
    }
  })

  it('registers EVERYTHING for an audience it cannot identify', () => {
    // Failing closed would hand a live session a server with no tools and no
    // way to say so — worse than an over-long list, since every call-time guard
    // is still in place underneath.
    const all = toolsForAudience(undefined)
    expect(all).toContain('get_feature_context')
    expect(all).toContain('get_project_context')
    expect(all).toContain('review_drive')
    expect(all.length).toBeGreaterThan(toolsForAudience('chat').length)
  })

  it('builds a server for every audience without throwing', () => {
    for (const audience of ['chat', 'project', 'fix-drive-worker', 'scenario-worker', 'review'] as const) {
      expect(buildMcpServer(audience)).toBeDefined()
    }
  })
})

describe('mcp http endpoint', () => {
  let ctx: AppCtx

  beforeEach(async () => {
    ctx = await makeTestCtx()
    setRuntimeCtx(ctx)
  })
  afterEach(() => clearRuntimeCtx())

  it('is mounted at /mcp and initializes (no longer 501)', async () => {
    const app = new Hono()
    app.route('/mcp', mcpApp)
    const res = await app.request('/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'test', version: '1' },
        },
      }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.result.serverInfo.name).toBe('runcastle')
  })
})

/**
 * Whether a feature can ship a scenario (drive-scenarios decision 13): the
 * planner reads it off `get_feature_context`, read from git at the feature
 * branch and its base.
 */
describe('get_feature_context scenarios', () => {
  let ctx: AppCtx
  let repoPath: string
  let projectId: string

  function put(rel: string, body = "console.log('ENTRY_URL=/')"): void {
    const abs = join(repoPath, ...rel.split('/'))
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, body)
  }

  beforeEach(async () => {
    ctx = await makeTestCtx()
    repoPath = tmpRepo()
    const g = simpleGit(repoPath)
    await g.init(['-b', 'main'])
    await g.addConfig('user.email', 'test@runcastle.dev')
    await g.addConfig('user.name', 'Runcastle Test')
    put('README.md', 'base\n')
    await g.add('.')
    await g.commit('initial commit')
    // A branch cut before the project had scenarios, to base a feature on.
    await g.branch(['bare-base'])
    put('.runcastle/scenarios/checkout/land.ts')
    put('.runcastle/scenarios/_fixtures/buyer.ts', 'export const buyer = 1')
    await g.add('.')
    await g.commit('scenarios')
    await g.checkoutLocalBranch('feature/shipped')
    put('.runcastle/scenarios/feed/blocked-only.ts')
    put('.runcastle/scenarios/feed/blocked-only.http', 'GET /feed')
    await g.add('.')
    await g.commit('own scenario')
    await g.checkout('main')
    projectId = seedProject(ctx, repoPath).id
  })

  afterEach(() => rmTemp(repoPath))

  const setRunner = (scenarioRunner: string | null) =>
    ctx.db.update(projects).set({ scenarioRunner }).where(eq(projects.id, projectId)).run()

  it('reports a set-up project with the branch scenarios, own first, and its fixtures', async () => {
    setRunner('bun {file}')
    const feature = seedFeature(ctx, projectId, { slug: 'shipped' })
    const scenarios = await featureScenarios(ctx, feature.id)
    expect(scenarios).toEqual({
      setUp: true,
      runnerConfigured: true,
      scenarios: [
        { file: '.runcastle/scenarios/feed/blocked-only.ts', group: 'Feed', name: 'Blocked only', own: true, hasCall: true },
        { file: '.runcastle/scenarios/checkout/land.ts', group: 'Checkout', name: 'Land', own: false, hasCall: false },
      ],
      fixtures: ['.runcastle/scenarios/_fixtures/buyer.ts'],
    })
    // It rides the header, ahead of the docs.
    const context = featureContext(ctx, { featureId: feature.id }, scenarios)
    expect(context.scenarios).toEqual(scenarios)
    expect(Object.keys(context).indexOf('scenarios')).toBeLessThan(Object.keys(context).indexOf('docs'))
  })

  it('is not set up without a runner, or when the base branch has no scenarios', async () => {
    const shipped = seedFeature(ctx, projectId, { slug: 'shipped' })
    expect(await featureScenarios(ctx, shipped.id)).toMatchObject({ setUp: false, runnerConfigured: false })

    setRunner('bun {file}')
    const early = seedFeature(ctx, projectId, { slug: 'early', branch: 'bare-base', baseBranch: 'bare-base' })
    expect(await featureScenarios(ctx, early.id)).toEqual({
      setUp: false,
      runnerConfigured: true,
      scenarios: [],
      fixtures: [],
    })
  })

  it('agrees with the drive and the review prompt that a whitespace-only runner is no runner', async () => {
    setRunner('  ')
    const feature = seedFeature(ctx, projectId, { slug: 'shipped' })
    expect(await featureScenarios(ctx, feature.id)).toMatchObject({ setUp: false, runnerConfigured: false })
    expect(await listDriveScenarios(ctx, projectId, feature.id)).toMatchObject({ runnerConfigured: false })
    expect(await listFeatureScenarios(getProjectById(ctx, projectId)!, feature)).toMatchObject({
      runnerConfigured: false,
    })
  })

  it('reads a feature with no recorded base as not set up, never measuring it against main', async () => {
    setRunner('bun {file}')
    const draft = seedFeature(ctx, projectId, { slug: 'shipped', baseBranch: null })
    expect(await featureScenarios(ctx, draft.id)).toMatchObject({
      setUp: false,
      runnerConfigured: true,
      scenarios: [
        { file: '.runcastle/scenarios/checkout/land.ts', own: false },
        { file: '.runcastle/scenarios/feed/blocked-only.ts', own: false },
      ],
    })
  })

  it('carries scenarios as its only git-read block, with no stories or map groups', async () => {
    const feature = seedFeature(ctx, projectId, { slug: 'shipped' })
    const context = await featureContextWithGit(ctx, { featureId: feature.id })
    expect(context.scenarios).toBeDefined()
    expect(context).not.toHaveProperty('stories')
    expect(context).not.toHaveProperty('mapGroups')
  })
})
