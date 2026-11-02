import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Feature, Project } from '@runcastle/core'
import { simpleGit } from 'simple-git'
import type { SimpleGit } from 'simple-git'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import {
  __resetTestDriveState,
  activeDriveInfo,
  createFeatureBranch,
  dryRunDrive,
  mergeFeature,
  projectDrive,
  recoverCutOffDrives,
  testDrive,
} from '../src/services/git'
import { useDataDir } from './helpers/data-dir'
import { makeTestCtx } from './helpers/db'
import { rmTemp, seedFeature, seedProject } from './helpers/fixtures'

/**
 * small-fixes-before-publish decisions 4, 13 and 14: a drive a server restart
 * cut off comes back into its project's slot at boot, named as cut off, and its
 * ordinary Stop runs the stop script and — for a feature drive — returns the
 * checkout to where the drive found it.
 *
 * A restart is simulated by starting a real drive and then wiping the
 * in-memory slot without stopping it: exactly what a dead server leaves behind
 * (the start event, and nothing else).
 */

const tmpDirs: string[] = []

function mkTmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tmpDirs.push(dir)
  return dir
}

async function initRepo(dir: string): Promise<SimpleGit> {
  const g = simpleGit(dir)
  await g.init(['-b', 'main'])
  await g.addConfig('user.email', 'test@runcastle.dev')
  await g.addConfig('user.name', 'Runcastle Test')
  await g.addConfig('core.autocrlf', 'false')
  writeFileSync(join(dir, 'README.md'), 'base\n')
  await g.add(['README.md'])
  await g.commit('initial commit')
  return g
}

const head = async (g: SimpleGit) => (await g.revparse(['--abbrev-ref', 'HEAD'])).trim()

/** The server died: the slot is gone, the events are not. */
const restart = () => __resetTestDriveState()

describe('recoverCutOffDrives', () => {
  let ctx: AppCtx
  let g: SimpleGit
  let project: Project
  let feature: Feature
  let stopped: string
  let restoreDataDir: () => void

  beforeEach(async () => {
    __resetTestDriveState()
    restoreDataDir = useDataDir(mkTmp('rc-cut-home-'))
    ctx = await makeTestCtx()
    const repo = mkTmp('rc-cut-')
    g = await initRepo(repo)
    await g.checkoutLocalBranch('develop')
    stopped = join(mkTmp('rc-cut-out-'), 'stopped')
    // The stop script records that it ran OUTSIDE the repo, so the tree stays clean.
    project = { ...seedProject(ctx, repo), driveStopCommand: `echo stopped > "${stopped}"` }
    feature = seedFeature(ctx, project.id, { slug: 'cut' })
    await createFeatureBranch(project, feature.slug, 'main')
  })

  afterEach(() => {
    __resetTestDriveState()
    restoreDataDir()
    for (const dir of tmpDirs.splice(0)) {
      try {
        rmTemp(dir)
      } catch {
        // best-effort
      }
    }
  })

  it('puts a feature drive back as cut off, and its Stop runs the stop script and returns the checkout', async () => {
    expect((await testDrive(ctx, project, feature, 'start')).ok).toBe(true)
    restart()
    expect(activeDriveInfo(project.id)).toBeNull()

    expect(await recoverCutOffDrives(ctx)).toEqual([project.id])

    expect(activeDriveInfo(project.id)).toMatchObject({
      featureId: feature.id,
      cutOff: true,
      state: 'cut-off',
      branch: 'feature/cut',
      holderLabel: 'a test drive of feature/cut (cut off by a restart)',
    })
    expect(activeDriveInfo(project.id)?.devPaneId).toBeUndefined()

    const stop = await testDrive(ctx, project, feature, 'stop')
    expect(stop).toMatchObject({ ok: true, branch: 'develop' })
    expect(await head(g)).toBe('develop')
    expect(readFileSync(stopped, 'utf8')).toContain('stopped')
    expect(activeDriveInfo(project.id)).toBeNull()
  })

  it('names a cut-off holder in every refusal it causes', async () => {
    const other = seedFeature(ctx, project.id, { slug: 'other' })
    await createFeatureBranch(project, other.slug, 'main')
    expect((await testDrive(ctx, project, feature, 'start')).ok).toBe(true)
    restart()
    await recoverCutOffDrives(ctx)

    const reason = 'A test drive of feature/cut (cut off by a restart) is running — stop it first'
    expect((await testDrive(ctx, project, other, 'start')).deniedReason).toBe(reason)
    expect((await dryRunDrive(ctx, project, 'start')).deniedReason).toBe(reason)
    await expect(mergeFeature(project, other)).rejects.toThrow(
      'Cannot merge while a test drive of feature/cut (cut off by a restart) is running',
    )
  })

  it('leaves a checkout the human moved off the feature branch alone', async () => {
    expect((await testDrive(ctx, project, feature, 'start')).ok).toBe(true)
    restart()
    await g.checkout('main')

    expect(await recoverCutOffDrives(ctx)).toEqual([])
    expect(activeDriveInfo(project.id)).toBeNull()
  })

  it('leaves a feature branch the human checked out by hand alone', async () => {
    expect((await testDrive(ctx, project, feature, 'start')).ok).toBe(true)
    await testDrive(ctx, project, feature, 'stop')
    await g.checkout('feature/cut')

    expect(await recoverCutOffDrives(ctx)).toEqual([])
  })

  it('recovers a cut-off project drive, whose stop runs the script and switches nothing', async () => {
    expect((await projectDrive(ctx, project, 'start')).ok).toBe(true)
    restart()

    await recoverCutOffDrives(ctx)
    expect(activeDriveInfo(project.id)).toMatchObject({
      projectDrive: true,
      cutOff: true,
      holderLabel: 'a project drive of develop (cut off by a restart)',
    })

    expect((await projectDrive(ctx, project, 'stop')).ok).toBe(true)
    expect(readFileSync(stopped, 'utf8')).toContain('stopped')
    expect(await head(g)).toBe('develop')
    expect(activeDriveInfo(project.id)).toBeNull()
  })

  it('recovers a cut-off dry run, whose stop runs the script and switches nothing', async () => {
    expect((await dryRunDrive(ctx, project, 'start')).ok).toBe(true)
    restart()

    await recoverCutOffDrives(ctx)
    expect(activeDriveInfo(project.id)).toMatchObject({ dryRun: true, cutOff: true })

    expect((await dryRunDrive(ctx, project, 'stop')).ok).toBe(true)
    expect(readFileSync(stopped, 'utf8')).toContain('stopped')
    expect(await head(g)).toBe('develop')
    expect(activeDriveInfo(project.id)).toBeNull()
  })

  it('recovers only the newest drive: an older start a later drive outlived is dead', async () => {
    expect((await projectDrive(ctx, project, 'start')).ok).toBe(true)
    restart()
    expect((await testDrive(ctx, project, feature, 'start')).ok).toBe(true)
    await testDrive(ctx, project, feature, 'stop')

    expect(await recoverCutOffDrives(ctx)).toEqual([])
  })
})
