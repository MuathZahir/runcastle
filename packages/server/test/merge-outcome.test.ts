import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Project } from '@runcastle/core'
import { simpleGit, type SimpleGit } from 'simple-git'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { listAfter } from '../src/services/events'
import { __resetTestDriveState, createFeatureBranch } from '../src/services/git'
import { mergeFeatureFlow } from '../src/services/merge'
import { openProject } from '../src/services/projects'
import { withTempDataDir } from './helpers/data-dir'
import { makeTestCtx } from './helpers/db'
import { rmTemp, seedFeature, tmpRepo } from './helpers/fixtures'

/**
 * one-file-per-feature decisions 7 and 8: at merge a one-file feature gets the
 * short `## Review summary` appended to its brief.md, in the outcome commit,
 * and no outcome.md; an old-shape feature (it has decisions.md or spec.md)
 * gets outcome.md as before.
 */
describe('the merge stamps the feature’s record', () => {
  let ctx: AppCtx
  let repoPath: string
  let g: SimpleGit
  let project: Project
  let restoreDataDir: () => void

  beforeEach(async () => {
    restoreDataDir = withTempDataDir()
    __resetTestDriveState()
    ctx = await makeTestCtx()
    repoPath = tmpRepo()
    g = simpleGit(repoPath)
    await g.init(['-b', 'main'])
    await g.addConfig('user.email', 'test@runcastle.dev')
    await g.addConfig('user.name', 'Runcastle Test')
    await g.addConfig('core.autocrlf', 'false')
    writeFileSync(join(repoPath, 'README.md'), 'base\n')
    await g.add(['README.md'])
    await g.commit('initial commit')
    project = await openProject(ctx, repoPath)
  })

  afterEach(() => {
    __resetTestDriveState()
    restoreDataDir()
    rmTemp(repoPath)
  })

  /** A feature branch whose docs folder holds `docs`, ready to merge. */
  async function mergeable(slug: string, docs: Record<string, string>) {
    await createFeatureBranch(project, slug, 'main')
    await g.checkout(`feature/${slug}`)
    const dir = join(repoPath, 'docs', 'features', slug)
    mkdirSync(dir, { recursive: true })
    for (const [name, text] of Object.entries(docs)) writeFileSync(join(dir, name), text)
    writeFileSync(join(repoPath, `${slug}.txt`), `${slug}\n`)
    await g.add(['.'])
    await g.commit(`feat: ${slug}`)
    await g.checkout('main')
    return { feature: seedFeature(ctx, project.id, { slug, phase: 'review' }), dir }
  }

  const shippedOutcome = (featureId: string) =>
    listAfter(ctx, featureId, 0).find((e) => e.type === 'feature.shipped')?.data as { outcome: string | null }

  it('appends the review summary to a one-file feature’s brief.md and writes no outcome.md', async () => {
    const brief = '# Export CSV\n\nThe human’s words.\n\n## Decisions\n\n### 1. CSV only\n'
    const { feature, dir } = await mergeable('export-csv', { 'brief.md': brief })

    expect((await mergeFeatureFlow(ctx, feature.id)).ok).toBe(true)

    const text = readFileSync(join(dir, 'brief.md'), 'utf8')
    expect(text.startsWith(brief.trimEnd())).toBe(true)
    expect(text).toMatch(/\n\n## Review summary\n\n- Shipped: \d{4}-\d\d-\d\d\n- 1 commits · 2 files\n\n- No review ran\n$/)
    expect(existsSync(join(dir, 'outcome.md'))).toBe(false)
    expect((await g.log({ maxCount: 1 })).latest?.message).toBe('runcastle: outcome for export-csv')
    expect((await g.status()).isClean()).toBe(true)
    expect(shippedOutcome(feature.id).outcome).toBe('docs/features/export-csv/brief.md')
  })

  it('commits the brief as committed plus the summary, keeping the human’s uncommitted brief edits uncommitted', async () => {
    const brief = '# Share link\n\nThe human’s words.\n'
    const dir = join(repoPath, 'docs', 'features', 'share-link')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'brief.md'), brief)
    await g.add(['.'])
    await g.commit('runcastle: scaffold share-link')
    // The branch never touches the brief, so the merge goes ahead past the edit.
    const { feature } = await mergeable('share-link', {})
    writeFileSync(join(dir, 'brief.md'), `${brief}\nA half-written thought.\n`)

    expect((await mergeFeatureFlow(ctx, feature.id)).ok).toBe(true)

    const committed = await g.show(['HEAD:docs/features/share-link/brief.md'])
    expect(committed).not.toContain('half-written')
    expect(committed.startsWith(brief.trimEnd())).toBe(true)
    expect(committed).toContain('\n\n## Review summary\n')
    const working = readFileSync(join(dir, 'brief.md'), 'utf8')
    expect(working).toContain('A half-written thought.')
    expect(working).toContain('\n\n## Review summary\n')
    const changed = (await g.diff(['--', 'docs/features/share-link/brief.md'])).split('\n')
      .filter((l) => /^[+-]/.test(l) && !/^(\+\+\+|---) /.test(l))
    expect(changed).toEqual(['+A half-written thought.', '+'])
  })

  it('writes outcome.md as before for an old-shape feature and leaves its brief alone', async () => {
    const { feature, dir } = await mergeable('import-csv', { 'brief.md': '# Import\n', 'decisions.md': '# Decisions\n' })

    expect((await mergeFeatureFlow(ctx, feature.id)).ok).toBe(true)

    expect(readFileSync(join(dir, 'brief.md'), 'utf8')).toBe('# Import\n')
    expect(readFileSync(join(dir, 'outcome.md'), 'utf8')).toContain('## Review record')
    expect((await g.log({ maxCount: 1 })).latest?.message).toBe('runcastle: outcome for import-csv')
    expect(shippedOutcome(feature.id).outcome).toBe('docs/features/import-csv/outcome.md')
  })
})
