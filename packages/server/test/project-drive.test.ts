import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PreparedKey, Project } from '@runcastle/core'
import { simpleGit } from 'simple-git'
import type { SimpleGit } from 'simple-git'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { createSessionRow } from '../src/launcher/sessions'
import { toolListProjectNotes } from '../src/mcp/server'
import { createNativePtySession } from '../src/pty/pty'
import { listByProject } from '../src/services/events'
import { recordFinding } from '../src/services/findings'
import {
  __resetTestDriveState,
  activeDriveInfo,
  createFeatureBranch,
  dryRunDrive,
  projectDrive,
  reviewDrive,
  testDrive,
} from '../src/services/git'
import { addNote } from '../src/services/project-notes'
import { openProject } from '../src/services/projects'
import { getFeatureRow } from '../src/services/repo'
import { createCallerFactory } from '../src/trpc/context'
import { appRouter } from '../src/trpc/router'
import { useDataDir } from './helpers/data-dir'
import { makeTestCtx } from './helpers/db'
import { rmTemp, seedFeature } from './helpers/fixtures'

/**
 * The project drive (project-level-test-drive): the project's checkout driven
 * as it is, in the one drive slot, observed through the service, the tRPC
 * mutation, the notes it stamps and the merge it steps aside for.
 *
 * Real git and real hooks, as the dry-run suite does; hook commands are spelled
 * for whichever shell hosts them, and anything they record is written OUTSIDE
 * the repo so the working tree stays exactly as the test left it.
 */

const WIN = process.platform === 'win32'
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

/** A hook that writes the drive identity it received, plus `DB_NAME`, to `file`. */
function captureEnv(file: string): string {
  return WIN
    ? `echo %RUNCASTLE_SLUG% %RUNCASTLE_ID% %RUNCASTLE_BRANCH% %DB_NAME%> "${file}"`
    : `echo "$RUNCASTLE_SLUG $RUNCASTLE_ID $RUNCASTLE_BRANCH $DB_NAME" > "${file}"`
}

/** A setup hook that records its identity to `file`, then writes `drive.env`. */
function setupCommand(file: string): string {
  const envFile = join('.runcastle', 'drive.env')
  return WIN
    ? `${captureEnv(file)} & mkdir .runcastle & echo DB_NAME=app_%RUNCASTLE_ID%> "${envFile}"`
    : `${captureEnv(file)} && mkdir -p .runcastle && echo "DB_NAME=app_$RUNCASTLE_ID" > "${envFile}"`
}

function ptyAvailable(): boolean {
  try {
    const p = createNativePtySession('/bin/sh', ['-c', 'true'], {
      cwd: process.cwd(),
      env: process.env,
    })
    p.kill()
    return true
  } catch {
    return false
  }
}
const PTY = !WIN && ptyAvailable()

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

