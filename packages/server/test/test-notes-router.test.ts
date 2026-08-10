import type { Feature, Project } from '@runcastle/core'
import { beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { createCallerFactory } from '../src/trpc/context'
import { appRouter } from '../src/trpc/router'
import { makeTestCtx } from './helpers/db'
import { seedFeature, seedProject } from './helpers/fixtures'

/**
 * The wire the review screen's notes checklist talks to. The lifecycle itself is
 * covered at the service seam (`test-notes.test.ts`); what has to be right HERE
 * is that the whole loop is reachable over tRPC — including the two things the
 * UI cannot work without: `promote` handing back the ticket it created, and a
 * refused transition arriving as an error rather than a silent no-op.
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

  it('captures, lists, edits, ticks off and deletes a note', async () => {
    const note = await caller.notes.add({ featureId: feature.id, text: 'header wraps at 400px' })
    expect(note).toMatchObject({ text: 'header wraps at 400px', status: 'open', lap: 1 })
    expect(await caller.notes.list({ featureId: feature.id })).toEqual([note])

    const edited = await caller.notes.edit({ noteId: note.id, text: 'header wraps under 400px' })
    expect(edited.text).toBe('header wraps under 400px')

    expect((await caller.notes.toggle({ noteId: note.id })).status).toBe('done')
    expect((await caller.notes.toggle({ noteId: note.id })).status).toBe('open')

    await caller.notes.remove({ noteId: note.id })
    expect(await caller.notes.list({ featureId: feature.id })).toEqual([])
  })

  it('promotes a note to a pending ticket and returns both', async () => {
    const note = await caller.notes.add({ featureId: feature.id, text: 'the run chip goes grey' })

    const promoted = await caller.notes.promote({ noteId: note.id })

    expect(promoted.ticket).toMatchObject({
      title: 'the run chip goes grey',
      goal: 'the run chip goes grey',
      status: 'pending',
      lap: 1,
    })
    expect(promoted.note).toMatchObject({ status: 'promoted', ticketId: promoted.ticket.id })
    // The ticket the UI shows in the reference is the one the ledger gets.
    const full = await caller.feature.get({ id: feature.id })
    expect(full.tickets.map((t) => t.id)).toContain(promoted.ticket.id)
  })

  it('refuses to change a promoted note — frozen reaches the client as an error', async () => {
    const note = await caller.notes.add({ featureId: feature.id, text: 'stale empty state' })
    await caller.notes.promote({ noteId: note.id })

    await expect(caller.notes.edit({ noteId: note.id, text: 'nope' })).rejects.toThrow(/promoted/)
    await expect(caller.notes.remove({ noteId: note.id })).rejects.toThrow(/promoted/)
    await expect(caller.notes.toggle({ noteId: note.id })).rejects.toThrow(/promoted/)
  })
})
