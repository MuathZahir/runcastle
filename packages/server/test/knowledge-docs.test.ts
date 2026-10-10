import { mkdirSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Feature, Project } from '@runcastle/core'
import { beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { featureDocsDir } from '../src/services/feature-docs'
import { getFeatureFull } from '../src/services/features'
import { listDocs } from '../src/services/knowledge'
import { makeTestCtx } from './helpers/db'
import { seedFeature, seedProject, tmpRepo } from './helpers/fixtures'

/**
 * The docs listing dates each file (decision 10): the read-only banner reads
 * `Spec · written 2d ago` off it, and on a feature whose spec was written before
 * the docs watcher ran — or whose event feed has since been trimmed — the file
 * itself is the only witness left.
 */
describe('listDocs timestamps', () => {
  let ctx: AppCtx
  let project: Project
  let feature: Feature
  let dir: string

  beforeEach(async () => {
    ctx = await makeTestCtx()
    project = seedProject(ctx, tmpRepo())
    feature = seedFeature(ctx, project.id, { slug: 'dated' })
    dir = featureDocsDir(project, feature)
    mkdirSync(dir, { recursive: true })
  })

  it('reports when each doc was last written', () => {
    const written = 1_760_000_000_000
    writeFileSync(join(dir, 'spec.md'), '# Spec\n', 'utf8')
    utimesSync(join(dir, 'spec.md'), new Date(written), new Date(written))

    const spec = listDocs(ctx, feature).find((doc) => doc.relPath === 'spec.md')
    expect(spec?.updatedAt).toBe(written)
  })
})

/**
 * The plan preview rides the feature read as its own field: the page leads the
 * planning body with it, while `docs` keeps the Markdown-only list its
 * consumers assume.
 */
describe('feature.get preview', () => {
  let ctx: AppCtx
  let project: Project
  let feature: Feature
  let dir: string

  beforeEach(async () => {
    ctx = await makeTestCtx()
    project = seedProject(ctx, tmpRepo())
    feature = seedFeature(ctx, project.id, { slug: 'previewed' })
    dir = featureDocsDir(project, feature)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'spec.md'), '# Spec\n', 'utf8')
  })

  it('is null when the docs dir has no preview.html', () => {
    expect(getFeatureFull(ctx, feature.id).preview).toBeNull()
  })

  it('carries the written time once preview.html exists, and docs stay Markdown-only', () => {
    const written = 1_760_000_000_000
    writeFileSync(join(dir, 'preview.html'), '<!doctype html><p>hi</p>', 'utf8')
    utimesSync(join(dir, 'preview.html'), new Date(written), new Date(written))

    const full = getFeatureFull(ctx, feature.id)
    expect(full.preview).toEqual({ relPath: 'preview.html', updatedAt: written })
    expect(full.docs.map((doc) => doc.relPath)).toEqual(['spec.md'])
  })
})
