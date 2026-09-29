import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PreparedKey, Project } from '@runcastle/core'
import { simpleGit } from 'simple-git'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppCtx } from '../src/db/types'
import type { Containment } from '../src/pty/job-object'
import { recordFinding } from '../src/services/findings'
import {
  __resetTestDriveState,
  createFeatureBranch,
  dryRunDrive,
  projectDrive,
  testDrive,
} from '../src/services/git'
import { openProject } from '../src/services/projects'
import { useDataDir } from './helpers/data-dir'
import { makeTestCtx } from './helpers/db'
import { rmTemp, seedFeature } from './helpers/fixtures'

/**
 * A drive's setup hook runs in a Job Object that is HELD for the drive's life
 * (decision 10): whatever the hook left running in the background — a local
 * Postgres — must survive the hook's own exit and die only once the drive's
 * teardown has finished.
 *
 * Jobs exist on win32 only, so the containment is faked at its one seam. Every
 * hook still runs for real; the fake records, in order, which hook got a job
 * and when each job was killed.
 */

const journal: string[] = []
let jobCount = 0

vi.mock('../src/util/contain-host', () => ({
  containHostProcess: (pid: number): Containment => {
    const job = `job${++jobCount}`
    journal.push(`contain ${job}`)
    let killing: Promise<boolean> | undefined
    return {
      pid,
      kill: () =>
        (killing ??= Promise.resolve().then(() => {
          journal.push(`kill ${job}`)
          return true
        })),
    }
  },
}))

const tmpDirs: string[] = []

function mkTmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tmpDirs.push(dir)
  return dir
}

type DriveKind = 'feature' | 'dry run' | 'project'

describe('the setup hook job lives as long as the drive', () => {
  let ctx: AppCtx
  let repo: string
  let project: Project
  let restoreDataDir: () => void

  beforeEach(async () => {
    journal.length = 0
    jobCount = 0
    restoreDataDir = useDataDir(mkTmp('rc-sj-home-'))
    ctx = await makeTestCtx()
    repo = mkTmp('rc-sj-')
    const g = simpleGit(repo)
    await g.init(['-b', 'main'])
    await g.addConfig('user.email', 'test@runcastle.dev')
    await g.addConfig('user.name', 'Runcastle Test')
    await g.commit('initial commit', { '--allow-empty': null })
    project = await openProject(ctx, repo)
  })

  afterEach(() => {
    __resetTestDriveState()
    restoreDataDir()
    for (const dir of tmpDirs.splice(0)) {
      try {
        rmTemp(dir)
      } catch {
        // best-effort on Windows
      }
    }
  })

  async function configure(key: PreparedKey, value: string): Promise<void> {
    recordFinding(ctx, project.id, { key, value, source: 'human' })
    project = await openProject(ctx, repo)
  }

  /** Start and stop one drive of `kind`, returning the journal as it stood after start. */
  async function driveOnce(kind: DriveKind): Promise<string[]> {
    if (kind === 'feature') {
      const feature = seedFeature(ctx, project.id, { slug: 'jobs' })
      await createFeatureBranch(project, feature.slug, 'main')
      expect((await testDrive(ctx, project, feature, 'start')).ok).toBe(true)
      const afterStart = [...journal]
      expect((await testDrive(ctx, project, feature, 'stop')).ok).toBe(true)
      return afterStart
    }
    const drive = kind === 'dry run' ? dryRunDrive : projectDrive
    expect((await drive(ctx, project, 'start')).ok).toBe(true)
    const afterStart = [...journal]
    expect((await drive(ctx, project, 'stop')).ok).toBe(true)
    return afterStart
  }

  const kinds: DriveKind[] = ['feature', 'dry run', 'project']

  it.each(kinds)('%s drive: held through the drive, killed only after teardown finished', async (kind) => {
    await configure('driveSetupCommand', 'echo up')
    await configure('driveStopCommand', 'echo down')

    const afterStart = await driveOnce(kind)

    // Setup exited, yet its job is still open for as long as the drive runs.
    expect(afterStart).toEqual(['contain job1'])
    // The teardown hook's own job dies with it; the setup job dies after both.
    expect(journal).toEqual(['contain job1', 'contain job2', 'kill job2', 'kill job1'])
  })

  it.each(kinds)('%s drive: killed on stop when no teardown command is configured', async (kind) => {
    await configure('driveSetupCommand', 'echo up')

    const afterStart = await driveOnce(kind)

    expect(afterStart).toEqual(['contain job1'])
    expect(journal).toEqual(['contain job1', 'kill job1'])
  })
})
