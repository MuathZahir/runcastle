import { newId } from '@runcastle/core'
import { describe, expect, it } from 'vitest'
import {
  FEATURE_STATUSES,
  UsageError,
  isMutation,
  needsConfirmation,
  parseArgs,
  splitFlags,
} from '../src/dev/args'
import {
  allProjects,
  counts,
  featuresOf,
  removeFeature,
  removeProject,
  resetPrep,
  resolveFeatures,
  resolveProjects,
} from '../src/dev/state'
import { events, features, projectFindings, projects, tickets } from '../src/db/schema'
import type { AppCtx } from '../src/db/types'
import { makeTestCtx } from './helpers/db'

/**
 * The dev tool (`bun run dev:tool`) — the argv parse and the state surgery it
 * drives. The surgery deliberately bypasses the product's guards, so what is
 * pinned here is that it removes EVERYTHING keyed by the thing it deletes: a
 * half-deleted project is worse than none, because the UI polls rows that no
 * longer have an owner.
 *
 * Git-touching paths (worktree removal, branch deletes, `worktree prune`) run
 * against a repo path that does not exist; they are best-effort by construction
 * and report through the returned notes rather than throwing.
 */

// --- argv -------------------------------------------------------------------

describe('parseArgs', () => {
  it('defaults to help and treats `--help` as help whatever else is typed', () => {
    expect(parseArgs([])).toEqual({ kind: 'help' })
    expect(parseArgs(['help'])).toEqual({ kind: 'help' })
    expect(parseArgs(['project', 'rm', 'all', '--help'])).toEqual({ kind: 'help' })
  })

  it('parses the project commands', () => {
    expect(parseArgs(['project'])).toEqual({ kind: 'project-ls' })
    expect(parseArgs(['project', 'ls'])).toEqual({ kind: 'project-ls' })
    expect(parseArgs(['project', 'rm', 'all', '--yes'])).toEqual({
      kind: 'project-rm',
      target: 'all',
      confirmed: true,
      branches: false,
    })
    expect(parseArgs(['project', 'rm', 'myapp', '--branches'])).toEqual({
      kind: 'project-rm',
      target: 'myapp',
      confirmed: false,
      branches: true,
    })
  })

  it('validates the phase against core, not a local list', () => {
    expect(parseArgs(['feature', 'phase', 'feat_1', 'tickets'])).toEqual({
      kind: 'feature-phase',
      feature: 'feat_1',
      phase: 'tickets',
    })
    expect(() => parseArgs(['feature', 'phase', 'feat_1', 'nonsense'])).toThrow(UsageError)
    expect(() => parseArgs(['feature', 'phase', 'feat_1'])).toThrow(UsageError)
  })

  it('validates the feature status', () => {
    for (const status of FEATURE_STATUSES) {
      expect(parseArgs(['feature', 'status', 'feat_1', status])).toEqual({
        kind: 'feature-status',
        feature: 'feat_1',
        status,
      })
    }
    expect(() => parseArgs(['feature', 'status', 'feat_1', 'burning'])).toThrow(UsageError)
  })

  it('parses prep + onboarding', () => {
    expect(parseArgs(['prep', 'reset', 'myapp'])).toEqual({ kind: 'prep-reset', target: 'myapp' })
    expect(parseArgs(['onboarding', 'reset', '-y'])).toEqual({
      kind: 'onboarding-reset',
      confirmed: true,
      branches: false,
    })
    expect(parseArgs(['onboarding', 'git', 'clear'])).toEqual({
      kind: 'onboarding-git',
      action: 'clear',
    })
    expect(() => parseArgs(['onboarding', 'git'])).toThrow(UsageError)
    expect(() => parseArgs(['prep', 'reset'])).toThrow(UsageError)
  })

  it('rejects unknown commands and unknown flags rather than ignoring them', () => {
    expect(() => parseArgs(['nuke'])).toThrow(UsageError)
    expect(() => parseArgs(['project', 'destroy', 'x'])).toThrow(UsageError)
    // The failure mode this guards: `--yess` silently reading as "not confirmed".
    expect(() => parseArgs(['reset', '--yess'])).toThrow(UsageError)
  })

  it('accepts -y as an alias for --yes', () => {
    expect(splitFlags(['-y', 'reset']).flags.has('--yes')).toBe(true)
  })
})

