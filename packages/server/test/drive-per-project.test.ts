import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Feature, Project } from '@runcastle/core'
import { simpleGit } from 'simple-git'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import {
  __resetTestDriveState,
  __setAppReadinessTiming,
  activeDriveInfo,
  activeTestDriveFeatureId,
  createFeatureBranch,
  dryRunDrive,
  projectDrive,
  recordDriveUrl,
  releaseReviewDrive,
  reviewDrive,
  testDrive,
} from '../src/services/git'
import { prepView } from '../src/services/prep'
import { createCallerFactory } from '../src/trpc/context'
import { appRouter } from '../src/trpc/router'
import { makeTestCtx } from './helpers/db'
import { seedFeature, seedProject } from './helpers/fixtures'

/**
 * One drive slot per project (ADR-0014): a drive of any kind in one project
 * never blocks, hides or ends a drive in another. Two real repos, two projects.
 */

const tmpDirs: string[] = []
const servers: Server[] = []

function mkTmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tmpDirs.push(dir)
  return dir
}

/** git init -b main + local identity + autocrlf false + one seed commit. */
async function initRepo(dir: string): Promise<void> {
  const g = simpleGit(dir)
  await g.init(['-b', 'main'])
  await g.addConfig('user.email', 'test@runcastle.dev')
  await g.addConfig('user.name', 'Runcastle Test')
  await g.addConfig('core.autocrlf', 'false')
  writeFileSync(join(dir, 'README.md'), 'base\n')
  await g.add(['README.md'])
  await g.commit('initial commit')
}

/** A project in its own fresh repo, with one feature branched off main. */
async function seedDrivable(ctx: AppCtx, slug: string): Promise<{ project: Project; feature: Feature }> {
  const repo = mkTmp(`rc-per-project-${slug}-`)
  await initRepo(repo)
  const project = seedProject(ctx, repo)
  const feature = seedFeature(ctx, project.id, { slug })
  await createFeatureBranch(project, feature.slug, 'main')
  return { project, feature }
}

async function freePort(): Promise<number> {
  const probe = createServer()
  await new Promise<void>((r) => probe.listen(0, '127.0.0.1', () => r()))
  const port = (probe.address() as AddressInfo).port
  await new Promise<void>((r) => probe.close(() => r()))
  return port
}

async function serve(port: number): Promise<void> {
  const server = createServer((_req, res) => {
    res.writeHead(200)
    res.end('ok')
  })
  servers.push(server)
  await new Promise<void>((r) => server.listen(port, '127.0.0.1', () => r()))
}

async function waitFor(fn: () => boolean, tries = 200): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (fn()) return
    await new Promise((r) => setTimeout(r, 10))
  }
  throw new Error('waitFor timed out')
}

const branchOf = async (project: Project): Promise<string> =>
  (await simpleGit(project.repoPath).revparse(['--abbrev-ref', 'HEAD'])).trim()

type DriveKind = 'human' | 'review' | 'project' | 'dryRun'

/** Start or stop one kind of drive, reporting only whether the server took it. */
async function drive(
  ctx: AppCtx,
  kind: DriveKind,
  action: 'start' | 'stop',
  { project, feature }: { project: Project; feature: Feature },
): Promise<boolean> {
  switch (kind) {
    case 'human':
      return (await testDrive(ctx, project, feature, action)).ok
    case 'review':
      return (await reviewDrive(ctx, project, feature, action)).ok
    case 'project':
      return (await projectDrive(ctx, project, action)).ok
    case 'dryRun':
      return (await dryRunDrive(ctx, project, action)).ok
  }
}

const KINDS: DriveKind[] = ['human', 'review', 'project', 'dryRun']

