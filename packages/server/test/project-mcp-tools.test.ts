import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { simpleGit } from 'simple-git'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { GateError, InvalidInputError } from '../src/errors'
import { clearRuntimeCtx, setRuntimeCtx } from '../src/launcher/runtime'
import { createSessionRow } from '../src/launcher/sessions'
import {
  toolCancelTicket,
  toolCompletePhase,
  toolCreateFeature,
  toolEmitTickets,
  toolEmitWaypoints,
  toolEscalateToMap,
  toolGetFeatureContext,
  toolGetProjectContext,
  toolGetWorkRecord,
  toolRecordEvent,
  toolResolveWaypoint,
  toolUpdateTicket,
} from '../src/mcp/server'
import { emit, listByProject } from '../src/services/events'
import { openProject } from '../src/services/projects'
import { getFeatureRow, listSessionsByFeature, setFeatureStatus } from '../src/services/repo'
import { listByFeature, storeTickets } from '../src/services/tickets'
import { makeTestCtx } from './helpers/db'
import { seedFeature, tmpRepo } from './helpers/fixtures'

/**
 * The project session's MCP surface (decisions 15, 19, 21): exactly four tools,
 * and deliberately none of the pipeline's nine.
 *
 * The invariants worth pinning are the ones a session cannot recover from on
 * its own: which half of the surface each kind may call (and that the refusal
 * SAYS so, since there is no human to ask), and that the two read tools return
 * the present rather than a decayed copy of it.
 */

/** A real git repo with a seed commit on `main` — branch creation needs one. */
async function gitRepo(): Promise<string> {
  const dir = tmpRepo()
  const g = simpleGit(dir)
  await g.init(['-b', 'main'])
  await g.addConfig('user.email', 'test@runcastle.dev')
  await g.addConfig('user.name', 'Runcastle Test')
  await g.addConfig('core.autocrlf', 'false')
  writeFileSync(join(dir, 'README.md'), 'base\n')
  await g.add(['README.md'])
  await g.commit('initial commit')
  return dir
}

function write(root: string, relPath: string, body: string): void {
  const path = join(root, ...relPath.split('/'))
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, body, 'utf8')
}

