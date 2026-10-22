import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Feature } from '@runcastle/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { createSessionRow, markSessionLive } from '../src/launcher/sessions'
import { ptyRegistry, type PtyEntry } from '../src/pty/registry'
import { listAfter } from '../src/services/events'
import { createCallerFactory } from '../src/trpc/context'
import { appRouter } from '../src/trpc/router'
import { useDataDir } from './helpers/data-dir'
import { makeTestCtx } from './helpers/db'
import { rmTemp, seedFeature, seedProject } from './helpers/fixtures'

/**
 * Select area in the design view (design-mode spec, "The design loop" step 5):
 * `design.sendCrop` saves the PNG under the data dir and types its path, with
 * the human's words, into the feature's live chat.
 */

/** The PNG signature — enough bytes to tell the file was written as sent. */
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])

let home: string
let restoreDataDir: () => void
let ctx: AppCtx
let feature: Feature

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), 'rc-crop-'))
  restoreDataDir = useDataDir(home)
  ctx = await makeTestCtx()
  const project = seedProject(ctx)
  feature = seedFeature(ctx, project.id, { slug: 'invites', phase: 'planning' })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  restoreDataDir()
  rmTemp(home)
})

/** A feature chat whose row says live — with no terminal behind it yet. */
function chatRow(): { id: string } {
  const session = createSessionRow(ctx, { featureId: feature.id, kind: 'chat', worktreePath: home })
  markSessionLive(ctx, session.id)
  return session
}

/** A live feature chat whose terminal records every write. */
function liveChat(): string[] {
  const session = chatRow()
  const writes: string[] = []
  const entry = { sessionId: session.id, exited: false, pty: { write: (d: string) => writes.push(d) } }
  vi.spyOn(ptyRegistry(), 'get').mockImplementation((id) =>
    id === session.id ? (entry as unknown as PtyEntry) : undefined,
  )
  return writes
}

const design = () => createCallerFactory(appRouter)(ctx).design

describe('design.sendCrop', () => {
  it('saves the PNG under design-crops/<featureId>/ and types the screenshot line into the live chat', async () => {
    vi.useFakeTimers()
    const writes = liveChat()

    const { path } = await design().sendCrop({
      featureId: feature.id,
      png: PNG.toString('base64'),
      text: 'make this quieter',
    })
    vi.advanceTimersByTime(2000)

    expect(path.startsWith(join(home, '.runcastle', 'design-crops', feature.id))).toBe(true)
    expect(path.endsWith('.png')).toBe(true)
    expect(readFileSync(path).equals(PNG)).toBe(true)
    expect(writes).toEqual([`[Screenshot: ${path}] make this quieter`, '\r'])
    const sent = listAfter(ctx, feature.id, 0).find((e) => e.type === 'design.crop_sent')
    expect(sent?.data).toEqual({ path })
  })

  it('sends a wordless crop as the screenshot alone, and flattens a multi-line remark to one submission', async () => {
    vi.useFakeTimers()
    const writes = liveChat()

    const bare = await design().sendCrop({ featureId: feature.id, png: PNG.toString('base64'), text: '' })
    vi.advanceTimersByTime(2000)
    const lines = await design().sendCrop({
      featureId: feature.id,
      png: PNG.toString('base64'),
      text: 'quieter\nand smaller',
    })
    vi.advanceTimersByTime(2000)

    expect(writes).toEqual([
      `[Screenshot: ${bare.path}]`,
      '\r',
      `[Screenshot: ${lines.path}] quieter and smaller`,
      '\r',
    ])
  })

  it('refuses with a clear error and saves nothing when no chat is live', async () => {
    await expect(
      design().sendCrop({ featureId: feature.id, png: PNG.toString('base64'), text: 'quieter' }),
    ).rejects.toThrow('the chat is not running — open it, then select again')

    expect(existsSync(join(home, '.runcastle', 'design-crops', feature.id))).toBe(false)
    expect(listAfter(ctx, feature.id, 0).some((e) => e.type === 'design.crop_sent')).toBe(false)
  })

  it('refuses with the same error when the chat row is live but its terminal is gone', async () => {
    chatRow()

    await expect(
      design().sendCrop({ featureId: feature.id, png: PNG.toString('base64'), text: 'quieter' }),
    ).rejects.toThrow('the chat is not running — open it, then select again')
    expect(listAfter(ctx, feature.id, 0).some((e) => e.type === 'design.crop_sent')).toBe(false)
  })
})
