import type { Feature, Project } from '@runcastle/core'
import { beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { createCallerFactory } from '../src/trpc/context'
import { appRouter } from '../src/trpc/router'
import { storeTickets } from '../src/services/tickets'
import { makeTestCtx } from './helpers/db'
import { seedFeature, seedProject } from './helpers/fixtures'

/**
 * The wire the drive's notes list talks to. The service is covered at its own
 * seam (`test-notes.test.ts`); what has to be right HERE is that jot, edit,
 * delete and list are reachable over tRPC, and that the retired filing
 * procedures stay gone.
 */
describe('notes router', () => {
  let ctx: AppCtx
  let caller: ReturnType<ReturnType<typeof createCallerFactory<typeof appRouter>>>
  let project: Project
  let feature: Feature

  beforeEach(async () => {
    ctx = await makeTestCtx()
    caller = createCallerFactory(appRouter)(ctx)
    project = seedProject(ctx)
    feature = seedFeature(ctx, project.id)
  })

  it('captures, lists, edits and deletes a note', async () => {
    const note = await caller.notes.add({ featureId: feature.id, text: 'header wraps at 400px' })
    expect(note).toMatchObject({ text: 'header wraps at 400px', status: 'open' })
    expect(await caller.notes.list({ featureId: feature.id })).toEqual([note])

    const edited = await caller.notes.edit({ noteId: note.id, text: 'header wraps under 400px' })
    expect(edited.text).toBe('header wraps under 400px')

    await caller.notes.remove({ noteId: note.id })
    expect(await caller.notes.list({ featureId: feature.id })).toEqual([])
  })

  it('carries a note captured from the annotation player, timestamp and all', async () => {
    const reviewTicket = storeTickets(ctx, feature.id, [{
      title: 'Review the lap', goal: 'review', context: '', acceptanceCriteria: [], seams: [], blockedBy: [], kind: 'review',
    }])[0]
    const annotated = await caller.notes.add({
      featureId: feature.id,
      text: 'the panel is misaligned',
      videoTimestamp: 12.5,
      reviewTicketId: reviewTicket.id,
    })
    const typed = await caller.notes.add({ featureId: feature.id, text: 'just typed this one' })

    expect(annotated.videoTimestamp).toBe(12.5)
    expect(annotated.reviewTicketId).toBe(reviewTicket.id)
    expect(typed.videoTimestamp).toBeUndefined()
    expect(
      (await caller.notes.list({ featureId: feature.id })).map((n) => n.videoTimestamp),
    ).toEqual([12.5, undefined])
  })

  it('no longer exposes the filing lifecycle', () => {
    const procedures = Object.keys((appRouter as unknown as { _def: { procedures: object } })._def.procedures)
    for (const gone of ['toggle', 'promote', 'promoteMany', 'reopen', 'triage', 'triagePreview']) {
      expect(procedures).not.toContain(`notes.${gone}`)
    }
  })
})
