import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Project, SessionRow } from '@runcastle/core'
import { simpleGit } from 'simple-git'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { createSessionRow } from '../src/launcher/sessions'
import {
  featureContext,
  toolGetProjectContext,
  toolGetTicket,
  toolGetWorkRecord,
  toolListProjectNotes,
  toolListTickets,
  toolReadFeatureBrief,
} from '../src/mcp/server'
import { MCP_READ_CEILING_CHARS, serializedLength } from '../src/mcp/read-ceiling'
import { useDataDir } from './helpers/data-dir'
import { makeTestCtx } from './helpers/db'
import { rmTemp, seedProject } from './helpers/fixtures'
import {
  OVERSIZED_PORTFOLIO,
  type OversizedFeature,
  type OversizedPortfolio,
  seedOversizedFeature,
  seedOversizedPortfolio,
} from './helpers/oversized'

/**
 * The never-hidden guard (decisions.md #3 of
 * `mcp-read-tools-stay-within-a-context-budget`): past Claude Code's spill line
 * an MCP result is saved to a file the agent often never opens, so every read
 * tool's reply — serialized exactly as the handler sends it — must stay under
 * the shared ceiling on a feature sized past anything real.
 */
describe('read tools never outgrow the never-hidden ceiling', () => {
  let ctx: AppCtx
  let project: Project
  let home: string
  let restore: () => void

  beforeEach(async () => {
    home = mkdtempSync(join(tmpdir(), 'runcastle-read-ceiling-'))
    restore = useDataDir(home)
    ctx = await makeTestCtx()
    project = seedProject(ctx)
  })

  afterEach(() => {
    restore()
    rmTemp(home)
  })

  describe.each([
    ['linear', false],
    ['mapped', true],
  ])('get_feature_context on a %s feature', (_label, mapped) => {
    let seeded: OversizedFeature

    beforeEach(() => {
      seeded = seedOversizedFeature(ctx, project, { slug: `oversized-${_label}`, mapped })
    })

    it('fits under the ceiling', () => {
      const context = featureContext(ctx, { featureId: seeded.feature.id })
      expect(serializedLength(context)).toBeLessThanOrEqual(MCP_READ_CEILING_CHARS)
    })

    it('moves the docs that do not fit out whole, with a path to read them by', () => {
      const context = featureContext(ctx, { featureId: seeded.feature.id })

      const decisions = context.notInlined.find((doc) => doc.relPath === 'decisions.md')
      expect(decisions).toBeDefined()
      expect(decisions?.absPath).toBe(join(seeded.docsDir, 'decisions.md'))
      expect(existsSync(decisions?.absPath ?? '')).toBe(true)
      expect(decisions?.reason).toContain('read_feature_doc')
      expect(context.docs.map((doc) => doc.relPath)).not.toContain('decisions.md')
      expect(context.docsNote).toContain('notInlined')

      // Every canonical doc on disk is accounted for exactly once, in fill
      // order, and an inlined one is the whole file — never a head cut.
      const onDisk = mapped
        ? ['brief.md', 'decisions.md', 'spec.md', 'map.md']
        : ['brief.md', 'decisions.md', 'spec.md']
      const inlined = context.docs.map((doc) => doc.relPath)
      const movedOut = context.notInlined.map((doc) => doc.relPath)
      expect([...inlined, ...movedOut].sort()).toEqual([...onDisk].sort())
      expect(inlined).toEqual(onDisk.filter((name) => inlined.includes(name)))
      expect(movedOut).toEqual(onDisk.filter((name) => movedOut.includes(name)))
      for (const doc of context.docs) {
        expect(doc.content).toBe(readFileSync(join(seeded.docsDir, doc.relPath), 'utf8'))
      }
      for (const doc of context.notInlined) {
        expect(doc.bytes).toBe(statSync(doc.absPath).size)
      }
    })

    it('moves ticket detail out whole, oldest first, when rows and to-do alone cross it', () => {
      const context = featureContext(ctx, { featureId: seeded.feature.id })
      const reader = { featureId: seeded.feature.id }
      const all = toolListTickets(ctx, reader, {}).tickets

      // Goals leave oldest lap first, lowest seq first: the moved ones are a
      // prefix of that order, and each is marked rather than silently gone.
      const byAge = [...context.tickets].sort((a, b) => a.lap - b.lap || a.seq - b.seq)
      const firstKept = byAge.findIndex((row) => row.goal !== undefined)
      const moved = firstKept === -1 ? byAge : byAge.slice(0, firstKept)
      expect(moved.length).toBeGreaterThan(0)
      for (const row of moved) expect(row.goalNotInlined).toBe(true)
      for (const row of byAge.slice(moved.length)) {
        expect(row.goal).toBe(toolGetTicket(ctx, reader, { seq: row.seq }).goal)
        expect(row.goalNotInlined).toBeUndefined()
      }
      expect(context.ticketsNote).toContain('get_ticket')

      // Every ticket is a row or named in a moved-out lap, and the current
      // lap's rows never leave.
      const movedLaps = context.ticketsNotInlined ?? []
      expect([...context.tickets.map((r) => r.seq), ...movedLaps.flatMap((l) => l.seqs)].sort(
        (a, b) => a - b,
      )).toEqual(all.map((t) => t.seq).sort((a, b) => a - b))
      for (const { lap } of movedLaps) expect(lap).toBeLessThan(context.lap)
      expect(context.tickets.filter((r) => r.lap === context.lap).length).toBe(
        all.filter((t) => t.lap === context.lap).length,
      )
      // Oldest lap first: the moved laps run 1, 2, … with no gap.
      expect(movedLaps.map((l) => l.lap)).toEqual(movedLaps.map((_, i) => i + 1))
      if (mapped) expect(movedLaps.length).toBeGreaterThan(0)
    })

    it('opens with the decision-critical header', () => {
      const context = featureContext(ctx, { featureId: seeded.feature.id })
      const text = JSON.stringify(context)
      expect(text.indexOf('"annotatedModels"')).toBeGreaterThan(-1)
      expect(text.indexOf('"annotatedModels"')).toBeLessThan(2_000)
      expect(text.indexOf('"burnConcurrency"')).toBeGreaterThan(-1)
      expect(text.indexOf('"burnConcurrency"')).toBeLessThan(2_000)
      // Header, then rows, then the lap's to-do, then docs (the fixture never
      // burned, so `latestRun` is absent, and nobody claimed a waypoint).
      expect(Object.keys(context)).toEqual([
        'feature',
        'phase',
        'lap',
        'annotatedModels',
        'burnConcurrency',
        ...(mapped ? ['frontierIds'] : []),
        'reviewEvidence',
        'currentLapReview',
        'tickets',
        ...(mapped ? ['ticketsNotInlined'] : []),
        'ticketsNote',
        'openDefects',
        'carriedDefects',
        'findings',
        'testNotes',
        ...(mapped ? ['waypoints'] : []),
        'docs',
        'notInlined',
        'moreDocs',
        'docsNote',
      ])
    })
  })

  it('get_ticket on the largest ticket and list_tickets fit under the ceiling', () => {
    const seeded = seedOversizedFeature(ctx, project, { slug: 'oversized-tickets' })
    const reader = { featureId: seeded.feature.id }

    const largest = toolGetTicket(ctx, reader, { seq: seeded.largestTicketSeq })
    expect(largest.digest).toBeDefined()
    expect(serializedLength(largest)).toBeLessThanOrEqual(MCP_READ_CEILING_CHARS)
    expect(serializedLength(toolListTickets(ctx, reader, {}))).toBeLessThanOrEqual(
      MCP_READ_CEILING_CHARS,
    )
  })

  describe('the project-scope read tools on a 120+ feature portfolio', () => {
    let session: SessionRow
    let portfolio: OversizedPortfolio

    beforeEach(async () => {
      // `get_project_context` reads the checkout's branches, so the project
      // needs a real repo; the session's worktree stands in as that repo.
      const repoPath = join(home, 'repo')
      mkdirSync(repoPath)
      const g = simpleGit(repoPath)
      await g.init(['-b', 'main'])
      await g.addConfig('user.email', 'test@runcastle.dev')
      await g.addConfig('user.name', 'Runcastle Test')
      await g.commit('initial commit', { '--allow-empty': null })
      const repoProject = seedProject(ctx, repoPath)
      session = createSessionRow(ctx, {
        projectId: repoProject.id,
        kind: 'project',
        worktreePath: repoPath,
      })
      portfolio = seedOversizedPortfolio(ctx, repoProject, repoPath)
    })

    it('get_project_context fits, charter and ADR index ahead of the feature index', async () => {
      const context = await toolGetProjectContext(ctx, session)
      expect(context.featureIndex.length).toBeGreaterThan(50)
      expect(context.charter).toBeDefined()
      expect(context.charter?.length).toBeGreaterThanOrEqual(OVERSIZED_PORTFOLIO.charterChars)
      expect(context.adrs).toHaveLength(OVERSIZED_PORTFOLIO.liveAdrs)
      expect(serializedLength(context)).toBeLessThanOrEqual(MCP_READ_CEILING_CHARS)
      expect(Object.keys(context).indexOf('featureIndex')).toBeGreaterThan(
        Object.keys(context).indexOf('adrsNote'),
      )
    })

    it('get_work_record fits in its seam, slug and seq forms', () => {
      const bySeam = toolGetWorkRecord(ctx, session, { seam: portfolio.seam })
      expect(bySeam.features.length).toBeGreaterThanOrEqual(OVERSIZED_PORTFOLIO.seamTickets)
      expect(serializedLength(bySeam)).toBeLessThanOrEqual(MCP_READ_CEILING_CHARS)

      const bySlug = toolGetWorkRecord(ctx, session, { featureSlug: portfolio.workRecordSlug })
      const rows = bySlug.features[0]?.tickets ?? []
      expect(rows.some((t) => t.digestNotInlined)).toBe(true)
      expect(rows.some((t) => t.digest !== undefined)).toBe(true)
      expect(serializedLength(bySlug)).toBeLessThanOrEqual(MCP_READ_CEILING_CHARS)

      const one = toolGetWorkRecord(ctx, session, { featureSlug: portfolio.workRecordSlug, seq: 1 })
      expect(one.features[0]?.tickets[0]?.digest).toBeDefined()
      expect(serializedLength(one)).toBeLessThanOrEqual(MCP_READ_CEILING_CHARS)
    })

    it('read_feature_brief fits on a real-max brief', () => {
      const brief = toolReadFeatureBrief(ctx, session, { slug: portfolio.briefSlug })
      expect(brief.brief).toBeDefined()
      expect(serializedLength(brief)).toBeLessThanOrEqual(MCP_READ_CEILING_CHARS)
    })

    it('list_project_notes fits on an untriaged backlog with screenshots', () => {
      const notes = toolListProjectNotes(ctx, session)
      expect(notes).toHaveLength(OVERSIZED_PORTFOLIO.openNotes)
      expect(notes.some((note) => note.attachmentSentence !== undefined)).toBe(true)
      expect(serializedLength(notes)).toBeLessThanOrEqual(MCP_READ_CEILING_CHARS)
    })
  })
})