describe('needsConfirmation', () => {
  it('demands --yes for whole-tree destruction only', () => {
    expect(needsConfirmation(parseArgs(['reset']))).toBe(true)
    expect(needsConfirmation(parseArgs(['reset', '--yes']))).toBe(false)
    expect(needsConfirmation(parseArgs(['onboarding', 'reset']))).toBe(true)
    expect(needsConfirmation(parseArgs(['project', 'rm', 'all']))).toBe(true)
    expect(needsConfirmation(parseArgs(['feature', 'rm', 'all']))).toBe(true)
    // A named target says what it deletes — no second prompt on the hot path.
    expect(needsConfirmation(parseArgs(['project', 'rm', 'myapp']))).toBe(false)
    expect(needsConfirmation(parseArgs(['feature', 'phase', 'feat_1', 'spec']))).toBe(false)
  })
})

describe('isMutation', () => {
  it('excludes the read-only commands', () => {
    expect(isMutation(parseArgs(['status']))).toBe(false)
    expect(isMutation(parseArgs(['project', 'ls']))).toBe(false)
    expect(isMutation(parseArgs(['feature', 'ls']))).toBe(false)
    expect(isMutation(parseArgs(['prep', 'reset', 'x']))).toBe(true)
    expect(isMutation(parseArgs(['project', 'rm', 'x']))).toBe(true)
  })
})

// --- state surgery ----------------------------------------------------------

async function seed(): Promise<{ ctx: AppCtx; projectId: string; featureId: string }> {
  const ctx = await makeTestCtx()
  const projectId = newId('proj')
  const featureId = newId('feat')

  ctx.db
    .insert(projects)
    .values({
      id: projectId,
      name: 'MyApp',
      repoPath: '/nonexistent/myapp',
      devCommand: 'bun dev',
      closedAt: null,
      setupCommand: 'bun install',
      verifyCommands: 'bun test',
      knownFailures: 'none',
      dbResetCommand: 'bun db:reset',
    })
    .run()
  ctx.db
    .insert(features)
    .values({
      id: featureId,
      projectId,
      slug: 'my-feature',
      title: 'My feature',
      oneLiner: 'does a thing',
      mapped: false,
      phase: 'tickets',
      branch: 'feature/my-feature',
      baseBranch: 'main',
      status: 'active',
      createdAt: Date.now(),
    })
    .run()
  ctx.db
    .insert(tickets)
    .values({
      id: newId('tkt'),
      featureId,
      seq: 1,
      title: 'do it',
      goal: 'g',
      context: 'c',
      acceptanceCriteria: ['a'],
      seams: [],
      blockedBy: [],
      status: 'pending',
      commits: [],
      error: null,
      attemptBranch: null,
      conflictFiles: null,
    })
    .run()
  ctx.db
    .insert(projectFindings)
    .values({
      projectId,
      key: 'verifyCommands',
      source: 'prep',
      evidence: 'ran the suite',
      establishedAt: Date.now(),
      establishedSha: 'abc123',
    })
    .run()
  ctx.db
    .insert(events)
    .values({ projectId, featureId, ts: Date.now(), type: 'feature.created', message: 'made it' })
    .run()

  return { ctx, projectId, featureId }
}

describe('resolveProjects', () => {
  it('resolves by id, exact name, case-insensitive name, and prefix', async () => {
    const { ctx, projectId } = await seed()
    expect(resolveProjects(ctx, projectId).map((p) => p.id)).toEqual([projectId])
    expect(resolveProjects(ctx, 'MyApp').map((p) => p.id)).toEqual([projectId])
    expect(resolveProjects(ctx, 'myapp').map((p) => p.id)).toEqual([projectId])
    expect(resolveProjects(ctx, 'my').map((p) => p.id)).toEqual([projectId])
    expect(resolveProjects(ctx, 'nope')).toEqual([])
  })

  it('`all` matches every project, open or closed', async () => {
    const { ctx, projectId } = await seed()
    ctx.db.insert(projects).values({
      id: newId('proj'),
      name: 'Closed',
      repoPath: '/nonexistent/closed',
      devCommand: null,
      closedAt: Date.now(),
    }).run()
    expect(resolveProjects(ctx, 'all')).toHaveLength(2)
    expect(resolveProjects(ctx, projectId)).toHaveLength(1)
  })
})

