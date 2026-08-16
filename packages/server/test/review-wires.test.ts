import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Feature, Project, Run, RunStatus, SessionRow } from '@runcastle/core'
import { newId } from '@runcastle/core'
import { simpleGit } from 'simple-git'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runs } from '../src/db/schema'
import type { AppCtx } from '../src/db/types'
import { GateError } from '../src/errors'
import { createSessionRow } from '../src/launcher/sessions'
import { toolAddTestNote, toolReviewDrive } from '../src/mcp/server'
import { createNativePtySession } from '../src/pty/pty'
import { listAfter } from '../src/services/events'
import { recordFinding } from '../src/services/findings'
import {
  __resetTestDriveState,
  activeDriveInfo,
  createFeatureBranch,
  testDrive,
} from '../src/services/git'
import { openProject } from '../src/services/projects'
import { rowToRun } from '../src/services/repo'
import { addNote, listByFeature as listNotes, promoteNote } from '../src/services/test-notes'
import { listByFeature as listTickets } from '../src/services/tickets'
import { createCallerFactory } from '../src/trpc/context'
import { appRouter } from '../src/trpc/router'
import { makeTestCtx } from './helpers/db'
import { seedFeature } from './helpers/fixtures'

/**
 * The two wires a review ticket calls (improve-workflow seams 3 and 4), tested
 * where the review agent meets them: the `review_drive` and `add_test_note` MCP
 * tools.
 *
 * Real git and the real drive slot, the way `dry-run-drive.test.ts` does it —
 * the whole point of the review drive is that it moves the human's actual
 * checkout, so a re-enactment would prove nothing about the carve-out.
 */

const tmpDirs: string[] = []

function mkTmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tmpDirs.push(dir)
  return dir
}

/** git init -b main + local identity + one seed commit — enough to be a project. */
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

/** Probe whether node-pty can spawn here (CI without prebuilds cannot). */
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
const PTY = process.platform !== 'win32' && ptyAvailable()

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

