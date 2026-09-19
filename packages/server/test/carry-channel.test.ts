import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Feature, Project, Ticket } from '@runcastle/core'
import { reviewDir } from '@runcastle/core/paths'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { features } from '../src/db/schema'
import type { AppCtx } from '../src/db/types'
import { renderSystemPrompt } from '../src/launcher/artifacts'
import { clearRuntimeCtx, setRuntimeCtx } from '../src/launcher/runtime'
import { createSessionRow, lapKickoff, markSessionLive } from '../src/launcher/sessions'
import { toolGetFeatureContext } from '../src/mcp/server'
import { carriedWork } from '../src/services/carried-work'
import { carryFinding, openDefectsAcrossLaps, reportFinding } from '../src/services/review-findings'
import { addNote, carryNotes, listByFeature as listNotes, reopenNote } from '../src/services/test-notes'
import { storeTickets, updateTicket } from '../src/services/tickets'
import { makeTestCtx } from './helpers/db'
import { rmTemp, seedFeature, seedProject, tmpRepo } from './helpers/fixtures'

/**
 * The carry channel: what a lap hands the next one, and whether the next one
 * arrives knowing it.
 *
 * The bug this pins is a session opened BECAUSE of carried notes and open
 * defects that could name neither — the notes reached it as a pointer to a file
 * `get_feature_context` marked withheld ("already triaged into this lap's
 * tickets", untrue of anything carried), and the defects, which no doc renders,
 * reached it through no channel at all.
 */
