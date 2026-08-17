import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PreparedKey, Project, SessionRow } from '@runcastle/core'
import { simpleGit } from 'simple-git'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { GateError } from '../src/errors'
import { createSessionRow } from '../src/launcher/sessions'
import { toolDryRunDrive } from '../src/mcp/server'
import { createNativePtySession } from '../src/pty/pty'
import { ptyRegistry } from '../src/pty/registry'
import { listByProject } from '../src/services/events'
import { listFindings, recordFinding } from '../src/services/findings'
import {
  __resetTestDriveState,
  activeDriveInfo,
  createFeatureBranch,
  recordDryRunUrl,
  testDrive,
} from '../src/services/git'
import { prepView } from '../src/services/prep'
import { openProject } from '../src/services/projects'
import { createCallerFactory } from '../src/trpc/context'
import { appRouter } from '../src/trpc/router'
import { makeTestCtx } from './helpers/db'
import { seedFeature } from './helpers/fixtures'

/**
 * The preparation dry-run drive, tested where a prep session actually meets it:
 * the `dry_run_drive` MCP tool.
 *
 * The machinery underneath is the real one — real git, real hooks in a real
 * shell, the real drive slot — because the whole premise of the feature is that
 * a re-enactment proves nothing. Hook commands are spelled for whichever shell
 * hosts them, the way `drive-hooks.test.ts` does, and the dev pane is gated on
 * the native PTY addon loading in this runtime.
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

/**
 * A setup command that plays the setup script's half of the contract: write one
 * `KEY=VALUE` line to `.runcastle/drive.env`. Spelled for whichever shell hosts
 * it, so `$RUNCASTLE_ID` in the line becomes `%RUNCASTLE_ID%` on cmd.
 */
function writeDriveEnv(line: string): string {
  const file = join('.runcastle', 'drive.env')
  return process.platform === 'win32'
    ? `mkdir .runcastle & echo ${line.replace(/\$([A-Z_]+)/g, '%$1%')}> "${file}"`
    : `mkdir -p .runcastle && echo "${line}" > "${file}"`
}

/** The worked example: a database name derived from the identity the server passed. */
const WRITE_DB_NAME = writeDriveEnv('DB_NAME=myapp_$RUNCASTLE_ID')

/** Write the overlaid `DB_NAME` to a file, spelled for the hosting shell. */
const CAPTURE_DB_NAME =
  process.platform === 'win32' ? 'echo %DB_NAME%>db-name.txt' : 'echo "$DB_NAME" > db-name.txt'

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