describe('the review agent wires', () => {
  let ctx: AppCtx
  let repo: string
  let project: Project
  let feature: Feature
  let run: Run

  beforeEach(async () => {
    ctx = await makeTestCtx()
    repo = mkTmp('rc-review-')
    await initRepo(repo)
    project = await openProject(ctx, repo)
    feature = seedFeature(ctx, project.id, { slug: 'reviewed', phase: 'implementation' })
    await createFeatureBranch(project, feature.slug)
    // A review ticket only ever burns inside its own run, so that run is the
    // identity every call below arrives with.
    run = seedRun('running')
  })

  afterEach(() => {
    __resetTestDriveState()
    for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  function seedRun(status: RunStatus): Run {
    const row = ctx.db
      .insert(runs)
      .values({
        id: newId('run'),
        featureId: feature.id,
        workflow: 'ticket-burner',
        status,
        startedAt: Date.now(),
      })
      .returning()
      .get()
    return rowToRun(row)
  }

  /** A call arriving under the run identity — what the runner will send. */
  function drive(
    action: 'start' | 'status' | 'stop',
    runId = run.id,
  ): Promise<Awaited<ReturnType<typeof toolReviewDrive>>> {
    return toolReviewDrive(ctx, { runId }, { action })
  }

  function talkSession(): SessionRow {
    return createSessionRow(ctx, {
      featureId: feature.id,
      kind: 'revisit',
      worktreePath: repo,
    })
  }

  async function currentBranch(): Promise<string> {
    return (await simpleGit(repo).revparse(['--abbrev-ref', 'HEAD'])).trim()
  }

  function events(): { type: string; data?: unknown }[] {
    return listAfter(ctx, feature.id)
  }

  // --- the carve-out: what a review-purpose start may and may not have -------

  it('starts on the feature branch while the run that launched it is still active', async () => {
    // The carve-out is the review's alone: with the same run active and the
    // slot free, the human clicking Test drive is still refused — that is the
    // one guard a review-purpose start waives.
    expect(await testDrive(ctx, project, feature, 'start')).toMatchObject({
      ok: false,
      deniedReason: 'Feature has an active run — wait for it to finish',
    })

    const start = await drive('start')

    expect(start).toMatchObject({ ok: true, action: 'start' })
    // `purpose` is what stops every drive surface calling this a test drive.
    expect(start.drive).toMatchObject({
      featureId: feature.id,
      purpose: 'review',
      branch: 'feature/reviewed',
    })
    expect(await currentBranch()).toBe('feature/reviewed')

    const stop = await drive('stop')
    expect(stop).toMatchObject({ ok: true, drive: null })
    expect(await currentBranch()).toBe('main')
    expect(activeDriveInfo()).toBeNull()
  })

  it('tells the wire the UI polls that a review agent — not a human — is driving', async () => {
    await drive('start')

    const driveInfo = await createCallerFactory(appRouter)(ctx).feature.driveInfo()
    expect(driveInfo).toMatchObject({ featureId: feature.id, purpose: 'review' })

    await drive('stop')
    expect(await createCallerFactory(appRouter)(ctx).feature.driveInfo()).toBeNull()
  })

  it('still denies a dirty tree, and leaves the checkout where it was', async () => {
    writeFileSync(join(repo, 'scratch.txt'), 'uncommitted\n')

    const start = await drive('start')

    expect(start).toMatchObject({
      ok: false,
      deniedReason: 'Working tree has uncommitted changes — commit or stash first',
      drive: null,
    })
    expect(await currentBranch()).toBe('main')
    expect(activeDriveInfo()).toBeNull()
  })

  it('fails fast when the human holds the drive slot, and never touches their drive', async () => {
    // No run yet — the human started their drive the ordinary way.
    ctx.db.delete(runs).run()
    expect((await testDrive(ctx, project, feature, 'start')).ok).toBe(true)
    const held = activeDriveInfo()

    const start = await drive('start', seedRun('running').id)

    expect(start).toMatchObject({
      ok: false,
      deniedReason: 'A test drive is already active — stop it first',
    })
    // Fail fast means the human's drive is exactly as it was, right now.
    expect(activeDriveInfo()).toEqual(held)

    await testDrive(ctx, project, feature, 'stop')
  })

  it('refuses to stop or inspect a drive that is not its own', async () => {
    ctx.db.delete(runs).run()
    await testDrive(ctx, project, feature, 'start')
    const humanRun = seedRun('running')

    expect(await drive('stop', humanRun.id)).toMatchObject({
      ok: false,
      deniedReason: 'No review drive is in progress for this feature',
    })
    expect(await drive('status', humanRun.id)).toMatchObject({
      ok: false,
      deniedReason: 'No review drive is in progress for this feature',
    })
    // The human's drive is still up — the refusal cost them nothing.
    expect(activeDriveInfo()).toMatchObject({ featureId: feature.id })

    await testDrive(ctx, project, feature, 'stop')
  })

  it('lets the human reclaim the slot from a review drive the agent left behind', async () => {
    await drive('start')

    const stop = await testDrive(ctx, project, feature, 'stop')

    expect(stop.ok).toBe(true)
    expect(await currentBranch()).toBe('main')
    expect(activeDriveInfo()).toBeNull()
    expect(events().map((e) => e.type)).toContain('testdrive.stopped')
  })

  // --- status, which is where the URL arrives -------------------------------

  it('reports no URL when the project has no dev command', async () => {
    await drive('start')

    const status = await drive('status')
    expect(status).toMatchObject({ ok: true, action: 'status' })
    expect(status.drive).toMatchObject({ devConfigured: false })
    expect(status.drive?.devUrl).toBeUndefined()

    await drive('stop')
  })

  it.runIf(PTY)('hands back the dev URL once the dev server prints one', async () => {
    recordFinding(ctx, project.id, {
      key: 'devCommand',
      value: 'echo "  Local:   http://localhost:5173/"; sleep 30',
      source: 'session',
    })

    await drive('start')
    // The sniff is asynchronous — the pane has to print the line first.
    await delay(1200)

    const status = await drive('status')
    expect(status.drive?.devUrl).toBe('http://localhost:5173/')

    await drive('stop')
  }, 15000)

  // --- who may call them ----------------------------------------------------

  it('refuses an ordinary talk session, which carries no run identity', async () => {
    const session = talkSession()

    await expect(toolReviewDrive(ctx, { session }, { action: 'start' })).rejects.toThrow(GateError)
    await expect(toolReviewDrive(ctx, { session }, { action: 'start' })).rejects.toThrow(
      /revisit session/,
    )
    expect(() => toolAddTestNote(ctx, { session }, { text: 'nope' })).toThrow(GateError)

    expect(activeDriveInfo()).toBeNull()
    expect(listNotes(ctx, feature.id)).toEqual([])
  })

  it('refuses a run identity whose run has already finished', async () => {
    const finished = seedRun('succeeded')

    await expect(toolReviewDrive(ctx, { runId: finished.id }, { action: 'start' })).rejects.toThrow(
      /no run identity/,
    )
    expect(() => toolAddTestNote(ctx, { runId: finished.id }, { text: 'nope' })).toThrow(GateError)
    expect(activeDriveInfo()).toBeNull()
  })

  // --- the notes wire -------------------------------------------------------

  it('appends an agent-attributed note to the notes, the doc and the event stream', () => {
    const note = toolAddTestNote(ctx, { runId: run.id }, { text: 'the empty state renders twice' })

    expect(note).toMatchObject({
      author: 'agent',
      status: 'open',
      lap: 1,
      text: 'the empty state renders twice',
    })
    expect(listNotes(ctx, feature.id)).toEqual([note])
    expect(
      readFileSync(join(repo, 'docs', 'features', 'reviewed', 'test-notes.md'), 'utf8'),
    ).toContain('- [ ] the empty state renders twice')

    const added = events().find((e) => e.type === 'note.added')
    expect(added?.data).toMatchObject({ noteId: note.id, author: 'agent' })
  })

  it('leaves the human note flow alone and promotes an agent note unchanged', () => {
    const human = addNote(ctx, feature.id, 'the header wraps at 400px')
    expect(human.author).toBe('human')

    const agent = toolAddTestNote(ctx, { runId: run.id }, { text: 'saving twice duplicates a row' })
    const { note, ticket } = promoteNote(ctx, agent.id)

    // Attribution survives promotion, and the fix ticket is the ordinary one.
    expect(note).toMatchObject({ author: 'agent', status: 'promoted', ticketId: ticket.id })
    expect(ticket).toMatchObject({
      title: 'saving twice duplicates a row',
      status: 'pending',
      kind: 'implementation',
    })
    expect(listTickets(ctx, feature.id)).toHaveLength(1)
    expect(listNotes(ctx, feature.id).map((n) => n.author)).toEqual(['human', 'agent'])
  })
})
