import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { leastUsedEpicColor, type SessionRow } from '@runcastle/core'
import { eq } from 'drizzle-orm'
import { simpleGit } from 'simple-git'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { events, sessions } from '../src/db/schema'
import type { AppCtx } from '../src/db/types'
import { clearRuntimeCtx, setRuntimeCtx } from '../src/launcher/runtime'
import { createSessionRow, getSessionRow } from '../src/launcher/sessions'
import { openProject } from '../src/services/projects'
import { newEpicColor } from '../src/threads/epic-look'
import { appendThreadEvent } from '../src/threads/types'
import { createCallerFactory } from '../src/trpc/context'
import { appRouter } from '../src/trpc/router'
import { withTempDataDir } from './helpers/data-dir'
import { makeTestCtx } from './helpers/db'
import { rmTemp, seedFeature, tmpRepo } from './helpers/fixtures'

/** An epic's colour and icon on the server (docs/features/epics-that-look-alive, decisions 2, 3). */

let ctx: AppCtx
let repoPath: string
let projectId: string
let restoreDataDir: () => void

beforeEach(async () => {
  restoreDataDir = withTempDataDir()
  ctx = await makeTestCtx()
  repoPath = tmpRepo()
  const g = simpleGit(repoPath)
  await g.init(['-b', 'main'])
  await g.addConfig('user.email', 'test@runcastle.dev')
  await g.addConfig('user.name', 'Runcastle Test')
  writeFileSync(join(repoPath, 'README.md'), 'base\n')
  await g.add(['README.md'])
  await g.commit('initial commit')
  projectId = (await openProject(ctx, repoPath)).id
  setRuntimeCtx(ctx)
})

afterEach(() => {
  clearRuntimeCtx()
  restoreDataDir()
  rmTemp(repoPath)
})

const caller = () => createCallerFactory(appRouter)(ctx)

/** A project chat wearing `color`; `listed` when the human wrote in it just now. */
function epic(color: SessionRow['epicColor'], listed: boolean): SessionRow {
  const row = createSessionRow(ctx, { projectId, kind: 'project', worktreePath: repoPath })
  ctx.db.update(sessions).set({ epicColor: color ?? null }).where(eq(sessions.id, row.id)).run()
  if (listed) appendThreadEvent(row.id, { type: 'prompt', id: `p-${row.id}`, text: 'hello', source: 'human' })
  return getSessionRow(ctx, row.id) as SessionRow
}

describe('the colour a new epic takes (decision 2)', () => {
  it('is the least used, ties broken by palette order', () => {
    expect(leastUsedEpicColor([])).toBe('blue')
    expect(leastUsedEpicColor(['blue', 'teal', 'blue'])).toBe('green')
    expect(leastUsedEpicColor(['blue', 'teal', 'green', 'olive', 'amber', 'rust', 'rose', 'violet', 'blue'])).toBe('teal')
    expect(leastUsedEpicColor([null, undefined, 'nope'])).toBe('blue')
  })

  it("counts only the project's listed epics: written in today, or with a feature it cut in motion", () => {
    epic('blue', true)
    epic('teal', true)
    // In motion through a feature it cut, though nobody wrote in it today.
    const cutter = epic('green', false)
    seedFeature(ctx, projectId, { slug: 'moving', chatId: cutter.id, status: 'active' })
    // Not listed: idle, nothing in motion, never written in. Its olive is free again.
    epic('olive', false)
    expect(newEpicColor(ctx, projectId)).toBe('olive')
    epic('olive', true)
    expect(newEpicColor(ctx, projectId)).toBe('amber')
  })

  it('is stamped when thread.new first saves a project chat, and never by itself after', async () => {
    epic('blue', true)
    epic('teal', true)
    const { threadId } = await caller().thread.new({ projectId })
    expect(getSessionRow(ctx, threadId)?.epicColor).toBe('green')
    expect((await caller().thread.list({ projectId })).find((t) => t.id === threadId)).toMatchObject({ color: 'green' })
    // Once written in, it is listed: a later chat takes the next colour, and the first keeps its own.
    appendThreadEvent(threadId, { type: 'prompt', id: 'p', text: 'hi', source: 'human' })
    const next = (await caller().thread.new({ projectId })).threadId
    expect(getSessionRow(ctx, next)?.epicColor).toBe('olive')
    expect(getSessionRow(ctx, threadId)?.epicColor).toBe('green')
  })
})

describe('thread.setLook, the picker (decision 3)', () => {
  it('sets the colour and the icon, marks the icon human-set, and emits an event', async () => {
    const chat = epic('blue', true)
    const out = await caller().thread.setLook({ threadId: chat.id, color: 'rose', icon: 'rocket' })
    expect(out).toEqual({ color: 'rose', icon: 'rocket', iconByHuman: true })
    expect((await caller().thread.list({ projectId })).find((t) => t.id === chat.id)).toMatchObject({
      color: 'rose',
      icon: 'rocket',
      iconByHuman: true,
    })
    const emitted = ctx.db.select().from(events).all().filter((e) => e.type === 'session.epic_look_set')
    expect(emitted).toHaveLength(1)
    expect(emitted[0]).toMatchObject({ projectId, data: { sessionId: chat.id, color: 'rose', icon: 'rocket' } })
  })

  it('changing only the colour leaves the icon, and does not mark it human-set', async () => {
    const chat = epic('blue', true)
    expect(await caller().thread.setLook({ threadId: chat.id, color: 'amber' })).toEqual({ color: 'amber' })
    expect(getSessionRow(ctx, chat.id)?.epicIconByHuman).toBeUndefined()
  })

  it('refuses a colour or icon outside the curated keys, and a thread that is not an epic', async () => {
    const chat = epic('blue', true)
    await expect(caller().thread.setLook({ threadId: chat.id, color: 'pink' as never })).rejects.toThrow()
    await expect(caller().thread.setLook({ threadId: chat.id, icon: 'unicorn' as never })).rejects.toThrow()
    await expect(caller().thread.setLook({ threadId: chat.id })).rejects.toThrow(/colour or an icon/)
    const feature = seedFeature(ctx, projectId, { slug: 'pay' })
    const lead = createSessionRow(ctx, { kind: 'chat', featureId: feature.id, worktreePath: repoPath })
    await expect(caller().thread.setLook({ threadId: lead.id, color: 'rose' })).rejects.toThrow(/only an epic/)
  })
})
