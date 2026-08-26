import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { newId } from '@runcastle/core'
import { simpleGit } from 'simple-git'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runs } from '../src/db/schema'
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
  toolReadAdr,
  toolRecordEvent,
  toolResolveWaypoint,
  toolUpdateTicket,
} from '../src/mcp/server'
import { emit, listByProject } from '../src/services/events'
import { openProject } from '../src/services/projects'
import { getFeatureRow, listSessionsByFeature, setFeatureStatus } from '../src/services/repo'
import { listByFeature, storeTickets, updateTicket } from '../src/services/tickets'
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
    await expect(toolGetProjectContext(ctx, featureSession)).rejects.toThrow(GateError)
    expect(() => toolGetWorkRecord(ctx, featureSession, { featureSlug: 'dark-mode' })).toThrow(
      GateError,
    )

    const thrown = await toolGetProjectContext(ctx, featureSession).catch((e: unknown) => e)
    expect((thrown as GateError).message).toMatch(/get_feature_context/)
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

  it('create_feature with tickets takes the quick-change door — ONE feature at implementation carrying all of them', async () => {
    const proses = [
      'Make the empty state darker — it washes out on the light theme.',
      'The rail head’s Quick button has no tooltip.',
      'Dates in the conversation list read “2026-08-18”; make them human.',
    ]
    const out = await toolCreateFeature(ctx, session, {
      title: 'Darker empty state',
      oneLiner: 'ignored — a quick change has no separate summary',
      tickets: proses,
    })

    expect(out.phase).toBe('implementation')
    const tickets = listByFeature(ctx, out.id)
    // Three prose tickets and ONE feature — the chat no longer has to call this
    // three times and get three features (decisions.md #4 + #2). Plus the review
    // ticket every quick-change batch closes with: this door goes through
    // `quickChange`, so decisions.md #9 holds here exactly as on the tRPC one.
    expect(tickets).toHaveLength(4)
    expect(tickets.slice(0, 3).map((t) => t.goal)).toEqual(proses)
    expect(tickets[0].acceptanceCriteria).toEqual([proses[0]])
    expect(tickets[0].lap).toBe(1)
    expect(tickets[3].kind).toBe('review')
    expect(tickets[3].blockedBy).toEqual([1, 2, 3])
  })

  /**
   * Parking (draft-features decisions 5–6). A draft is a DB row and nothing
   * else, so what is worth pinning is the absence: no branch cut, no docs on
   * disk — and, from a feature session, that parking is the ONLY move the door
   * opens.
   */
  it('create_feature with draft: true parks the feature — brief in the row, repo untouched', async () => {
    const brief = 'Parked mid-intake: real, but not this week.'
    const out = await toolCreateFeature(ctx, session, {
      title: 'Fork door',
      oneLiner: 'branch-from prefilled from the parent feature',
      brief,
      draft: true,
    })

    expect(out).toEqual({
      id: expect.any(String),
      slug: 'fork-door',
      branch: 'feature/fork-door',
      phase: 'ideation',
    })
    const row = getFeatureRow(ctx, out.id)
    expect(row.status).toBe('draft')
    expect(row.brief).toBe(brief)

    expect((await simpleGit(repoPath).branchLocal()).all).not.toContain('feature/fork-door')
    expect(existsSync(join(repoPath, 'docs', 'features', 'fork-door'))).toBe(false)
  })

  it('create_feature parks a draft from a feature session, in that feature’s project', async () => {
    const feature = seedFeature(ctx, projectId, { slug: 'dark-mode' })
    const grill = createSessionRow(ctx, {
      featureId: feature.id,
      kind: 'ideation',
      worktreePath: repoPath,
    })

    const out = await toolCreateFeature(ctx, grill, {
      title: 'Theme editor',
      oneLiner: 'let the human tune the palette',
      brief: 'Deferred out of the dark-mode grill — it is its own feature.',
      draft: true,
    })

    const row = getFeatureRow(ctx, out.id)
    expect(row.status).toBe('draft')
    // The project came from the session's own feature, not from a projectId it
    // does not have.
    expect(row.projectId).toBe(projectId)
    expect(row.brief).toContain('Deferred out of the dark-mode grill')
  })

  it('refuses a feature session anything but a draft, pointing at the project session', async () => {
    const feature = seedFeature(ctx, projectId, { slug: 'dark-mode' })
    const grill = createSessionRow(ctx, {
      featureId: feature.id,
      kind: 'ideation',
      worktreePath: repoPath,
    })

    const cases: [string, Parameters<typeof toolCreateFeature>[2]][] = [
      ['full create', { title: 'Theme editor', oneLiner: 'tune the palette' }],
      [
        'quick change',
        { title: 'Darker empty state', oneLiner: 'o', draft: true, tickets: ['darker'] },
      ],
    ]

    for (const [name, input] of cases) {
      const thrown = await toolCreateFeature(ctx, grill, input).catch((e: unknown) => e)
      expect(thrown, name).toBeInstanceOf(GateError)
      expect((thrown as GateError).message, name).toMatch(/draft/i)
      expect((thrown as GateError).message, name).toMatch(/project session/)
    }
  })

  it('refuses a qa session outright — read-only means not even a draft', async () => {
    const feature = seedFeature(ctx, projectId, { slug: 'dark-mode' })
    const qa = createSessionRow(ctx, {
      featureId: feature.id,
      kind: 'qa',
      worktreePath: repoPath,
    })

    const thrown = await toolCreateFeature(ctx, qa, {
      title: 'Theme editor',
      oneLiner: 'tune the palette',
      draft: true,
    }).catch((e: unknown) => e)
    expect(thrown).toBeInstanceOf(GateError)
    expect((thrown as GateError).message).toMatch(/read-only/i)
  })

  // --- get_project_context ---------------------------------------------------

  it('returns the charter in full, an index of the live ADRs, and a one-line feature index', async () => {
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
    const inFlight = seedFeature(ctx, projectId, {
      slug: 'promotion-at-merge',
      title: 'Promotion at merge',
      oneLiner: 'this one-liner must not appear — it is not real yet',
    })
    storeTickets(ctx, inFlight.id, [
      { title: 'a', goal: 'g', context: 'c', acceptanceCriteria: ['a'], seams: [], blockedBy: [] },
      { title: 'b', goal: 'g', context: 'c', acceptanceCriteria: ['a'], seams: [], blockedBy: [] },
    ])

    const out = await toolGetProjectContext(ctx, session)

    expect(out.project.id).toBe(projectId)
    expect(out.charter).toContain('**Seam**: an observable boundary.')

    // The ADRs are an INDEX now, not the arguments themselves: across every real
    // project in this repo's data ZERO ADRs are superseded, so decision 13's
    // pruning never fires and "live ADRs in full" was 73% of an 80 KB payload.
    // Nothing is unreachable — indexing is not truncation, and `read_adr` cashes
    // the index in — so decision 16's no-ceiling rule still holds.
    const adrPaths = out.adrs.map((a) => a.relPath)
    expect(adrPaths).toEqual(['docs/adr/0001-bun-everywhere.md', 'docs/adr/0009-no-modes.md'])
    expect(out.adrs[0].title).toBe('ADR-0001')
    expect(out.adrs[0].bytes).toBeGreaterThan(0)
    expect(JSON.stringify(out)).not.toContain('We use Bun, never npm.')
    expect(out.adrsNote).toMatch(/read_adr/)

    expect(toolReadAdr(ctx, session, { relPath: 'docs/adr/0001-bun-everywhere.md' }).content).toContain(
      'We use Bun, never npm.',
    )
    // A bare filename is the same file — an agent echoing either spelling wins.
    expect(toolReadAdr(ctx, session, { relPath: '0001-bun-everywhere.md' }).content).toContain(
      'We use Bun, never npm.',
    )
    expect(() => toolReadAdr(ctx, session, { relPath: '../../CONTEXT.md' })).toThrow(
      InvalidInputError,
    )

    expect(out.featureIndex).toContain(
      'laps — one trip round the pipeline [shipped] docs/features/laps/',
    )
    // The in-flight line now carries what the portfolio lookup is asked for:
    // the SLUG (`get_work_record` matches on it, and the index never gave it),
    // the pipeline position and the ticket counts. All of it is in SQLite and
    // true of the feature rather than of an unmerged branch.
    expect(out.featureIndex).toContain(
      'promotion-at-merge — Promotion at merge [in flight: ideation, lap 1, 2 pending]',
    )
    // Decision 16 still holds where it was right: the one-liner and the docs
    // path live on the unmerged branch and stay withheld.
    expect(out.featureIndex.join('\n')).not.toContain('must not appear')
    expect(out.featureIndex.join('\n')).not.toContain('docs/features/promotion-at-merge')
  })

  it('reports an absent charter as absent, with no error', async () => {
    const out = await toolGetProjectContext(ctx, session)
    expect(out.charter).toBeUndefined()
    expect(out.adrs).toEqual([])
  })

  /**
   * Intake can only STATE the base it will cut from (decisions 1, 2, 7) if the
   * context says what that base is — so the payload carries the checkout's
   * branch, the bases a feature may fork off, and the main line to fall back on
   * suggesting.
   */
  it('reports the base a new feature would cut from: current, selectable, detected main', async () => {
    const g = simpleGit(repoPath)
    await g.raw(['branch', 'develop'])
    await g.checkout('develop')

    const out = await toolGetProjectContext(ctx, session)

    expect(out.baseBranches.current).toBe('develop')
    expect(out.baseBranches.currentIsSelectable).toBe(true)
    expect(out.baseBranches.selectable).toEqual(expect.arrayContaining(['develop', 'main']))
    expect(out.baseBranches.detectedMain).toBe('main')
  })

  it('excludes talk branches from the selectable bases', async () => {
    const g = simpleGit(repoPath)
    await g.raw(['branch', 'feature/dark-mode'])

    const out = await toolGetProjectContext(ctx, session)

    expect(out.baseBranches.selectable).not.toContain('feature/dark-mode')
  })

  /**
   * Mid test drive the checkout is parked on the feature's own talk branch, and
   * every silent substitution is wrong there — so the payload has to make the
   * "there is no default" case something the agent can SEE, not infer.
   */
  it('marks the checkout unselectable when it is parked on a feature branch', async () => {
    const g = simpleGit(repoPath)
    await g.raw(['branch', 'feature/dark-mode'])
    await g.checkout('feature/dark-mode')

    const out = await toolGetProjectContext(ctx, session)

    expect(out.baseBranches.current).toBe('feature/dark-mode')
    expect(out.baseBranches.currentIsSelectable).toBe(false)
    // …and the suggestion to offer instead is right there.
    expect(out.baseBranches.detectedMain).toBe('main')
    expect(out.baseBranches.selectable).toContain('main')
  })

  it('marks the checkout unselectable when HEAD is detached, offering no sha as a base', async () => {
    const g = simpleGit(repoPath)
    const head = (await g.revparse(['HEAD'])).trim()
    await g.checkout(['--detach', head])

    const out = await toolGetProjectContext(ctx, session)

    expect(out.baseBranches.current).toBe('')
    expect(out.baseBranches.currentIsSelectable).toBe(false)
    // A detached HEAD is no branch at all — the sha must not be offered as one.
    expect(out.baseBranches.selectable.join(' ')).not.toContain(head.slice(0, 7))
    expect(out.baseBranches.selectable).toContain('main')
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

  it('serves a ticket’s digest, and omits the key on a ticket that has none', () => {
    const feature = seedFeature(ctx, projectId, { slug: 'laps', title: 'Laps' })
    const [withDigest, without] = storeTickets(ctx, feature.id, [
      {
        title: 'Lap counter on features',
        goal: 'g',
        context: 'c',
        acceptanceCriteria: ['a'],
        seams: ['core pipeline functions'],
        blockedBy: [],
      },
      {
        title: 'never burned',
        goal: 'g',
        context: 'c',
        acceptanceCriteria: ['a'],
        seams: ['core pipeline functions'],
        blockedBy: [],
      },
    ])
    const digest = 'Added the lap column.\n\nSurprise: the migration already half-existed.'
    updateTicket(ctx, withDigest.id, { status: 'done', commits: ['abc123'], digest })

    const [record] = toolGetWorkRecord(ctx, session, { featureSlug: 'laps' }).features
    const served = record.tickets.find((t) => t.seq === withDigest.seq)
    expect(served?.digest).toBe(digest)
    const bare = record.tickets.find((t) => t.seq === without.seq)
    expect(bare).not.toHaveProperty('digest')
  })

  it('serves digests on seam-matched tickets too', () => {
    const feature = seedFeature(ctx, projectId, { slug: 'laps', title: 'Laps' })
    const [ticket] = storeTickets(ctx, feature.id, [
      {
        title: 'touches the router',
        goal: 'g',
        context: 'c',
        acceptanceCriteria: ['a'],
        seams: ['tRPC Feature Router'],
        blockedBy: [],
      },
    ])
    updateTicket(ctx, ticket.id, { status: 'done', digest: 'Rewired the router.' })

    const out = toolGetWorkRecord(ctx, session, { seam: 'router' })
    expect(out.features[0]?.tickets[0]?.digest).toBe('Rewired the router.')
  })

  // Decision 7: the run aggregate is the same digests re-concatenated, so it is
  // served to the UI only — returning it here would double the response with no
  // new information for an agent consumer.
  it('never serves a run’s digest aggregate — that one is the UI’s', () => {
    const feature = seedFeature(ctx, projectId, { slug: 'laps', title: 'Laps' })
    storeTickets(ctx, feature.id, [
      {
        title: 'Lap counter on features',
        goal: 'g',
        context: 'c',
        acceptanceCriteria: ['a'],
        seams: ['core pipeline functions'],
        blockedBy: [],
      },
    ])
    ctx.db
      .insert(runs)
      .values({
        id: newId('run'),
        featureId: feature.id,
        workflow: 'ticket-burner',
        status: 'succeeded',
        startedAt: 1,
        endedAt: 2,
        summary: '1 ticket burned',
        digest: '## 1 — Lap counter on features\n\nAdded the lap column.',
      })
      .run()

    const out = toolGetWorkRecord(ctx, session, { featureSlug: 'laps' })
    const [record] = out.features
    expect(record.runs).toEqual([
      { workflow: 'ticket-burner', status: 'succeeded', startedAt: 1, endedAt: 2, summary: '1 ticket burned' },
    ])
    expect(record.runs[0]).not.toHaveProperty('digest')
    expect(JSON.stringify(out)).not.toContain('Added the lap column')
  })

  it('needs at least one of featureSlug / seam', () => {
    expect(() => toolGetWorkRecord(ctx, session, {})).toThrow(InvalidInputError)
  })
})
