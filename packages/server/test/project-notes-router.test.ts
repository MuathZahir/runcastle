import { beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { createCallerFactory } from '../src/trpc/context'
import { appRouter } from '../src/trpc/router'
import { makeTestCtx } from './helpers/db'
import { seedFeature, seedProject } from './helpers/fixtures'

describe('projectNotes router', () => {
  let ctx: AppCtx
  let caller: ReturnType<ReturnType<typeof createCallerFactory<typeof appRouter>>>
  let projectId: string
  beforeEach(async () => {
    ctx = await makeTestCtx()
    caller = createCallerFactory(appRouter)(ctx)
    projectId = seedProject(ctx).id
  })

  it('exposes the complete project note lifecycle', async () => {
    const one = await caller.projectNotes.add({ projectId, text: 'one' })
    const two = await caller.projectNotes.add({ projectId, text: 'two' })
    expect(await caller.projectNotes.openCount({ projectId })).toBe(2)
    expect((await caller.projectNotes.edit({ noteId: one.id, text: 'edited' })).text).toBe('edited')
    const feature = seedFeature(ctx, projectId)
    expect(await caller.projectNotes.triage({ noteIds: [one.id, two.id], outcome: 'routed', featureId: feature.id }))
      .toHaveLength(2)
    expect((await caller.projectNotes.reopen({ noteId: one.id })).status).toBe('open')
    expect((await caller.projectNotes.dismiss({ noteId: one.id })).outcome).toBe('dismissed')
    const three = await caller.projectNotes.add({ projectId, text: 'delete me' })
    await caller.projectNotes.delete({ noteId: three.id })
    expect((await caller.projectNotes.list({ projectId })).map((n) => n.id)).not.toContain(three.id)
  })
})