describe('the project drive', () => {
  let ctx: AppCtx
  let repo: string
  let g: SimpleGit
  let project: Project
  let out: string
  let restoreDataDir: () => void

  beforeEach(async () => {
    // Merge writes into the feature's talk worktree under the data dir.
    restoreDataDir = useDataDir(mkTmp('rc-pd-home-'))
    ctx = await makeTestCtx()
    repo = mkTmp('rc-pd-')
    g = await initRepo(repo)
    project = await openProject(ctx, repo)
    out = mkTmp('rc-pd-out-')
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

  /** Set a drive key on the project row the way preparation does, and reload it. */
  async function configure(key: PreparedKey, value: string): Promise<void> {
    recordFinding(ctx, project.id, { key, value, source: 'human' })
    project = await openProject(ctx, repo)
  }

  function caller() {
    return createCallerFactory(appRouter)(ctx)
  }

  async function head(): Promise<string> {
    return (await g.revparse(['HEAD'])).trim()
  }

  async function shortHead(): Promise<string> {
    return (await g.revparse(['--short', 'HEAD'])).trim()
  }

  function eventTypes(): string[] {
    return listByProject(ctx, project.id, 0).map((e) => e.type)
  }

  // --- start / stop ------------------------------------------------------------

  it('drives the checkout as it is: project-drive identity, real branch, HEAD and tree untouched', async () => {
    await g.checkoutLocalBranch('topic')
    writeFileSync(join(repo, 'README.md'), 'uncommitted edit\n')
    const before = await head()
    const identity = join(out, 'setup.txt')
    await configure('driveSetupCommand', setupCommand(identity))

    const start = await caller().project.testDrive({ projectId: project.id, action: 'start' })

    expect(start).toMatchObject({ ok: true, branch: 'topic' })
    expect(readFileSync(identity, 'utf8').trim()).toBe('project-drive project_drive topic')
    expect(await head()).toBe(before)
    expect((await g.revparse(['--abbrev-ref', 'HEAD'])).trim()).toBe('topic')
    expect(readFileSync(join(repo, 'README.md'), 'utf8')).toBe('uncommitted edit\n')
    expect(eventTypes()).toContain('projectdrive.started')
  })

  it('reports itself through driveInfo: kind, project, branch, commit, start time, holder', async () => {
    const t0 = Date.now()
    await projectDrive(ctx, project, 'start')

    const info = await caller().feature.driveInfo()
    expect(info).toMatchObject({
      projectDrive: true,
      projectId: project.id,
      branch: 'main',
      commit: await shortHead(),
      devConfigured: false,
      holderLabel: 'a project drive of main',
      state: 'bare-checkout',
    })
    expect(info?.startedAt).toBeGreaterThanOrEqual(t0)
    expect(info).not.toHaveProperty('dryRun')
    expect(info).not.toHaveProperty('featureId')
  })

  it('suffixes the commit with +dirty when the tree has uncommitted changes', async () => {
    writeFileSync(join(repo, 'scratch.txt'), 'untracked\n')

    await projectDrive(ctx, project, 'start')

    expect(activeDriveInfo()?.commit).toBe(`${await shortHead()}+dirty`)
  })

  it('carries a failed setup on the drive, and keeps the drive up', async () => {
    await configure('driveSetupCommand', 'exit 3')

    const start = await projectDrive(ctx, project, 'start')

    expect(start.ok).toBe(true)
    expect(start.hookFailure).toMatchObject({ phase: 'setup', exitCode: 3 })
    expect(activeDriveInfo()).toMatchObject({
      projectDrive: true,
      state: 'setup-failed',
      hookFailure: { phase: 'setup', command: 'exit 3', exitCode: 3 },
    })
  })

  it('stops with the same identity and drive.env values, removes drive.env, frees the slot', async () => {
    const teardown = join(out, 'stop.txt')
    await configure('driveSetupCommand', setupCommand(join(out, 'setup.txt')))
    await configure('driveStopCommand', captureEnv(teardown))
    await g.checkoutLocalBranch('topic')

    await projectDrive(ctx, project, 'start')
    expect(existsSync(join(repo, '.runcastle', 'drive.env'))).toBe(true)
    const stop = await caller().project.testDrive({ projectId: project.id, action: 'stop' })

    expect(stop).toMatchObject({ ok: true, branch: 'topic' })
    expect(readFileSync(teardown, 'utf8').trim()).toBe(
      'project-drive project_drive topic app_project_drive',
    )
    expect(existsSync(join(repo, '.runcastle', 'drive.env'))).toBe(false)
    expect((await g.revparse(['--abbrev-ref', 'HEAD'])).trim()).toBe('topic')
    expect(activeDriveInfo()).toBeNull()
    expect(eventTypes()).toContain('projectdrive.stopped')
  })

  it('refuses a stop when this project has no drive running', async () => {
    expect(await projectDrive(ctx, project, 'stop')).toMatchObject({
      ok: false,
      deniedReason: 'No project drive is running for this project',
    })
  })

  it.runIf(PTY)('overlays drive.env into the dev pane', async () => {
    const seen = join(out, 'dev.txt')
    await configure('driveSetupCommand', setupCommand(join(out, 'setup.txt')))
    await configure('devCommand', `${captureEnv(seen)}; sleep 30`)

    await projectDrive(ctx, project, 'start')
    expect(activeDriveInfo()).toMatchObject({ devConfigured: true })
    expect(activeDriveInfo()?.devPaneId).toBeDefined()
    for (let i = 0; i < 100 && !existsSync(seen); i++) await delay(20)
    await delay(50)

    expect(readFileSync(seen, 'utf8').trim()).toBe(
      'project-drive project_drive main app_project_drive',
    )
    await projectDrive(ctx, project, 'stop')
  })

  // --- the one slot --------------------------------------------------------------

  it('holds the slot against feature, review and dry-run starts, naming itself', async () => {
    const feature = seedFeature(ctx, project.id, { slug: 'drive' })
    await createFeatureBranch(project, feature.slug, 'main')
    await projectDrive(ctx, project, 'start')
    const reason = 'A project drive of main is running — stop it first'

    const human = await testDrive(ctx, project, feature, 'start')
    expect(human).toMatchObject({ ok: false, deniedReason: reason, deniedCode: 'slot_held', retriable: true })

    const review = await reviewDrive(ctx, project, feature, 'start')
    expect(review).toMatchObject({ ok: false, deniedReason: reason, deniedCode: 'slot_held', retriable: true })

    const dry = await dryRunDrive(ctx, project, 'start')
    expect(dry).toMatchObject({ ok: false, deniedReason: reason })

    // Nothing but `projectDrive` ends it.
    expect(await testDrive(ctx, project, feature, 'stop')).toMatchObject({ ok: false, deniedReason: reason })
    expect(activeDriveInfo()?.projectDrive).toBe(true)
  })

  it('is refused while another drive holds the slot, naming that holder', async () => {
    const feature = seedFeature(ctx, project.id, { slug: 'drive' })
    await createFeatureBranch(project, feature.slug, 'main')
    expect((await testDrive(ctx, project, feature, 'start')).ok).toBe(true)
    expect(activeDriveInfo()?.holderLabel).toBe('a test drive of feature/drive')

    expect(await projectDrive(ctx, project, 'start')).toMatchObject({
      ok: false,
      deniedReason: 'A test drive of feature/drive is running — stop it first',
      deniedCode: 'slot_held',
      retriable: true,
    })
    await testDrive(ctx, project, feature, 'stop')

    await dryRunDrive(ctx, project, 'start')
    expect(activeDriveInfo()?.holderLabel).toBe('a preparation dry-run')
    expect(await projectDrive(ctx, project, 'start')).toMatchObject({
      ok: false,
      deniedReason: 'A preparation dry-run is running — stop it first',
    })
  })

  // --- merge ---------------------------------------------------------------------

  async function landableFeature(slug: string) {
    await createFeatureBranch(project, slug, 'main')
    await g.checkout(`feature/${slug}`)
    writeFileSync(join(repo, `${slug}.txt`), 'work\n')
    await g.add([`${slug}.txt`])
    await g.commit('feat: work')
    await g.checkout('main')
    return seedFeature(ctx, project.id, { slug, phase: 'review' })
  }

  it('merge stops a live project drive of the same project, then lands', async () => {
    const feature = await landableFeature('happy')
    const teardown = join(out, 'stop.txt')
    await configure('driveStopCommand', captureEnv(teardown))
    await projectDrive(ctx, project, 'start')

    const res = await caller().feature.merge({ featureId: feature.id })

    expect(res.ok).toBe(true)
    expect(existsSync(teardown)).toBe(true)
    expect(activeDriveInfo()).toBeNull()
    expect(getFeatureRow(ctx, feature.id).phase).toBe('shipped')
  }, 20_000)

  it('merge is still refused while a DIFFERENT feature is being driven', async () => {
    const feature = await landableFeature('happy')
    const other = seedFeature(ctx, project.id, { slug: 'other' })
    await createFeatureBranch(project, other.slug, 'main')
    expect((await testDrive(ctx, project, other, 'start')).ok).toBe(true)

    await expect(caller().feature.merge({ featureId: feature.id })).rejects.toThrow(
      /test drive is active/,
    )
  }, 20_000)

  // --- notes stamping --------------------------------------------------------------

  it('stamps notes taken during this project drive, through every create path', async () => {
    const before = addNote(ctx, project.id, 'before the drive')
    writeFileSync(join(repo, 'scratch.txt'), 'dirty\n')
    await projectDrive(ctx, project, 'start')
    const commit = `${await shortHead()}+dirty`

    const direct = addNote(ctx, project.id, 'noticed in service')
    const viaTrpc = await caller().projectNotes.add({ projectId: project.id, text: 'noticed in ui' })
    await projectDrive(ctx, project, 'stop')
    const after = addNote(ctx, project.id, 'after the drive')

    expect(direct).toMatchObject({ driveBranch: 'main', driveCommit: commit })
    expect(viaTrpc).toMatchObject({ driveBranch: 'main', driveCommit: commit })
    for (const note of [before, after]) {
      expect(note.driveBranch).toBeUndefined()
      expect(note.driveCommit).toBeUndefined()
    }
    const listed = await caller().projectNotes.list({ projectId: project.id })
    expect(listed.find((n) => n.id === direct.id)).toMatchObject({ driveBranch: 'main', driveCommit: commit })

    const session = createSessionRow(ctx, { projectId: project.id, kind: 'project', worktreePath: repo })
    const items = toolListProjectNotes(ctx, session)
    expect(items.find((n) => n.id === viaTrpc.id)).toMatchObject({ driveBranch: 'main', driveCommit: commit })
    expect(items.find((n) => n.id === before.id)).not.toHaveProperty('driveBranch')
  })

  it('stamps nothing during a feature drive or another project’s drive', async () => {
    const otherRepo = mkTmp('rc-pd-other-')
    await initRepo(otherRepo)
    const other = await openProject(ctx, otherRepo)
    await projectDrive(ctx, other, 'start')
    const duringOther = addNote(ctx, project.id, 'other project driving')
    await projectDrive(ctx, other, 'stop')

    const feature = seedFeature(ctx, project.id, { slug: 'drive' })
    await createFeatureBranch(project, feature.slug, 'main')
    await testDrive(ctx, project, feature, 'start')
    const duringFeature = addNote(ctx, project.id, 'feature driving')

    for (const note of [duringOther, duringFeature]) {
      expect(note.driveBranch).toBeUndefined()
      expect(note.driveCommit).toBeUndefined()
    }
  })
})