describe('resolveFeatures', () => {
  it('resolves by id or slug', async () => {
    const { ctx, featureId } = await seed()
    expect(resolveFeatures(ctx, featureId).map((f) => f.id)).toEqual([featureId])
    expect(resolveFeatures(ctx, 'my-feature').map((f) => f.id)).toEqual([featureId])
    expect(resolveFeatures(ctx, 'all').map((f) => f.id)).toEqual([featureId])
    expect(resolveFeatures(ctx, 'other')).toEqual([])
  })
})

describe('removeFeature', () => {
  it('deletes the feature and every row keyed by it', async () => {
    const { ctx, projectId, featureId } = await seed()
    const project = allProjects(ctx)[0]
    const feature = featuresOf(ctx, projectId)[0]
    if (!project || !feature) throw new Error('seed failed')

    await removeFeature(ctx, project, feature, false)

    expect(featuresOf(ctx, projectId)).toEqual([])
    expect(ctx.db.select().from(tickets).all()).toEqual([])
    // Feature-scoped events die with the feature; the project row survives.
    expect(ctx.db.select().from(events).all().filter((e) => e.featureId === featureId)).toEqual([])
    expect(allProjects(ctx)).toHaveLength(1)
  })

  it('reports a failed worktree removal as a note instead of throwing', async () => {
    const { ctx, projectId } = await seed()
    const project = allProjects(ctx)[0]
    const feature = featuresOf(ctx, projectId)[0]
    if (!project || !feature) throw new Error('seed failed')

    // repoPath does not exist, so git cannot succeed — the rows must still go.
    await expect(removeFeature(ctx, project, feature, true)).resolves.toBeInstanceOf(Array)
    expect(featuresOf(ctx, projectId)).toEqual([])
  })
})

describe('removeProject', () => {
  it('leaves nothing behind — features, tickets, findings, events, row', async () => {
    const { ctx } = await seed()
    const project = allProjects(ctx)[0]
    if (!project) throw new Error('seed failed')

    await removeProject(ctx, project, false)

    expect(allProjects(ctx)).toEqual([])
    expect(ctx.db.select().from(features).all()).toEqual([])
    expect(ctx.db.select().from(tickets).all()).toEqual([])
    expect(ctx.db.select().from(projectFindings).all()).toEqual([])
    expect(ctx.db.select().from(events).all()).toEqual([])
    expect(counts(ctx)).toEqual({ projects: 0, openProjects: 0, features: 0, tickets: 0 })
  })
})

describe('resetPrep', () => {
  it('clears the prepared VALUES, not just the findings', async () => {
    const { ctx, projectId } = await seed()
    const project = allProjects(ctx)[0]
    if (!project) throw new Error('seed failed')

    resetPrep(ctx, project)

    const after = allProjects(ctx)[0]
    if (!after) throw new Error('project vanished')
    // Emptying these is what puts the keys back in `keysToPrepare`'s scope —
    // deleting only the findings would leave a conversation nothing to establish.
    expect(after.setupCommand).toBeNull()
    expect(after.verifyCommands).toBeNull()
    expect(after.knownFailures).toBeNull()
    expect(after.devCommand).toBeNull()
    expect(after.dbResetCommand).toBeNull()
    expect(ctx.db.select().from(projectFindings).all()).toEqual([])
    // The project itself survives — only its prepared knowledge is forgotten.
    expect(allProjects(ctx).map((p) => p.id)).toEqual([projectId])
    expect(featuresOf(ctx, projectId)).toHaveLength(1)
  })
})