describe('one drive slot per project', () => {
  let ctx: AppCtx
  let a: { project: Project; feature: Feature }
  let b: { project: Project; feature: Feature }

  beforeEach(async () => {
    __resetTestDriveState()
    ctx = await makeTestCtx()
    a = await seedDrivable(ctx, 'alpha')
    b = await seedDrivable(ctx, 'beta')
  })

  afterEach(async () => {
    __resetTestDriveState()
    __setAppReadinessTiming(undefined)
    await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))))
    for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  it.each(KINDS)('every kind of drive starts in B while %s drive holds A', async (holder) => {
    expect(await drive(ctx, holder, 'start', a)).toBe(true)
    const held = activeDriveInfo(a.project.id)
    expect(held).not.toBeNull()

    for (const kind of KINDS) {
      expect(await drive(ctx, kind, 'start', b), `${kind} in B`).toBe(true)
      expect(activeDriveInfo(b.project.id)).not.toBeNull()
      expect(await drive(ctx, kind, 'stop', b), `${kind} stop in B`).toBe(true)
      expect(activeDriveInfo(b.project.id)).toBeNull()
      // A's drive never noticed.
      expect(activeDriveInfo(a.project.id)).toEqual(held)
    }

    expect(await drive(ctx, holder, 'stop', a)).toBe(true)
    expect(activeDriveInfo(a.project.id)).toBeNull()
  })

  it("each project's info reports only its own drive", async () => {
    await testDrive(ctx, a.project, a.feature, 'start')
    await projectDrive(ctx, b.project, 'start')

    expect(activeDriveInfo(a.project.id)).toMatchObject({ featureId: a.feature.id, purpose: 'human' })
    expect(activeDriveInfo(b.project.id)).toMatchObject({ projectDrive: true, projectId: b.project.id })
    expect(activeTestDriveFeatureId(a.project.id)).toBe(a.feature.id)
    expect(activeTestDriveFeatureId(b.project.id)).toBeUndefined()
    // Each drive switched only its own checkout.
    expect(await branchOf(a.project)).toBe('feature/alpha')
    expect(await branchOf(b.project)).toBe('main')
  })

  it('feature.driveInfo answers per project and refuses a call without one', async () => {
    const caller = createCallerFactory(appRouter)(ctx)
    await testDrive(ctx, a.project, a.feature, 'start')

    expect(await caller.feature.driveInfo({ projectId: a.project.id })).toMatchObject({
      featureId: a.feature.id,
    })
    expect(await caller.feature.driveInfo({ projectId: b.project.id })).toBeNull()
    // @ts-expect-error — the project id is required: there is no global view.
    await expect(caller.feature.driveInfo()).rejects.toThrow()
  })

  it("stopping B's drive leaves A's dev URL and its readiness poll intact", async () => {
    __setAppReadinessTiming({ intervalMs: 10, budgetMs: 10_000 })
    const port = await freePort()
    const url = `http://127.0.0.1:${port}/`

    await testDrive(ctx, a.project, a.feature, 'start')
    recordDriveUrl(ctx, a.project.id, a.feature.id, url)
    expect(activeDriveInfo(a.project.id)).toMatchObject({ devUrl: url, devReady: false })

    // B starts and stops a drive while A's poll is still waiting for an answer.
    expect((await projectDrive(ctx, b.project, 'start')).ok).toBe(true)
    expect((await projectDrive(ctx, b.project, 'stop')).ok).toBe(true)

    await serve(port)
    await waitFor(() => activeDriveInfo(a.project.id)?.devReady === true)
    expect(activeDriveInfo(a.project.id)?.devUrl).toBe(url)
  })

  it("two review drives in two projects are each released by their own project's releaser", async () => {
    expect((await reviewDrive(ctx, a.project, a.feature, 'start')).ok).toBe(true)
    expect((await reviewDrive(ctx, b.project, b.feature, 'start')).ok).toBe(true)

    await releaseReviewDrive(b.project.id)
    expect(activeDriveInfo(b.project.id)).toBeNull()
    expect(await branchOf(b.project)).toBe('main')
    expect(activeDriveInfo(a.project.id)).toMatchObject({ featureId: a.feature.id, purpose: 'review' })
    expect(await branchOf(a.project)).toBe('feature/alpha')

    await releaseReviewDrive(a.project.id)
    expect(activeDriveInfo(a.project.id)).toBeNull()
    expect(await branchOf(a.project)).toBe('main')
  })

  it("prepView reports only this project's dry run", async () => {
    expect((await dryRunDrive(ctx, a.project, 'start')).ok).toBe(true)

    expect((await prepView(ctx, a.project)).dryRun).toMatchObject({ dryRun: true })
    expect((await prepView(ctx, b.project)).dryRun).toBeNull()
  })
})
