import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Feature } from '@runcastle/core'
import { eq } from 'drizzle-orm'
import { simpleGit } from 'simple-git'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { features } from '../src/db/schema'
import type { AppCtx } from '../src/db/types'
import { GateError, InvalidInputError } from '../src/errors'
import { createSessionRow } from '../src/launcher/sessions'
import {
  toolCreateFeature,
  toolGetFeatureContext,
  toolGetProjectContext,
  toolSetFeatureDependencies,
  toolsForAudience,
} from '../src/mcp/server'
import { dependsOnOf, setDependencies } from '../src/services/dependencies'
import { listAfter } from '../src/services/events'
import { openProject } from '../src/services/projects'
import { withTempDataDir } from './helpers/data-dir'
import { makeTestCtx } from './helpers/db'
import { rmTemp, seedFeature, tmpRepo } from './helpers/fixtures'

/**
 * The agents' half of merge-order dependencies (ADR-0013, decisions 5 and 8):
 * `dependsOn` at create time for any drafting session, `set_feature_dependencies`
 * for the project session only, and the edges on both context reads.
 */

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

describe('feature dependencies over MCP', () => {
  let ctx: AppCtx
  let repoPath: string
  let projectId: string
  let session: ReturnType<typeof createSessionRow>
  let restoreDataDir: () => void

  const draft = (slug: string): Feature =>
    seedFeature(ctx, projectId, { slug, status: 'draft', baseBranch: null })
  const shipped = (slug: string): Feature =>
    seedFeature(ctx, projectId, { slug, status: 'shipped', phase: 'shipped' })
  const rowCount = (): number => ctx.db.select().from(features).all().length

  beforeEach(async () => {
    restoreDataDir = withTempDataDir()
    ctx = await makeTestCtx()
    repoPath = await gitRepo()
    projectId = (await openProject(ctx, repoPath)).id
    session = createSessionRow(ctx, { projectId, kind: 'project', worktreePath: repoPath })
  })

  afterEach(() => {
    restoreDataDir()
    rmTemp(repoPath)
  })

  // --- create_feature dependsOn ---------------------------------------------

  it('create_feature with draft: true and dependsOn parks a draft that waits on them', async () => {
    const auth = seedFeature(ctx, projectId, { slug: 'auth-rework', phase: 'building' })

    const out = await toolCreateFeature(ctx, session, {
      title: 'Billing',
      oneLiner: 'charge for it',
      draft: true,
      dependsOn: ['auth-rework'],
    })

    expect(out.dependsOn).toEqual(['auth-rework'])
    expect(dependsOnOf(ctx, out.id).map((d) => [d.featureId, d.satisfied])).toEqual([
      [auth.id, false],
    ])
  })

  it('lets a chat session park a draft that waits on its own feature', async () => {
    const own = seedFeature(ctx, projectId, { slug: 'dark-mode' })
    const grill = createSessionRow(ctx, { featureId: own.id, kind: 'chat', worktreePath: repoPath })

    const out = await toolCreateFeature(ctx, grill, {
      title: 'Theme editor',
      oneLiner: 'tune the palette',
      draft: true,
      dependsOn: ['dark-mode'],
    })

    expect(out.dependsOn).toEqual(['dark-mode'])
    expect(dependsOnOf(ctx, out.id).map((d) => d.slug)).toEqual(['dark-mode'])
  })

  it('refuses dependsOn on a started feature or a quick change', async () => {
    seedFeature(ctx, projectId, { slug: 'auth-rework' })
    const before = rowCount()

    const cases: [string, Parameters<typeof toolCreateFeature>[2]][] = [
      ['full create', { title: 'Billing', oneLiner: 'o', dependsOn: ['auth-rework'] }],
      [
        'quick change',
        { title: 'Billing', draft: true, tickets: ['charge'], dependsOn: ['auth-rework'] },
      ],
    ]
    for (const [name, input] of cases) {
      const thrown = await toolCreateFeature(ctx, session, input).catch((e: unknown) => e)
      expect(thrown, name).toBeInstanceOf(InvalidInputError)
      expect((thrown as Error).message, name).toMatch(/only for drafts/)
    }
    expect(rowCount()).toBe(before)
  })

  it('refuses an unknown, cross-project or already-shipped slug and creates nothing', async () => {
    shipped('old-auth')
    const otherRepo = await gitRepo()
    try {
      const otherProjectId = (await openProject(ctx, otherRepo)).id
      seedFeature(ctx, otherProjectId, { slug: 'elsewhere' })
      const before = rowCount()

      for (const [slug, message] of [
        ['nope', /`nope`/],
        ['elsewhere', /`elsewhere`/],
        ['old-auth', /already merged/],
      ] as const) {
        const thrown = await toolCreateFeature(ctx, session, {
          title: 'Billing',
          oneLiner: 'o',
          draft: true,
          dependsOn: [slug],
        }).catch((e: unknown) => e)
        expect(thrown, slug).toBeInstanceOf(InvalidInputError)
        expect((thrown as Error).message, slug).toMatch(message)
      }
      expect(rowCount()).toBe(before)
      expect(ctx.db.select().from(features).where(eq(features.slug, 'billing')).all()).toEqual([])
    } finally {
      rmTemp(otherRepo)
    }
  })

  // --- set_feature_dependencies ---------------------------------------------

  it('set_feature_dependencies replaces a draft’s whole set through the shared service', () => {
    const billing = draft('billing')
    draft('auth-rework')
    draft('ledger')
    setDependencies(ctx, billing.id, [])

    const first = toolSetFeatureDependencies(ctx, session, {
      slug: 'billing',
      dependsOn: ['auth-rework', 'ledger'],
    })
    expect(first).toEqual({
      slug: 'billing',
      dependsOn: [
        { slug: 'auth-rework', satisfied: false },
        { slug: 'ledger', satisfied: false },
      ],
    })

    const second = toolSetFeatureDependencies(ctx, session, { slug: 'billing', dependsOn: ['ledger'] })
    expect(second.dependsOn).toEqual([{ slug: 'ledger', satisfied: false }])
    expect(dependsOnOf(ctx, billing.id).map((d) => d.slug)).toEqual(['ledger'])
    expect(
      listAfter(ctx, billing.id, 0).filter((e) => e.type === 'feature.dependencies.changed'),
    ).not.toHaveLength(0)

    // The service's refusals reach the agent unchanged.
    expect(() =>
      toolSetFeatureDependencies(ctx, session, { slug: 'billing', dependsOn: ['billing'] }),
    ).toThrow(InvalidInputError)
  })

  it('offers and allows set_feature_dependencies to the project session only', async () => {
    expect(toolsForAudience('project')).toContain('set_feature_dependencies')
    for (const kind of ['prepare', 'chat', 'drive-fix', 'run'] as const) {
      expect(toolsForAudience(kind), kind).not.toContain('set_feature_dependencies')
    }

    draft('billing')
    draft('auth-rework')
    const own = seedFeature(ctx, projectId, { slug: 'dark-mode' })
    const chat = createSessionRow(ctx, { featureId: own.id, kind: 'chat', worktreePath: repoPath })
    const prepare = createSessionRow(ctx, { projectId, kind: 'prepare', worktreePath: repoPath })
    for (const [name, caller] of [
      ['chat', chat],
      ['prepare', prepare],
    ] as const) {
      expect(
        () => toolSetFeatureDependencies(ctx, caller, { slug: 'billing', dependsOn: ['auth-rework'] }),
        name,
      ).toThrow(GateError)
    }
  })

  // --- context reads --------------------------------------------------------

  it('get_project_context index lines show each feature’s edges and flag waiting drafts', async () => {
    const auth = seedFeature(ctx, projectId, { slug: 'auth-rework', title: 'Auth rework' })
    const ledger = draft('ledger')
    const billing = draft('billing')
    const reports = draft('reports')
    setDependencies(ctx, billing.id, [auth.id])
    setDependencies(ctx, reports.id, [ledger.id])
    // Once the dependency ships, the edge stays on the line, marked.
    ctx.db
      .update(features)
      .set({ status: 'shipped', phase: 'shipped' })
      .where(eq(features.id, ledger.id))
      .run()

    const out = await toolGetProjectContext(ctx, session)

    expect(out.featureIndex).toContain(
      'billing — Demo feature [draft, waiting] · waits on: auth-rework',
    )
    expect(out.featureIndex).toContain('reports — Demo feature [draft] · waits on: ledger ✓')
    expect(out.featureIndex).toContain('auth-rework — Auth rework [in flight: planning, lap 1]')
    expect(out.featureIndexNote).toContain('waits on')
    expect(out.featureIndexNote).toContain('✓')
    expect(out.featureIndexNote).toContain('waiting')
  })

  it('get_feature_context header carries dependsOn and blocks', () => {
    const auth = seedFeature(ctx, projectId, { slug: 'auth-rework' })
    const billing = draft('billing')
    setDependencies(ctx, billing.id, [auth.id])
    const authSession = createSessionRow(ctx, {
      featureId: auth.id,
      kind: 'chat',
      worktreePath: repoPath,
    })
    const billingSession = createSessionRow(ctx, {
      featureId: billing.id,
      kind: 'chat',
      worktreePath: repoPath,
    })

    const authContext = toolGetFeatureContext(ctx, authSession)
    expect(authContext.dependsOn).toEqual([])
    expect(authContext.blocks).toEqual(['billing'])

    const billingContext = toolGetFeatureContext(ctx, billingSession)
    expect(billingContext.dependsOn).toEqual([{ slug: 'auth-rework', satisfied: false }])
    expect(billingContext.blocks).toEqual([])
  })
})