describe('the preparation dry-run drive', () => {
  let ctx: AppCtx
  let repo: string
  let project: Project
  let session: SessionRow

  beforeEach(async () => {
    ctx = await makeTestCtx()
    repo = mkTmp('rc-dryrun-')
    await initRepo(repo)
    project = await openProject(ctx, repo)
    session = createSessionRow(ctx, { projectId: project.id, kind: 'prepare', worktreePath: repo })
  })

  afterEach(() => {
    __resetTestDriveState()
    for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  /** Establish a prepared value the way `record_finding` does — row included. */
  function record(key: PreparedKey, value: string): void {
    recordFinding(ctx, project.id, { key, value, source: 'session' })
  }

  function drive(action: 'start' | 'status' | 'stop'): Promise<
    Awaited<ReturnType<typeof toolDryRunDrive>>
  > {
    return toolDryRunDrive(ctx, session, { action })
  }

  async function currentBranch(): Promise<string> {
    return (await simpleGit(repo).revparse(['--abbrev-ref', 'HEAD'])).trim()
  }

  function eventTypes(): string[] {
    return listByProject(ctx, project.id, 0).map((e) => e.type)
  }

  async function verifiedKeys(): Promise<PreparedKey[]> {
    const findings = await listFindings(ctx, project)
    return findings.filter((f) => f.verifiedAt !== undefined).map((f) => f.key)
  }

  // --- the start half --------------------------------------------------------

  it('runs setup under the prep-dry-run identity and overlays what it wrote, switching nothing', async () => {
    record('driveSetupCommand', WRITE_DB_NAME)
    record('driveStopCommand', CAPTURE_DB_NAME)

    const start = await drive('start')

    expect(start.ok).toBe(true)
    expect(start.identity).toEqual({ slug: 'prep-dry-run', branch: 'main' })
    expect(start.envKeys).toEqual(['DB_NAME'])
    expect(start.setup).toMatchObject({ command: WRITE_DB_NAME, ok: true, exitCode: 0 })

    // No feature, no branch to move to: a dry run proves the environment where
    // the human already is.
    expect(await currentBranch()).toBe('main')

    const started = listByProject(ctx, project.id, 0).find((e) => e.type === 'prep.dryrun.started')
    expect(started?.featureId).toBeUndefined()
    expect(started?.message).toContain('prep-dry-run')

    await drive('stop')

    // The reserved slug is what makes the temp database self-describing: a human
    // who finds `myapp_prep_dry_run` lying around knows what left it — and the
    // stop hook read the name from the file setup wrote, not from a template.
    expect(readFileSync(join(repo, 'db-name.txt'), 'utf8').trim()).toBe('myapp_prep_dry_run')
  })

  it('overlays nothing, and fails nothing, when setup writes no drive.env', async () => {
    record('driveSetupCommand', 'echo nothing-to-hand-back')

    const start = await drive('start')
    expect(start.ok).toBe(true)
    expect(start.envKeys).toEqual([])

    await drive('stop')
  })

  it('deletes drive.env when the run stops, leaving the repo as it found it', async () => {
    record('driveSetupCommand', WRITE_DB_NAME)

    await drive('start')
    expect(existsSync(join(repo, '.runcastle', 'drive.env'))).toBe(true)

    await drive('stop')
    expect(existsSync(join(repo, '.runcastle', 'drive.env'))).toBe(false)
  })

  it('reports the hook output tail, so a failing hook explains itself', async () => {
    record('driveSetupCommand', 'echo setup-hook-ran')

    const start = await drive('start')
    expect(start.setup?.output).toContain('setup-hook-ran')

    await drive('stop')
  })

  // A computed connection string is exactly what a setup script writes, and the
  // dry-run report goes to an agent's transcript.
  it('names the variables the file carries without ever echoing one', async () => {
    mkdirSync(join(repo, '.runcastle'), { recursive: true })
    writeFileSync(
      join(repo, '.runcastle', 'drive.env'),
      'DATABASE_URL=postgres://user:hunter2@localhost/x\n',
    )

    const start = await drive('start')

    expect(start.envKeys).toEqual(['DATABASE_URL'])
    // Values can hold credentials, so nothing that leaves this tool may carry one.
    expect(JSON.stringify(start)).not.toContain('hunter2')

    await drive('stop')
  })

  // --- the drive slot, shared with feature test drives (decision 9) ----------

  it('refuses to start while a feature test drive holds the slot', async () => {
    const feature = seedFeature(ctx, project.id, { slug: 'drive' })
    await createFeatureBranch(project, feature.slug)
    expect((await testDrive(ctx, project, feature, 'start')).ok).toBe(true)

    const start = await drive('start')
    expect(start.ok).toBe(false)
    expect(start.deniedReason).toBe('A test drive is already active — stop it first')

    await testDrive(ctx, project, feature, 'stop')
  })

  it('refuses a feature test drive while it holds the slot itself', async () => {
    const feature = seedFeature(ctx, project.id, { slug: 'drive' })
    await createFeatureBranch(project, feature.slug)
    expect((await drive('start')).ok).toBe(true)

    const denied = await testDrive(ctx, project, feature, 'start')
    expect(denied.ok).toBe(false)
    expect(denied.deniedReason).toBe('A preparation dry-run is in progress — stop it first')
    expect(await currentBranch()).toBe('main')

    await drive('stop')
  })

  it('is the active drive the UI polls — project-scoped, with a branch and no feature', async () => {
    expect(activeDriveInfo()).toBeNull()

    await drive('start')

    expect(activeDriveInfo()).toMatchObject({ dryRun: true, branch: 'main', devConfigured: false })
    // `dryRun` with no feature at all is how the UI tells the two drives apart.
    expect(activeDriveInfo()).not.toHaveProperty('featureId')
    // A dry run belongs to no feature, so it belongs to neither drive purpose.
    expect(activeDriveInfo()?.purpose).toBeUndefined()
    // The same shape reaches the wire the drive UI already polls.
    const driveInfo = await createCallerFactory(appRouter)(ctx).feature.driveInfo()
    expect(driveInfo).toMatchObject({ dryRun: true, branch: 'main' })
    expect(driveInfo).not.toHaveProperty('featureId')
    // The prep workspace reads the same drive, which is how it offers a Stop.
    expect((await prepView(ctx, project)).dryRun).toMatchObject({ dryRun: true, branch: 'main' })

    await drive('stop')
    expect(activeDriveInfo()).toBeNull()
    expect((await prepView(ctx, project)).dryRun).toBeNull()
  })

  it('is torn down by hand through project.dryRunStop when the session died mid-run', async () => {
    record('driveStopCommand', 'echo torn-down')
    await drive('start')

    const caller = createCallerFactory(appRouter)(ctx)
    const stop = await caller.project.dryRunStop({ projectId: project.id })

    expect(stop.ok).toBe(true)
    expect(stop.teardown?.output).toContain('torn-down')
    expect(activeDriveInfo()).toBeNull()
  })

  // --- status, between the halves -------------------------------------------

  it('reports no pane and no URL when the project has no dev command', async () => {
    await drive('start')

    const status = await drive('status')
    expect(status).toMatchObject({ ok: true, devConfigured: false, devPaneLive: false })
    expect(status.devUrl).toBeUndefined()

    await drive('stop')
  })

  // The prep agent's own view of app readiness (decision 5): the same poll the
  // human's drive panel waits on, reported through the action it already calls.
  it('reports app readiness through status, once the sniffed URL answers', async () => {
    const server = createServer((_req, res) => {
      res.writeHead(200)
      res.end('ok')
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`

    await drive('start')
    // Stand in for the pane's sniffer, which needs a real dev server to fire.
    recordDryRunUrl(ctx, project.id, url)
    // Synchronously after the sniff, nothing has answered yet.
    expect(activeDriveInfo()?.devReady).toBe(false)

    let status = await drive('status')
    for (let i = 0; i < 100 && !status.devReady; i++) {
      await delay(20)
      status = await drive('status')
    }
    expect(status).toMatchObject({ devUrl: url, devReady: true })
    expect(eventTypes()).toContain('prep.dryrun.ready')

    await drive('stop')
    await new Promise<void>((r) => server.close(() => r()))
  })

  it('refuses status and stop when no dry run is up', async () => {
    expect(await drive('status')).toMatchObject({
      ok: false,
      deniedReason: 'No preparation dry-run is in progress',
    })
    expect(await drive('stop')).toMatchObject({
      ok: false,
      deniedReason: 'No preparation dry-run is in progress',
    })
  })

  it.runIf(PTY)('reports the pane as live, then the URL the dev server prints', async () => {
    record('devCommand', 'echo "  Local:   http://localhost:5173/"; sleep 30')

    const start = await drive('start')
    expect(start).toMatchObject({ devConfigured: true, devPaneLive: true })

    // The sniff is asynchronous — the pane has to print the line first.
    await delay(1200)
    const status = await drive('status')
    expect(status.devUrl).toBe('http://localhost:5173/')
    expect(status.devPaneLive).toBe(true)

    // Stop frees the port: the pane is killed before the stop hook goes looking
    // for what it has to drop.
    const paneId = activeDriveInfo()?.devPaneId
    expect(paneId).toBeDefined()
    await drive('stop')
    expect(ptyRegistry().has(paneId!)).toBe(false)
  }, 15000)

  // --- the stop half and its verdict ----------------------------------------

  it('stops the run, runs the stop hook and frees the slot', async () => {
    record('driveStopCommand', 'echo teardown-ran')
    await drive('start')

    const stop = await drive('stop')

    expect(stop.ok).toBe(true)
    expect(stop.teardown).toMatchObject({ ok: true, exitCode: 0 })
    expect(stop.teardown?.output).toContain('teardown-ran')
    expect(eventTypes()).toContain('prep.dryrun.stopped')
    expect(activeDriveInfo()).toBeNull()
  })

  it('stamps exactly the keys that participated on a clean full pass', async () => {
    record('driveSetupCommand', 'echo up')
    record('driveStopCommand', 'echo down')
    // A key established but not part of the drive loop is never a candidate.
    record('dbResetCommand', 'echo reset')

    await drive('start')
    const stop = await drive('stop')

    // No devCommand, so devCommand simply is not part of this run (decision 2) —
    // and the run still passes cleanly on what it did exercise.
    expect(stop.verified).toEqual(['driveSetupCommand', 'driveStopCommand'])
    expect(stop.failure).toBeUndefined()
    expect((await verifiedKeys()).sort()).toEqual(['driveSetupCommand', 'driveStopCommand'].sort())

    const verified = listByProject(ctx, project.id, 0).find((e) => e.type === 'prep.dryrun.verified')
    expect(verified?.message).toContain('driveSetupCommand')
    // The stamp is pinned to the commit it was proven at, like a finding is.
    expect((verified?.data as { sha?: string }).sha).toMatch(/^[0-9a-f]{40}$/)
  })

  it('stamps nothing and names the observable when the setup hook fails', async () => {
    record('driveSetupCommand', 'exit 3')
    record('driveStopCommand', 'echo down')

    await drive('start')
    const stop = await drive('stop')

    // All-or-nothing (decision 3): driveStopCommand was fine, and it is not
    // stamped either, because this run did not prove the loop.
    expect(stop.failure).toBe('driveSetupCommand did not exit 0')
    expect(stop.verified).toEqual([])
    expect(await verifiedKeys()).toEqual([])
    expect(eventTypes()).not.toContain('prep.dryrun.verified')
  })

  it('stamps nothing when the stop hook fails, even after a clean start half', async () => {
    record('driveSetupCommand', 'echo up')
    record('driveStopCommand', 'exit 5')

    await drive('start')
    const stop = await drive('stop')

    expect(stop.failure).toBe('driveStopCommand did not exit 0')
    expect(await verifiedKeys()).toEqual([])
  })

  it.runIf(PTY)('fails devCommand when the dev server never prints a localhost URL', async () => {
    // Spawning is too weak an observable on its own: a server that crashes on
    // boot still spawns, and "Open app" depends on the URL.
    record('devCommand', 'echo starting-up-quietly')
    record('driveSetupCommand', 'echo up')

    await drive('start')
    const stop = await drive('stop')

    expect(stop.failure).toBe(
      'devCommand spawned but printed no localhost URL — "Open app" depends on one',
    )
    expect(await verifiedKeys()).toEqual([])
  })

  // --- who may run it --------------------------------------------------------

  it('refuses a session that is not a preparation conversation', async () => {
    const other = createSessionRow(ctx, {
      projectId: project.id,
      kind: 'project',
      worktreePath: repo,
    })

    await expect(toolDryRunDrive(ctx, other, { action: 'start' })).rejects.toThrow(GateError)
    await expect(toolDryRunDrive(ctx, other, { action: 'start' })).rejects.toThrow(
      /preparation conversation/,
    )
    expect(activeDriveInfo()).toBeNull()
  })

  it('leaves no dry-run state behind for the next session', async () => {
    await drive('start')
    await drive('stop')
    expect(existsSync(join(repo, '.git'))).toBe(true)
    expect(activeDriveInfo()).toBeNull()
  })
})