describe('the carry channel into the next lap', () => {
  let ctx: AppCtx
  let repoPath: string
  let project: Project
  let feature: Feature
  let reviewTicket: Ticket
  let session: ReturnType<typeof createSessionRow>

  beforeEach(async () => {
    ctx = await makeTestCtx()
    repoPath = tmpRepo()
    project = seedProject(ctx, repoPath)
    feature = seedFeature(ctx, project.id, { slug: 'dark-mode', phase: 'review' })
    reviewTicket = storeTickets(ctx, feature.id, [
      {
        title: 'Review', goal: 'Review', context: '', acceptanceCriteria: [], seams: [],
        blockedBy: [], kind: 'review',
      },
    ])[0]
    session = createSessionRow(ctx, {
      featureId: feature.id,
      kind: 'chat',
      worktreePath: repoPath,
    })
    markSessionLive(ctx, session.id)
    setRuntimeCtx(ctx)
  })

  afterEach(() => {
    clearRuntimeCtx()
    rmTemp(repoPath)
  })

  /** Capture a note and carry it into the next lap, as the triage exit does. */
  function carry(text: string, intoLap = feature.lap + 1): void {
    const note = addNote(ctx, feature.id, text)
    carryNotes(ctx, feature.id, [note.id], intoLap)
  }

  /**
   * A defect whose in-run fix ticket failed, which is the state `openDefects`
   * counts — a defect still being fixed is the run's problem, not the lap's.
   */
  function openDefect(title = 'Deletes are never retried'): void {
    const { fixTicket } = reportFinding(ctx, {
      featureId: feature.id,
      reviewTicket,
      input: {
        kind: 'defect',
        severity: 'high',
        title,
        location: 'packages/server/src/dlq.ts:88',
        citation: 'spec.md §the operator can retry',
        detail: 'The retry lands at the seam but the endpoint never calls it.',
        reproStep: 'Click Retry on a dead-lettered job and watch nothing change.',
      },
    })
    updateTicket(ctx, fixTicket!.id, { status: 'failed' })
  }

  function testNotesDoc(): string {
    return readFileSync(join(repoPath, 'docs', 'features', 'dark-mode', 'test-notes.md'), 'utf8')
  }

  it('stops withholding test-notes.md once a note is carried, and withholds it again when none is', () => {
    addNote(ctx, feature.id, 'the empty state is confusing')
    const triaged = toolGetFeatureContext(ctx, session).moreDocs.find(
      (doc) => doc.relPath === 'test-notes.md',
    )
    expect(triaged?.withheld).toMatch(/triaged/i)

    const [note] = listNotes(ctx, feature.id)
    carryNotes(ctx, feature.id, [note.id], 2)
    const carried = toolGetFeatureContext(ctx, session).moreDocs.find(
      (doc) => doc.relPath === 'test-notes.md',
    )
    expect(carried?.withheld).toBeUndefined()

    // Reopening the note un-carries it, and the reason is true again.
    reopenNote(ctx, note.id)
    expect(
      toolGetFeatureContext(ctx, session).moreDocs.find((d) => d.relPath === 'test-notes.md')
        ?.withheld,
    ).toMatch(/triaged/i)
  })

  it('states each open defect with its id, title, location, detail and repro step', () => {
    openDefect()
    const [defect] = openDefectsAcrossLaps(ctx, feature.id)
    expect(toolGetFeatureContext(ctx, session).openDefects).toEqual([
      {
        // The id is the handle every disposition verb takes: a ticket's
        // `originFindingId`, and `resolve_finding`'s `findingId`. Without it a
        // session could read the defects and act on none of them.
        id: defect.id,
        title: 'Deletes are never retried',
        location: 'packages/server/src/dlq.ts:88',
        detail: 'The retry lands at the seam but the endpoint never calls it.',
        reproStep: 'Click Retry on a dead-lettered job and watch nothing change.',
      },
    ])
  })

  it('hands a lap the defects an earlier one parked, beside the ones still open', () => {
    openDefect('Deletes are never retried')
    openDefect('The toast never dismisses')
    const [, parked] = openDefectsAcrossLaps(ctx, feature.id)
    carryFinding(ctx, feature.id, parked.id)

    const context = toolGetFeatureContext(ctx, session)
    // Carried leaves the open pile and joins the agenda — the same move a
    // carried note makes, and the reason the gate stops demanding an answer.
    expect(context.openDefects.map((defect) => defect.title)).toEqual(['Deletes are never retried'])
    expect(context.carriedDefects).toEqual([
      {
        id: parked.id,
        title: 'The toast never dismisses',
        location: 'packages/server/src/dlq.ts:88',
        detail: 'The retry lands at the seam but the endpoint never calls it.',
        reproStep: 'Click Retry on a dead-lettered job and watch nothing change.',
      },
    ])
  })

  it('carries no defect that the run is still fixing, and none at all by default', () => {
    expect(toolGetFeatureContext(ctx, session).openDefects).toEqual([])
    // Reported and minted a fix ticket, which is pending: the run owns it.
    reportFinding(ctx, {
      featureId: feature.id,
      reviewTicket,
      input: {
        kind: 'defect', severity: 'low', title: 'Being fixed', location: 'a.ts:1',
        citation: 'spec.md §a', detail: 'd', reproStep: 'r',
      },
    })
    expect(toolGetFeatureContext(ctx, session).openDefects).toEqual([])
  })

  /**
   * THE SKIPPED-NOTE BUG. A note carried into lap 2 and not addressed there
   * keeps `carriedLap: 2` while the feature moves to lap 3, so every pointer
   * keyed on a lap number ("the `## Lap 2` section") loses it permanently.
   */
  it('keeps a note the next lap skipped visible at the lap after that', () => {
    carry('the toast never dismisses')
    ctx.db.update(features).set({ lap: 3 }).where(eq(features.id, feature.id)).run()

    expect(carriedWork(ctx, feature.id).carriedNotes).toBe(1)
    const doc = testNotesDoc()
    expect(doc).toContain('## Carried, still open')
    expect(doc).toContain('- [→] the toast never dismisses (captured lap 1, carried into lap 2)')
    // The section leads the doc, above the capture-lap sections it summarises.
    expect(doc.indexOf('## Carried, still open')).toBeLessThan(doc.indexOf('## Lap 1'))
    expect(lapKickoff(3, carriedWork(ctx, feature.id))).toContain('1 note carried')
  })

  it('leaves the note lifecycle alone: a carried note is out of open work', () => {
    carry('the toast never dismisses')
    expect(listNotes(ctx, feature.id).filter((note) => note.status === 'open')).toEqual([])
    expect(listNotes(ctx, feature.id).map((note) => note.status)).toEqual(['carried'])
  })

  it('the lap kickoff leads with the counts, instructs, and drops the may-not-exist hedge', () => {
    carry('the toast never dismisses')
    carry('the empty state is confusing')
    openDefect()

    const line = lapKickoff(2, carriedWork(ctx, feature.id))
    expect(line).toContain('2 notes carried and 1 defect open from earlier laps — address them.')
    expect(line).toContain('## Carried, still open')
    expect(line).toContain('openDefects')
    expect(line).not.toContain('MAY NOT EXIST YET')
  })

  it('keeps the hedge, and states no counts, when nothing was carried', () => {
    const line = lapKickoff(2, carriedWork(ctx, feature.id))
    expect(line).toContain('MAY NOT EXIST YET')
    expect(line).not.toContain('address them')
    expect(line).toContain('## Carried, still open')
  })

  it('names the same work in the injected system prompt, pointing at both channels', () => {
    carry('the toast never dismisses')
    openDefect()

    const prompt = renderSystemPrompt(
      { ...feature, phase: 'planning', lap: 2 },
      'revisit',
      undefined,
      2,
      undefined,
      undefined,
      carriedWork(ctx, feature.id),
    )
    expect(prompt).toContain('**1 note carried and 1 defect open from earlier laps — address them.**')
    expect(prompt).toContain('## Carried, still open')
    expect(prompt).toContain('It exists; read it.')
    expect(prompt).toContain('`openDefects`')
    expect(prompt).not.toMatch(/both OPTIONAL/)
  })

  /**
   * The third thing a lap carries, and the one with no other channel at all: the
   * previous lap's review evidence. `tickets` strips every `digest`, and the
   * review agent reports through host scratch space outside the repo, so a lap
   * session that is not handed the path cannot read the review of the build it is
   * being asked to plan past.
   */
  it('names the previous lap’s review evidence in the context payload, by path', () => {
    updateTicket(ctx, reviewTicket.id, {
      status: 'done',
      reviewMode: 'drive',
      reviewVerdict: 'unverified',
      reviewVerdictReason: 'The browser could not attach.',
    })
    ctx.db.update(features).set({ lap: 2 }).where(eq(features.id, feature.id)).run()

    expect(toolGetFeatureContext(ctx, session).reviewEvidence).toEqual([
      {
        ticketId: reviewTicket.id,
        seq: reviewTicket.seq,
        status: 'done',
        reviewMode: 'drive',
        reviewVerdict: 'unverified',
        reviewVerdictReason: 'The browser could not attach.',
        lap: 1,
        dir: reviewDir(reviewTicket.id),
        digestPath: join(reviewDir(reviewTicket.id), 'DIGEST.md'),
      },
    ])
    expect(lapKickoff(2, carriedWork(ctx, feature.id))).toContain(
      'nothing verified: The browser could not attach.',
    )
    const prompt = renderSystemPrompt(
      { ...feature, phase: 'planning', lap: 2 },
      'revisit',
      undefined,
      2,
      undefined,
      undefined,
      carriedWork(ctx, feature.id),
    )
    expect(prompt).toContain('**Nothing verified:** The browser could not attach.')
  })

  it('names none while the feature is still on the lap that review belongs to', () => {
    updateTicket(ctx, reviewTicket.id, { status: 'done' })

    // Lap 1's review is the CURRENT lap's review — the review loop still owns it.
    expect(toolGetFeatureContext(ctx, session).reviewEvidence).toEqual([])
  })

  it('states the disposition obligation and names all three verbs', () => {
    openDefect()

    const prompt = renderSystemPrompt(
      { ...feature, phase: 'planning', lap: 2 },
      'revisit',
      undefined,
      2,
      undefined,
      undefined,
      carriedWork(ctx, feature.id),
    )
    // "Address them" was the old instruction and it left the finding rows
    // untouched: a lap fixed the defects and nothing said so. The obligation is
    // now stated with the verb that discharges it, and with the gate that checks.
    expect(prompt).toContain('originFindingId')
    expect(prompt).toContain('resolve_finding')
    expect(prompt).toMatch(/carry/i)
    expect(prompt).toMatch(/addressed/i)
    expect(prompt).toContain('complete_phase')
  })
})