describe('project-session MCP tools', () => {
  let ctx: AppCtx
  let repoPath: string
  let projectId: string
  let session: ReturnType<typeof createSessionRow>

  beforeEach(async () => {
    ctx = await makeTestCtx()
    repoPath = await gitRepo()
    projectId = (await openProject(ctx, repoPath)).id
    // The project session works in its OWN worktree, never the human's checkout;
    // the repo path stands in for it here (same shape, one less git worktree).
    session = createSessionRow(ctx, { projectId, kind: 'project', worktreePath: repoPath })
    setRuntimeCtx(ctx)
  })

  afterEach(() => clearRuntimeCtx())

  // --- scoping ---------------------------------------------------------------

  it('refuses every pipeline tool with a message naming the project scope', () => {
    const calls: [string, () => unknown][] = [
      ['get_feature_context', () => toolGetFeatureContext(ctx, session)],
      ['emit_tickets', () => toolEmitTickets(ctx, session, { tickets: [] })],
      ['complete_phase', () => toolCompletePhase(ctx, session, { phase: 'ideation' })],
      ['emit_waypoints', () => toolEmitWaypoints(ctx, session, { waypoints: [] })],
      [
        'resolve_waypoint',
        () => toolResolveWaypoint(ctx, session, { id: 'wp_x', disposition: 'resolved', summary: 's' }),
      ],
      ['escalate_to_map', () => toolEscalateToMap(ctx, session, { destination: 'd' })],
      ['update_ticket', () => toolUpdateTicket(ctx, session, { id: 'tick_x', title: 't' })],
      ['cancel_ticket', () => toolCancelTicket(ctx, session, { id: 'tick_x' })],
    ]

    for (const [name, call] of calls) {
      let thrown: unknown
      try {
        call()
      } catch (e) {
        thrown = e
      }
      expect(thrown, name).toBeInstanceOf(GateError)
      const message = (thrown as GateError).message
      expect(message, name).toMatch(/project-scoped/i)
      // The refusal points at the half of the surface this session DOES have.
      expect(message, name).toMatch(/create_feature/)
    }
  })

  it('refuses the three project tools from a feature session, and says what to use instead', async () => {
    const feature = seedFeature(ctx, projectId, { slug: 'dark-mode' })
    const featureSession = createSessionRow(ctx, {
      featureId: feature.id,
      kind: 'ideation',
      worktreePath: repoPath,
    })

    await expect(
      toolCreateFeature(ctx, featureSession, { title: 'T', oneLiner: 'o' }),
    ).rejects.toThrow(GateError)
    expect(() => toolGetProjectContext(ctx, featureSession)).toThrow(GateError)
    expect(() => toolGetWorkRecord(ctx, featureSession, { featureSlug: 'dark-mode' })).toThrow(
      GateError,
    )

    try {
      toolGetProjectContext(ctx, featureSession)
    } catch (e) {
      expect((e as GateError).message).toMatch(/get_feature_context/)
    }
  })

  it('record_event stays available to both kinds, at each one’s own scope', () => {
    const feature = seedFeature(ctx, projectId, { slug: 'dark-mode' })
    const featureSession = createSessionRow(ctx, {
      featureId: feature.id,
      kind: 'ideation',
      worktreePath: repoPath,
    })

    expect(toolRecordEvent(ctx, session, { type: 'intake.note', message: 'three features' })).toEqual(
      { ok: true },
    )
    expect(
      toolRecordEvent(ctx, featureSession, { type: 'decision.recorded', message: 'chose sqlite' }),
    ).toEqual({ ok: true })

    const stream = listByProject(ctx, projectId)
    const projectNote = stream.find((e) => e.type === 'intake.note')
    expect(projectNote?.message).toBe('three features')
    // Project-scoped: no feature id at all (the events table already allows it).
    expect(projectNote?.featureId).toBeUndefined()
    expect(stream.find((e) => e.type === 'decision.recorded')?.featureId).toBe(feature.id)
  })

  // --- create_feature --------------------------------------------------------

  it('create_feature writes the passed brief verbatim, starts at ideation, and launches nothing', async () => {
    const brief = [
      '# Promotion at merge',
      '',
      'Exists because a decision that binds a stranger must not stay in one feature’s docs.',
      'It must NOT swallow the charter’s lifecycle — that is its own feature.',
    ].join('\n')

    const out = await toolCreateFeature(ctx, session, {
      title: 'Promotion at merge',
      oneLiner: 'promote nominated decisions into ADRs when a feature merges',
      brief,
    })

    expect(out).toEqual({
      id: expect.any(String),
      slug: 'promotion-at-merge',
      branch: 'feature/promotion-at-merge',
      phase: 'ideation',
    })
    expect(getFeatureRow(ctx, out.id).phase).toBe('ideation')
    expect(listByFeature(ctx, out.id)).toHaveLength(0)

    const briefPath = join(repoPath, 'docs', 'features', out.slug, 'brief.md')
    expect(readFileSync(briefPath, 'utf8').trim()).toBe(brief.trim())

    // It creates; it does not open a terminal on what it created — the new card
    // appearing in the rail is the feedback, and the human picks what is next.
    expect(listSessionsByFeature(ctx, out.id)).toEqual([])
  })

  it('create_feature falls back to the generated brief stub when none is passed', async () => {
    const out = await toolCreateFeature(ctx, session, {
      title: 'Fork door',
      oneLiner: 'branch-from prefilled from the parent feature',
    })
    const body = readFileSync(join(repoPath, 'docs', 'features', out.slug, 'brief.md'), 'utf8')
    expect(body).toContain('# Fork door')
    expect(body).toContain('branch-from prefilled from the parent feature')
    expect(body).toContain('- Slug: fork-door')
  })

  it('create_feature with a ticket takes the quick-change door — implementation, one ticket, atomically', async () => {
    const prose = 'Make the empty state darker — it washes out on the light theme.'
    const out = await toolCreateFeature(ctx, session, {
      title: 'Darker empty state',
      oneLiner: 'ignored — a quick change has no separate summary',
      ticket: { prose },
    })

    expect(out.phase).toBe('implementation')
    const tickets = listByFeature(ctx, out.id)
    expect(tickets).toHaveLength(1)
    expect(tickets[0].goal).toBe(prose)
    expect(tickets[0].acceptanceCriteria).toEqual([prose])
    expect(tickets[0].lap).toBe(1)
  })

  // --- get_project_context ---------------------------------------------------

  it('returns the charter in full, only live ADRs, and a one-line feature index', async () => {
    write(repoPath, 'CONTEXT.md', '# Runcastle\n\n## Language\n\n**Seam**: an observable boundary.\n')
    write(repoPath, 'docs/adr/0001-bun-everywhere.md', '# ADR-0001\n\nWe use Bun, never npm.\n')
    write(
      repoPath,
      'docs/adr/0004-agile-toggle.md',
      '# ADR-0004\n\nStatus: superseded by ADR-0009\n\nWe had a mode toggle.\n',
    )
    write(repoPath, 'docs/adr/0009-no-modes.md', '# ADR-0009\n\nsupersedes: 0004\n')

    const shipped = seedFeature(ctx, projectId, {
      slug: 'laps',
      title: 'Laps',
      oneLiner: 'one trip round the pipeline',
    })
    setFeatureStatus(ctx, shipped.id, 'shipped')
    seedFeature(ctx, projectId, {
      slug: 'promotion-at-merge',
      title: 'Promotion at merge',
      oneLiner: 'this one-liner must not appear — it is not real yet',
    })

    const out = toolGetProjectContext(ctx, session)

    expect(out.project.id).toBe(projectId)
    expect(out.charter).toContain('**Seam**: an observable boundary.')

    const adrPaths = out.adrs.map((a) => a.relPath)
    expect(adrPaths).toEqual(['docs/adr/0001-bun-everywhere.md', 'docs/adr/0009-no-modes.md'])
    expect(out.adrs[0].content).toContain('We use Bun, never npm.')

    expect(out.featureIndex).toContain(
      'laps — one trip round the pipeline [shipped] docs/features/laps/',
    )
    expect(out.featureIndex).toContain('Promotion at merge [in flight]')
    // In flight is "not real yet": title and status, nothing else.
    expect(out.featureIndex.join('\n')).not.toContain('must not appear')
  })

  it('reports an absent charter as absent, with no error', () => {
    const out = toolGetProjectContext(ctx, session)
    expect(out.charter).toBeUndefined()
    expect(out.adrs).toEqual([])
  })

  // --- get_work_record -------------------------------------------------------

  it('returns facts only, by feature slug — never a ticket’s goal or acceptance criteria', () => {
    const feature = seedFeature(ctx, projectId, { slug: 'laps', title: 'Laps' })
    const [ticket] = storeTickets(ctx, feature.id, [
      {
        title: 'Lap counter on features',
        goal: 'intent that decayed the moment the code landed',
        context: 'more decayed intent',
        acceptanceCriteria: ['the lap column exists'],
        seams: ['core pipeline functions', 'tRPC feature router'],
        blockedBy: [],
      },
    ])

    // The ship date lives on the timeline, not on the feature row.
    const shipped = emit(ctx, feature.id, { type: 'feature.shipped', message: 'merged to main' })

    const out = toolGetWorkRecord(ctx, session, { featureSlug: 'laps' })
    expect(out.features).toHaveLength(1)
    const [record] = out.features
    expect(record.slug).toBe('laps')
    expect(record.shippedAt).toBe(shipped.ts)
    expect(record.tickets).toEqual([
      {
        seq: ticket.seq,
        title: 'Lap counter on features',
        status: 'pending',
        seams: ['core pipeline functions', 'tRPC feature router'],
        commits: [],
      },
    ])
    const serialized = JSON.stringify(out)
    expect(serialized).not.toContain('decayed intent')
    expect(serialized).not.toContain('the lap column exists')
  })

  it('matches a seam as a case-insensitive substring, returning only the matching tickets', () => {
    const laps = seedFeature(ctx, projectId, { slug: 'laps', title: 'Laps' })
    storeTickets(ctx, laps.id, [
      {
        title: 'touches the router',
        goal: 'g',
        context: 'c',
        acceptanceCriteria: ['a'],
        seams: ['tRPC Feature Router'],
        blockedBy: [],
      },
      {
        title: 'touches the web shell',
        goal: 'g',
        context: 'c',
        acceptanceCriteria: ['a'],
        seams: ['features rail'],
        blockedBy: [],
      },
    ])
    const prep = seedFeature(ctx, projectId, { slug: 'prepare', title: 'Preparation' })
    storeTickets(ctx, prep.id, [
      {
        title: 'also the router',
        goal: 'g',
        context: 'c',
        acceptanceCriteria: ['a'],
        seams: ['the trpc router surface, project procedures'],
        blockedBy: [],
      },
    ])

    const out = toolGetWorkRecord(ctx, session, { seam: 'TRPC router' })
    expect(out.features.map((f) => f.slug)).toEqual(['prepare'])

    const wider = toolGetWorkRecord(ctx, session, { seam: 'router' })
    expect(wider.features.map((f) => f.slug).sort()).toEqual(['laps', 'prepare'])
    const lapsRecord = wider.features.find((f) => f.slug === 'laps')
    // only the tickets that matched — the web-shell one is not part of the answer
    expect(lapsRecord?.tickets.map((t) => t.title)).toEqual(['touches the router'])
  })

  it('needs at least one of featureSlug / seam', () => {
    expect(() => toolGetWorkRecord(ctx, session, {})).toThrow(InvalidInputError)
  })
})
