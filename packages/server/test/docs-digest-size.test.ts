import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Feature, Project } from '@runcastle/core'
import { DOCS_DIGEST_WARN_BYTES, docsDigestSizeWarning } from '@runcastle/core'
import { worktreeDir } from '@runcastle/core/paths'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { createCallerFactory } from '../src/trpc/context'
import { appRouter } from '../src/trpc/router'
import { useDataDir } from './helpers/data-dir'
import { makeTestCtx } from './helpers/db'
import { rmTemp, seedFeature, seedProject } from './helpers/fixtures'

/**
 * What the build phase's bar has to know before it can warn: how many bytes of
 * feature docs the next burn will hand EVERY ticket in it.
 *
 * The size was only ever reported after the fact, on a run-timeline event, so
 * the human deciding the burn had nothing to read. This is the burner's own
 * `readDocsDigest` on the wire — the same number the event reports, not a second
 * count over the same files.
 */
describe('docs.digestSize', () => {
  let ctx: AppCtx
  let caller: ReturnType<ReturnType<typeof createCallerFactory<typeof appRouter>>>
  let project: Project
  let feature: Feature
  let home: string
  let restore: () => void

  beforeEach(async () => {
    home = mkdtempSync(join(tmpdir(), 'runcastle-digest-size-'))
    restore = useDataDir(home)
    ctx = await makeTestCtx()
    caller = createCallerFactory(appRouter)(ctx)
    project = seedProject(ctx)
    feature = seedFeature(ctx, project.id, { slug: 'fat-docs' })
  })

  afterEach(() => {
    restore()
    rmTemp(home)
  })

  /** Write feature docs where the burner reads them: the talk worktree. */
  const seedDocs = (files: Record<string, string>): void => {
    const dir = join(worktreeDir(project.id, feature.slug), 'docs', 'features', feature.slug)
    mkdirSync(dir, { recursive: true })
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(join(dir, name), content, 'utf8')
    }
  }

  it('reports a lean feature as the cheap digest it is', async () => {
    seedDocs({ 'brief.md': '# brief\nthe brief', 'spec.md': '# spec\nthe spec' })

    const { bytes } = await caller.docs.digestSize({ featureId: feature.id })

    expect(bytes).toBeLessThan(DOCS_DIGEST_WARN_BYTES)
    expect(docsDigestSizeWarning(bytes)).toBeNull()
  })

  it('reports docs grown past the budget, so the card can say so before the burn', async () => {
    seedDocs({ 'brief.md': `# brief\n${'b'.repeat(60_000)}` })

    const { bytes } = await caller.docs.digestSize({ featureId: feature.id })

    expect(bytes).toBeGreaterThan(DOCS_DIGEST_WARN_BYTES)
    expect(docsDigestSizeWarning(bytes)?.code).toBe('oversized-docs-digest')
  })
})
