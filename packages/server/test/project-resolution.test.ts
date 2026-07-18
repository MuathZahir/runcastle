import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { AppCtx } from '../src/db/types'
import type { Project } from '@runcastle/core'
import { beforeEach, describe, expect, it } from 'vitest'
import { checkGate } from '../src/services/gates'
import { escalateToMap } from '../src/services/features'
import { listDocs, scaffoldDocs } from '../src/services/knowledge'
import { makeTestCtx } from './helpers/db'
import { seedFeature, seedProject, tmpRepo } from './helpers/fixtures'

/**
 * Behaviour-neutral guardrail for issue #36: feature-scoped work must resolve
 * its project from the feature (`feature.projectId`), never from "the sole
 * project row". Seeding a *second* project first makes the singleton lookup
 * return the wrong repo, so any call site still reaching for it writes/reads in
 * the wrong checkout — which these assertions catch.
 */
describe('project resolution (issue #36)', () => {
  let ctx: AppCtx
  let decoy: Project // inserted first → what the old `.limit(1)` singleton returns
  let owner: Project // the project the feature actually belongs to

  beforeEach(async () => {
    ctx = await makeTestCtx()
    decoy = seedProject(ctx, tmpRepo())
    owner = seedProject(ctx, tmpRepo())
  })

  it('scaffoldDocs writes into the feature project repo, not the first row', () => {
    const feature = seedFeature(ctx, owner.id, { slug: 'resolve-me' })
    scaffoldDocs(ctx, feature)

    expect(existsSync(join(owner.repoPath, 'docs', 'features', 'resolve-me', 'brief.md'))).toBe(true)
    expect(existsSync(join(decoy.repoPath, 'docs', 'features', 'resolve-me', 'brief.md'))).toBe(false)
  })

  it('listDocs reads from the feature project repo', () => {
    const feature = seedFeature(ctx, owner.id, { slug: 'reader' })
    scaffoldDocs(ctx, feature)

    expect(listDocs(ctx, feature).map((d) => d.relPath)).toContain('brief.md')
  })

  it('checkGate resolves docs under the feature project repo', () => {
    const feature = seedFeature(ctx, owner.id, { slug: 'gated' })
    scaffoldDocs(ctx, feature) // seeds brief.md; decisions.md still absent
    expect(checkGate(ctx, 'decisions-file-exists', feature).satisfied).toBe(false)
    expect(checkGate(ctx, 'spec-file-exists', feature).satisfied).toBe(false)
  })

  it('escalateToMap writes map.md into the feature project repo', () => {
    const feature = seedFeature(ctx, owner.id, { slug: 'mapper' })
    escalateToMap(ctx, feature.id, { destination: 'somewhere' })

    expect(existsSync(join(owner.repoPath, 'docs', 'features', 'mapper', 'map.md'))).toBe(true)
    expect(existsSync(join(decoy.repoPath, 'docs', 'features', 'mapper', 'map.md'))).toBe(false)
  })
})
