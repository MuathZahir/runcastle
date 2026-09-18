import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Feature, Project, TicketInput } from '@runcastle/core'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { features } from '../src/db/schema'
import type { AppCtx } from '../src/db/types'
import { clearRuntimeCtx, setRuntimeCtx } from '../src/launcher/runtime'
import { createSessionRow, markSessionLive } from '../src/launcher/sessions'
import { toolCompletePhase } from '../src/mcp/server'
import { listAfter } from '../src/services/events'
import { getFeatureRow } from '../src/services/repo'
import { storeTickets } from '../src/services/tickets'
import { makeTestCtx } from './helpers/db'
import { rmTemp, seedFeature, seedProject, tmpRepo } from './helpers/fixtures'

/**
 * `complete_phase` after the four-state collapse (decisions §2).
 *
 * The tool keeps its name and its `ideation | spec | tickets` argument — the
 * skills call it that way and must not have to relearn — but ideation, spec and
 * tickets are steps INSIDE Planning now, so the call transitions nothing. What
 * it does instead is stamp the timeline and answer with what is next, derived
 * from the artifacts on disk rather than from a stored sub-step. And it never
 * refuses: a step reported twice, or reported after the human has already
 * burned, is a success with a note on it.
 */
describe('complete_phase records planning steps without moving the feature', () => {
  let ctx: AppCtx
  let repoPath: string
  let project: Project
  let feature: Feature
  let session: ReturnType<typeof createSessionRow>

  beforeEach(async () => {
    ctx = await makeTestCtx()
    repoPath = tmpRepo()
    project = seedProject(ctx, repoPath)
    feature = seedFeature(ctx, project.id, { slug: 'dark-mode', phase: 'planning' })
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

  function writeDoc(fileName: string): void {
    const docsDir = join(repoPath, 'docs', 'features', feature.slug)
    mkdirSync(docsDir, { recursive: true })
    writeFileSync(join(docsDir, fileName), `# ${fileName}\n\nbody`, 'utf8')
  }

  function emitTickets(): void {
    const input: TicketInput = {
      title: 'Add the thing',
      goal: 'g',
      context: 'c',
      acceptanceCriteria: ['a'],
      seams: [],
      blockedBy: [],
    }
    storeTickets(ctx, feature.id, [input, { ...input, title: 'Review the lap', kind: 'review' }])
  }

  function eventsOfType(type: string): number {
    return listAfter(ctx, feature.id, 0).filter((event) => event.type === type).length
  }

  function setPhaseRow(phase: Feature['phase']): void {
    ctx.db.update(features).set({ phase }).where(eq(features.id, feature.id)).run()
  }

  it('stamps the timeline for the step it was told about', () => {
    writeDoc('decisions.md')
    toolCompletePhase(ctx, session, { phase: 'ideation' })

    const stamp = listAfter(ctx, feature.id, 0).find((e) => e.type === 'phase.complete_requested')
    expect(stamp?.message).toContain('ideation')
    expect(stamp?.data).toMatchObject({ phase: 'ideation', currentPhase: 'planning' })
  })

  it('hints the next step from the artifacts, not from a stored sub-step', () => {
    writeDoc('decisions.md')
    expect(toolCompletePhase(ctx, session, { phase: 'ideation' })).toEqual({
      ok: true,
      nextPhase: 'planning',
      nextStep: 'spec',
    })

    writeDoc('spec.md')
    expect(toolCompletePhase(ctx, session, { phase: 'spec' })).toEqual({
      ok: true,
      nextPhase: 'planning',
      nextStep: 'tickets',
    })
    expect(getFeatureRow(ctx, feature.id).phase).toBe('planning')
  })

  it('drops the hint once every artifact is in — there is nothing left but Burn', () => {
    writeDoc('decisions.md')
    writeDoc('spec.md')
    emitTickets()
    expect(toolCompletePhase(ctx, session, { phase: 'tickets' })).toMatchObject({
      ok: true,
      nextPhase: 'planning',
      waitingOn: 'human burn',
      warnings: [],
    })
    expect(toolCompletePhase(ctx, session, { phase: 'tickets' }).nextStep).toBeUndefined()
  })

  it('answers a repeated report with a note rather than an error, and arms Burn once', () => {
    writeDoc('decisions.md')
    writeDoc('spec.md')
    emitTickets()

    expect(toolCompletePhase(ctx, session, { phase: 'tickets' }).note).toBeUndefined()
    const second = toolCompletePhase(ctx, session, { phase: 'tickets' })

    expect(second.ok).toBe(true)
    expect(second.note).toContain('already reported complete on lap 1')
    // Still the full answer — a repeat is not a brush-off.
    expect(second.waitingOn).toBe('human burn')
    expect(second.warnings).toEqual([])
    // The readiness milestone is stamped once; the second call re-emits nothing.
    expect(eventsOfType('tickets.awaiting_burn')).toBe(1)
  })

  it('treats the same step on a LATER lap as fresh work, not a repeat', () => {
    writeDoc('decisions.md')
    toolCompletePhase(ctx, session, { phase: 'ideation' })
    ctx.db.update(features).set({ lap: 2 }).where(eq(features.id, feature.id)).run()

    expect(toolCompletePhase(ctx, session, { phase: 'ideation' }).note).toBeUndefined()
  })

  it('tells a late session the burn already started instead of refusing it', () => {
    writeDoc('decisions.md')
    writeDoc('spec.md')
    emitTickets()
    // The human clicked Burn while this session was still closing out.
    setPhaseRow('building')

    const out = toolCompletePhase(ctx, session, { phase: 'tickets' })

    expect(out.ok).toBe(true)
    expect(out.note).toContain('already closed out')
    expect(out.nextPhase).toBe('building')
    // Nothing moved, and nothing re-armed a click that has already happened.
    expect(getFeatureRow(ctx, feature.id)).toMatchObject({ phase: 'building', ticketsReadyLap: null })
    expect(eventsOfType('tickets.awaiting_burn')).toBe(0)
    // The report itself is still on the record.
    expect(eventsOfType('phase.complete_requested')).toBe(1)
  })

  it('closes out a feature genuinely past planning even with tickets pending', () => {
    writeDoc('decisions.md')
    writeDoc('spec.md')
    emitTickets()
    setPhaseRow('shipped')

    const out = toolCompletePhase(ctx, session, { phase: 'tickets' })

    expect(out.note).toContain('already closed out')
    expect(out.warnings).toBeUndefined()
    expect(getFeatureRow(ctx, feature.id).ticketsReadyLap).toBeNull()
  })

  it('answers the iterate lap at review with its warnings, not with "already closed out"', () => {
    writeDoc('decisions.md')
    // Lap 1 has been reviewed and the next lap is being planned from there:
    // with `rethink` gone nothing moves a feature back to Planning, so the
    // session writing lap 2's fix tickets reports its steps from `review`.
    setPhaseRow('review')
    storeTickets(ctx, feature.id, [
      {
        title: 'Fix the thing the review found',
        goal: 'g',
        context: 'c',
        acceptanceCriteria: ['a'],
        seams: [],
        blockedBy: [],
      },
    ])

    const out = toolCompletePhase(ctx, session, { phase: 'tickets' })

    expect(out.ok).toBe(true)
    expect(out.note).toBeUndefined()
    expect(out.nextPhase).toBe('review')
    expect(out.waitingOn).toBe('human burn')
    // The list the human will read at the Burn dialog, heard here instead —
    // while the session that wrote the batch can still act on it (decisions §5).
    expect(out.warnings).toEqual([
      expect.stringContaining('no review ticket in this batch'),
      expect.stringContaining('no spec.md on disk'),
    ])
    // Nothing moved; the readiness stamp lands on the lap this batch burns from.
    expect(getFeatureRow(ctx, feature.id)).toMatchObject({ phase: 'review', ticketsReadyLap: 1 })
    expect(eventsOfType('tickets.awaiting_burn')).toBe(1)
  })
})
