import { EventEmitter } from 'node:events'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_SANDBOX_IMAGE } from '@runcastle/core'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { projects } from '../src/db/schema'
import type { AppCtx } from '../src/db/types'
import { listByProject } from '../src/services/events'
import { requireProjectById } from '../src/services/repo'
import { createCallerFactory } from '../src/trpc/context'
import { appRouter } from '../src/trpc/router'
import { useDataDir } from './helpers/data-dir'
import { makeTestCtx } from './helpers/db'
import { rmTemp, seedProject, tmpRepo } from './helpers/fixtures'

/**
 * `setup.imageBuildTarget` and the doctor's image probe have to answer for the
 * same image (feature `burn-page-rebuild-button-stuck-at-resolving-after-image-clear`).
 *
 * The probe heals an orphaned project column on its way past it (decision 8),
 * which CHANGES the answer the target query gives — an orphan is a tag runcastle
 * does not manage, so the Rebuild button refuses until the column is gone. This
 * pins the whole chain: the heal fires, it says so on the project's timeline (the
 * `settings.updated` the web's live resync refetches the target on), and the next
 * target read is the stock image.
 *
 * `node:child_process` is mocked rather than the exec helper, because the router
 * reaches for the real `createSystemExec` and a container runtime it can inspect
 * is a precondition of the heal — the probe returns early on a machine with none,
 * before it ever looks at the column. Answering every `--version` with 0 is the
 * whole fixture: docker reads as present, and nothing else the probe asks changes
 * the branch under test.
 */
vi.mock('node:child_process', async (importOriginal) => {
  const spawn = () => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
    })
    queueMicrotask(() => child.emit('close', 0))
    return child
  }
  return { ...(await importOriginal<object>()), spawn }
})

describe('an orphaned sandboxImage column', () => {
  let ctx: AppCtx
  let repoPath: string
  let home: string
  let restoreDataDir: () => void

  beforeEach(async () => {
    home = mkdtempSync(join(tmpdir(), 'rc-image-heal-'))
    restoreDataDir = useDataDir(home)
    ctx = await makeTestCtx()
    // Deliberately no `.runcastle/sandbox/Dockerfile`: the missing file is what
    // makes the stored column an orphan.
    repoPath = tmpRepo()
  })

  afterEach(() => {
    restoreDataDir()
    rmTemp(repoPath)
    rmTemp(home)
  })

  it('is healed by the probe, and the target resolves to the stock image after it', async () => {
    const project = seedProject(ctx, repoPath)
    // An older runcastle tagged a project's built image after the project's
    // NAME; this install tags by id, so the column names an image that answers
    // for no project here — and nothing in the repo justifies it any more.
    ctx.db
      .update(projects)
      .set({ sandboxImage: `${DEFAULT_SANDBOX_IMAGE}-${project.name}` })
      .where(eq(projects.id, project.id))
      .run()
    const caller = createCallerFactory(appRouter)(ctx)

    // Until the column goes, the orphan is a tag runcastle does not manage:
    // there is nothing the button could safely build.
    expect(await caller.setup.imageBuildTarget({ projectId: project.id })).toMatchObject({
      kind: 'refused',
      imageName: `${DEFAULT_SANDBOX_IMAGE}-${project.name}`,
    })

    await caller.setup.doctor({ projectId: project.id })

    expect(requireProjectById(ctx, project.id).sandboxImage).toBeUndefined()
    // The event the AFK card's live resync hangs off — without it the card would
    // hold the refused answer until a hard reload.
    expect(listByProject(ctx, project.id).map((e) => e.type)).toContain('settings.updated')
    expect(await caller.setup.imageBuildTarget({ projectId: project.id })).toMatchObject({
      kind: 'stock',
      tag: DEFAULT_SANDBOX_IMAGE,
    })
  })
})
