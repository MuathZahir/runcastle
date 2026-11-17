import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Feature, Project } from '@runcastle/core'
import type { AppCtx } from '../src/db/types'
import { renderReviewAssignment } from '../src/workers/review'
import { useDataDir } from './helpers/data-dir'
import { makeTestCtx } from './helpers/db'
import { rmTemp, seedFeature, seedProject, tmpRepo } from './helpers/fixtures'

/**
 * The review and verify assignments' "project's checks" section
 * (faster-cheaper-reviews decisions 3, 7, 8): unchanged without the lead's
 * passed checks; with them, a block naming the commit, the commands and the
 * git commands that decide whether the review may cite the lead's pass.
 */

let ctx: AppCtx
let home: string
let restoreDataDir: () => void
let project: Project
let feature: Feature

beforeEach(async () => {
  home = tmpRepo()
  restoreDataDir = useDataDir(home)
  ctx = await makeTestCtx()
  ctx.config.verifyCommands = 'bun run typecheck\nbun run test'
  project = seedProject(ctx, home)
  feature = seedFeature(ctx, project.id, { slug: 'quick-reviews' })
})

afterEach(() => {
  restoreDataDir()
  rmTemp(home)
})

const checksPassed = { commit: 'f00dfeed1234', commands: ['bun run typecheck', 'bun run test'] }
const site = { mode: 'gates' as const, passId: '' }
const verify = { findingIds: [], commits: ['abc1234 fix: it'] }

describe.each([
  ['review', null],
  ['verify', verify],
] as const)('the %s assignment', (_name, v) => {
  it('reads as before without the lead’s passed checks', async () => {
    const text = await renderReviewAssignment(ctx, feature, project, site, v)
    expect(text).not.toMatch(/\{\{[A-Z_]+\}\}/)
    expect(text).toContain('Run these yourself, once each, in full, on `')
    expect(text).not.toContain("lead's pass")
    expect(text).not.toContain('git diff --quiet')
  })

  it('tells the review how to cite the lead’s pass, and when it may not', async () => {
    const text = await renderReviewAssignment(ctx, feature, project, site, v, checksPassed)
    expect(text).not.toMatch(/\{\{[A-Z_]+\}\}/)
    expect(text).toContain("once each, in full, unless the lead's pass below lets you cite it,")
    expect(text).toContain('on commit `f00dfeed1234`, on a clean tree, and they were green apart from the known failures')
    expect(text).toContain('```\nbun run typecheck\nbun run test\n```')
    expect(text).toContain('git rev-parse HEAD')
    expect(text).toContain('git status --porcelain --untracked-files=no')
    expect(text).toContain("git diff --quiet f00dfeed1234 HEAD -- . ':!docs/features/quick-reviews/'")
    expect(text).toContain('run only the typecheck among the checks above, and none if no check is a typecheck')
    expect(text).toContain("citing the lead's pass on `f00dfeed1234`")
    expect(text).toContain('Never describe a check you cite as one you saw pass.')
    expect(text).toContain("run every check in full, as above, and say in your hand-back why the lead's pass did not apply")
    // The block sits inside the checks section, after the project's commands.
    const section = text.slice(text.indexOf("## The project's checks"))
    expect(section.indexOf('git rev-parse HEAD')).toBeGreaterThan(section.indexOf('bun run test'))
    expect(section.indexOf('git rev-parse HEAD')).toBeLessThan(section.indexOf('\n## ', 5))
  })

  it('asks a drive review with no scenarios for a "No scenario reaches" observation per state set up by hand', async () => {
    const text = await renderReviewAssignment(ctx, feature, project, { mode: 'drive', passId: 'pass_1' }, v)
    expect(text).not.toMatch(/\{\{[A-Z_]+\}\}/)
    expect(text).toContain("**Scenarios:** none — this project has no scenario runner recorded, so set up each criterion's state by hand")
    expect(text).toContain(
      "For each criterion's state you had to set up by hand, file a `report_finding` observation titled \"No scenario reaches <state>\".",
    )
    expect(text).toContain('Never write or edit a scenario.')
  })
})
