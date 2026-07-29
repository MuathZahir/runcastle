import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { simpleGit } from 'simple-git'
import { beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { listAfter } from '../src/services/events'
import * as features from '../src/services/features'
import { checkGate } from '../src/services/gates'
import { scaffoldDocs } from '../src/services/knowledge'
import { openProject } from '../src/services/projects'
import { getFeatureRow } from '../src/services/repo'
import { listByFeature } from '../src/services/tickets'
import { createCallerFactory } from '../src/trpc/context'
import { appRouter } from '../src/trpc/router'
import { makeTestCtx } from './helpers/db'
import { seedFeature, seedProject, tmpRepo } from './helpers/fixtures'

/**
 * The quick-change door (decision 21): work too small to deserve a grill enters
 * as an ORDINARY feature born directly at `implementation` on lap 1, carrying
 * exactly one ticket whose goal is the human's prose and whose sole acceptance
 * criterion is that same sentence.
 *
 * Driven through the SERVICE and the tRPC proc (both are real seams here —
 * unlike `feature.rethink`, nothing in this path launches a terminal).
 */

/** A real git repo with a seed commit on `main` — branch creation needs one. */
async function gitRepo(): Promise<string> {
  const dir = tmpRepo()
  const g = simpleGit(dir)
  await g.init(['-b', 'main'])
  await g.addConfig('user.email', 'test@runcastle.dev')
  await g.addConfig('user.name', 'Runcastle Test')
  await g.addConfig('core.autocrlf', 'false')
  writeFileSync(join(dir, 'README.md'), 'base\n')
  await g.add(['README.md'])
  await g.commit('initial commit')
  return dir
}

const PROSE = 'Make the empty state darker — it washes out on the light theme.'

describe('quickChange service — a one-ticket feature born at implementation', () => {
  let ctx: AppCtx
  let repoPath: string
  let projectId: string

  beforeEach(async () => {
    ctx = await makeTestCtx()
    repoPath = await gitRepo()
    projectId = (await openProject(ctx, repoPath)).id
  })

  it('creates an active lap-1 feature at implementation on a real feature branch', async () => {
    const feature = await features.quickChange(ctx, {
      projectId,
      title: 'Darker empty state',
      prose: PROSE,
    })

    expect(feature.phase).toBe('implementation')
    expect(feature.lap).toBe(1)
    expect(feature.status).toBe('active')
    expect(feature.mapped).toBe(false)
    expect(feature.slug).toBe('darker-empty-state')
    expect(feature.branch).toBe('feature/darker-empty-state')
    expect(feature.baseBranch).toBe('main')

    // The row is what was stored, not just what was returned.
    const row = getFeatureRow(ctx, feature.id)
    expect(row.phase).toBe('implementation')
    expect(row.lap).toBe(1)

    // A real branch, forked off the resolved base.
    const branches = await simpleGit(repoPath).branchLocal()
    expect(branches.all).toContain('feature/darker-empty-state')
  })

  it('forks off an explicit base branch when one is given', async () => {
    const g = simpleGit(repoPath)
    await g.checkoutLocalBranch('release')
    await g.checkout('main')

    const feature = await features.quickChange(ctx, {
      projectId,
      title: 'Off release',
      prose: PROSE,
      baseBranch: 'release',
    })
    expect(feature.baseBranch).toBe('release')
  })

  it('carries exactly one pending lap-1 ticket whose goal and criterion are the prose', async () => {
    const feature = await features.quickChange(ctx, {
      projectId,
      title: 'Darker empty state',
      prose: `  ${PROSE}  `,
    })

    const tickets = listByFeature(ctx, feature.id)
    expect(tickets).toHaveLength(1)
    expect(tickets[0]).toMatchObject({
      seq: 1,
      lap: 1,
      status: 'pending',
      title: 'Darker empty state',
      goal: PROSE,
      context: PROSE,
      acceptanceCriteria: [PROSE],
      seams: [],
      blockedBy: [],
    })
  })

  it('writes the prose verbatim into brief.md and creates no spec.md or decisions.md', async () => {
    const feature = await features.quickChange(ctx, {
      projectId,
      title: 'Darker empty state',
      prose: PROSE,
    })

    const dir = join(repoPath, 'docs', 'features', feature.slug)
    expect(readFileSync(join(dir, 'brief.md'), 'utf8')).toContain(PROSE)
    expect(existsSync(join(dir, 'spec.md'))).toBe(false)
    expect(existsSync(join(dir, 'decisions.md'))).toBe(false)
    expect(existsSync(join(dir, 'map.md'))).toBe(false)
  })

  it('commits the scaffolded brief so the checkout stays clean', async () => {
    const feature = await features.quickChange(ctx, {
      projectId,
      title: 'Darker empty state',
      prose: PROSE,
    })

    const status = await simpleGit(repoPath).status()
    expect(status.isClean()).toBe(true)
    const log = await simpleGit(repoPath).log()
    expect(log.latest?.message).toContain(feature.slug)
  })

  it('emits a timeline that spells out the born-at-implementation path', async () => {
    const feature = await features.quickChange(ctx, {
      projectId,
      title: 'Darker empty state',
      prose: PROSE,
    })

    const events = listAfter(ctx, feature.id, 0)
    expect(events.map((e) => e.type)).toEqual([
      'feature.created',
      'docs.scaffolded',
      'tickets.stored',
      'feature.quick_change',
    ])
    const quick = events.find((e) => e.type === 'feature.quick_change')
    expect(quick?.message).toContain('born at implementation on lap 1')
    expect(quick?.message).toContain('no grill session, no spec.md')
    expect(quick?.data).toMatchObject({ ticketSeq: 1, phase: 'implementation' })
  })

  it('leaves G1/G2 unevaluated and opens G3 on the single pending ticket', async () => {
    const feature = await features.quickChange(ctx, {
      projectId,
      title: 'Darker empty state',
      prose: PROSE,
    })
    const row = getFeatureRow(ctx, feature.id)

    // The feature starts past G1/G2, so the only gate ahead of it is G4 — the
    // G1/G2 checks are never reached. They would both fail if they were: there
    // is no decisions.md and no spec.md on disk.
    expect(checkGate(ctx, 'decisions-file-exists', row).satisfied).toBe(false)
    expect(checkGate(ctx, 'spec-file-exists', row).satisfied).toBe(false)

    // G3's precondition — what the Burn click needs — is satisfied by the one
    // pending lap-1 ticket.
    expect(checkGate(ctx, 'tickets-approved', row).satisfied).toBe(true)
  })

  it('deduplicates slugs against existing features, like create does', async () => {
    const first = await features.quickChange(ctx, { projectId, title: 'Tweak', prose: PROSE })
    const second = await features.quickChange(ctx, { projectId, title: 'Tweak', prose: PROSE })
    expect(first.slug).toBe('tweak')
    expect(second.slug).toBe('tweak-2')
  })

  it('refuses blank prose or a blank title, creating nothing', async () => {
    await expect(
      features.quickChange(ctx, { projectId, title: 'Empty', prose: '   ' }),
    ).rejects.toThrow(/needs a sentence/)
    await expect(
      features.quickChange(ctx, { projectId, title: '  ', prose: PROSE }),
    ).rejects.toThrow(/needs a title/)
    expect(features.list(ctx, projectId)).toHaveLength(0)
  })
})

describe('feature.quickChange proc', () => {
  let ctx: AppCtx

  beforeEach(async () => {
    ctx = await makeTestCtx()
  })

  it('is registered on the feature router and lands a burnable card', async () => {
    const projectId = (await openProject(ctx, await gitRepo())).id
    const caller = createCallerFactory(appRouter)(ctx)

    const feature = await caller.feature.quickChange({
      projectId,
      title: 'Darker empty state',
      prose: PROSE,
    })

    expect(feature.phase).toBe('implementation')
    const full = await caller.feature.get({ id: feature.id })
    expect(full.tickets).toHaveLength(1)
    expect(full.tickets[0].status).toBe('pending')
  })

  it('rejects an empty prose at the wire boundary', async () => {
    const projectId = (await openProject(ctx, await gitRepo())).id
    const caller = createCallerFactory(appRouter)(ctx)
    await expect(
      caller.feature.quickChange({ projectId, title: 'x', prose: '' }),
    ).rejects.toThrow()
  })
})

describe('scaffoldDocs brief override', () => {
  let ctx: AppCtx

  beforeEach(async () => {
    ctx = await makeTestCtx()
  })

  it('writes the given body verbatim instead of the generated stub', () => {
    const project = seedProject(ctx)
    const feature = seedFeature(ctx, project.id, { slug: 'briefed' })
    const body = '# Intake\n\nThree features fell out of the conversation; this is the first.'

    scaffoldDocs(ctx, feature, { brief: body })

    const brief = readFileSync(
      join(project.repoPath, 'docs', 'features', 'briefed', 'brief.md'),
      'utf8',
    )
    expect(brief).toBe(`${body}\n`)
    expect(brief).not.toContain('- Slug:')
  })

  it('falls back to the generated stub with no override (or a blank one)', () => {
    const project = seedProject(ctx)
    const feature = seedFeature(ctx, project.id, { slug: 'plain', title: 'Plain' })
    scaffoldDocs(ctx, feature)

    const brief = readFileSync(
      join(project.repoPath, 'docs', 'features', 'plain', 'brief.md'),
      'utf8',
    )
    expect(brief).toContain('# Plain')
    expect(brief).toContain('- Slug: plain')

    const blank = seedFeature(ctx, project.id, { slug: 'blank', title: 'Blank' })
    scaffoldDocs(ctx, blank, { brief: '   \n  ' })
    expect(
      readFileSync(join(project.repoPath, 'docs', 'features', 'blank', 'brief.md'), 'utf8'),
    ).toContain('- Slug: blank')
  })
})
