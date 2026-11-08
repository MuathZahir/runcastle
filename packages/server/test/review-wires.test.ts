import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { Feature, Project, SessionRow } from '@runcastle/core'
import { eq } from 'drizzle-orm'
import { simpleGit } from 'simple-git'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { workers } from '../src/db/schema'
import type { AppCtx } from '../src/db/types'
import { GateError } from '../src/errors'
import { createSessionRow } from '../src/launcher/sessions'
import { buildMcpServer, toolReportFinding, toolReviewDrive } from '../src/mcp/server'
import { usePipePty } from './helpers/pipe-pty'
import { listAfter } from '../src/services/events'
import { recordFinding } from '../src/services/findings'
import {
  __resetTestDriveState,
  activeDriveInfo,
  createFeatureBranch,
  testDrive,
} from '../src/services/git'
import { openProject } from '../src/services/projects'
import { listByFeature as listFindings } from '../src/services/review-findings'
import { createCallerFactory } from '../src/trpc/context'
import { appRouter } from '../src/trpc/router'
import { makeTestCtx } from './helpers/db'
import { seedFeature, seedHostReview } from './helpers/fixtures'

/**
 * The wires a drive review calls (burns-become-workers decision 3), tested
 * where the Review worker on the host meets them: the `review_drive` and
 * `report_finding` MCP tools.
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

usePipePty()
const PTY = process.platform !== 'win32'

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

describe('the drive review wires', () => {
  let ctx: AppCtx
  let repo: string
  let project: Project
  let feature: Feature
  let review: SessionRow

  beforeEach(async () => {
    ctx = await makeTestCtx()
    repo = mkTmp('rc-review-')
    await initRepo(repo)
    project = await openProject(ctx, repo)
    feature = seedFeature(ctx, project.id, { slug: 'reviewed' })
    await createFeatureBranch(project, feature.slug, 'main')
    // The Review worker on the host is the identity every call below arrives with.
    review = seedHostReview(ctx, feature, repo)
  })

  afterEach(() => {
    __resetTestDriveState()
    for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  /** A call arriving from the drive review's own session. */
  function drive(action: 'start' | 'status' | 'stop'): Promise<Awaited<ReturnType<typeof toolReviewDrive>>> {
    return toolReviewDrive(ctx, { session: review }, { action })
  }

  function talkSession(): SessionRow {
    return createSessionRow(ctx, {
      featureId: feature.id,
      kind: 'chat',
      worktreePath: repo,
    })
  }

  async function currentBranch(): Promise<string> {
    return (await simpleGit(repo).revparse(['--abbrev-ref', 'HEAD'])).trim()
  }

  function events(): { type: string; data?: unknown }[] {
    return listAfter(ctx, feature.id)
  }

  const defect = {
    kind: 'defect',
    severity: 'high',
    title: 'Save loses edits',
    location: 'screen: editor; click Save',
    citation: 'spec.md requires edits to persist',
    detail: 'The old value returns after saving.',
    reproStep: 'Edit the title, click Save, and reload.',
  } as const

  // --- the review drive -----------------------------------------------------

  it('starts on the feature branch and gives the checkout back on stop', async () => {
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
    expect(activeDriveInfo(project.id)).toBeNull()
  })

  it('tells the wire the UI polls that a review agent — not a human — is driving', async () => {
    await drive('start')

    const driveInfo = await createCallerFactory(appRouter)(ctx).feature.driveInfo({ projectId: project.id })
    expect(driveInfo).toMatchObject({ featureId: feature.id, purpose: 'review' })

    await drive('stop')
    expect(await createCallerFactory(appRouter)(ctx).feature.driveInfo({ projectId: project.id })).toBeNull()
  })

  it('reports a structured finding against the Review worker itself', () => {
    const result = toolReportFinding(ctx, { session: review }, defect)

    // The defect is the lead's to decide on.
    expect(result).toEqual({ findingId: expect.any(String) })
    expect(listFindings(ctx, feature.id)).toEqual([
      expect.objectContaining({ id: result.findingId, reviewWorkerId: review.id, title: 'Save loses edits', status: 'open' }),
    ])
  })

  it('still denies a dirty tree, and leaves the checkout where it was', async () => {
    writeFileSync(join(repo, 'scratch.txt'), 'uncommitted\n')

    const start = await drive('start')

    expect(start).toMatchObject({
      ok: false,
      deniedReason: 'Working tree has uncommitted changes — commit or stash first',
      drive: null,
    })
    // Classified through the tool boundary: final, and it names what to clean up.
    expect(start).toMatchObject({
      deniedCode: 'dirty',
      retriable: false,
      dirtyFiles: ['scratch.txt'],
    })
    expect(await currentBranch()).toBe('main')
    expect(activeDriveInfo(project.id)).toBeNull()
  })

  it('says so on the timeline the moment a dirty tree refuses the review drive', async () => {
    writeFileSync(join(repo, 'scratch.txt'), 'uncommitted\n')

    await drive('start')

    // The human is the only one who can clear it, so they hear about it while
    // they can still act — not from the handback half an hour later.
    const denials = events().filter((e) => e.type === 'reviewdrive.denied')
    expect(denials).toHaveLength(1)
    expect(denials[0]).toMatchObject({
      message: expect.stringContaining('scratch.txt'),
      data: { code: 'dirty', dirtyFiles: ['scratch.txt'] },
    })
  })

  it('tells a review that a held slot is worth waiting for, emits nothing, and never touches the human’s drive', async () => {
    expect((await testDrive(ctx, project, feature, 'start')).ok).toBe(true)
    const held = activeDriveInfo(project.id)

    const start = await drive('start')

    expect(start).toMatchObject({
      ok: false,
      deniedReason: 'A test drive of feature/reviewed is running — stop it first',
      deniedCode: 'slot_held',
      retriable: true,
    })
    // Ten poll refusals would spam a permanent timeline with a fallback that is
    // working as designed — the wait is the review's, and it is silent.
    expect(events().filter((e) => e.type === 'reviewdrive.denied')).toEqual([])
    // Fail fast means the human's drive is exactly as it was, right now.
    expect(activeDriveInfo(project.id)).toEqual(held)

    await testDrive(ctx, project, feature, 'stop')
  })

  it('starts when the only dirt is a brief runcastle staged and never committed', async () => {
    // How three of four review drives were really refused: the creation paths
    // scaffold `brief.md` and commit it best-effort, so a commit that did not
    // land leaves it staged — dirt the human never made and cannot explain.
    const docsDir = join(repo, 'docs', 'features', feature.slug)
    mkdirSync(docsDir, { recursive: true })
    writeFileSync(join(docsDir, 'brief.md'), '# Reviewed\n')
    await simpleGit(repo).add(['docs/features'])

    const start = await drive('start')

    expect(start).toMatchObject({ ok: true, action: 'start' })
    expect(await currentBranch()).toBe('feature/reviewed')
    // Committed, not waved through: the brief is versioned like every other doc.
    expect((await simpleGit(repo).status()).isClean()).toBe(true)
    const subject = (await simpleGit(repo).raw(['log', '-1', '--pretty=%s', 'main'])).trim()
    expect(subject).toMatch(/^runcastle: /)

    await drive('stop')
  })

  it('refuses to stop or inspect a drive that is not its own', async () => {
    await testDrive(ctx, project, feature, 'start')

    expect(await drive('stop')).toMatchObject({
      ok: false,
      deniedReason: 'No review drive is in progress for this feature',
    })
    expect(await drive('status')).toMatchObject({
      ok: false,
      deniedReason: 'No review drive is in progress for this feature',
    })
    // The human's drive is still up — the refusal cost them nothing.
    expect(activeDriveInfo(project.id)).toMatchObject({ featureId: feature.id })

    await testDrive(ctx, project, feature, 'stop')
  })

  it('lets the human reclaim the slot from a review drive the agent left behind', async () => {
    await drive('start')

    const stop = await testDrive(ctx, project, feature, 'stop')

    expect(stop.ok).toBe(true)
    expect(await currentBranch()).toBe('main')
    expect(activeDriveInfo(project.id)).toBeNull()
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

  it('refuses an ordinary talk session', async () => {
    const session = talkSession()

    await expect(toolReviewDrive(ctx, { session }, { action: 'start' })).rejects.toThrow(GateError)
    await expect(toolReviewDrive(ctx, { session }, { action: 'start' })).rejects.toThrow(/chat session/)
    expect(() => toolReportFinding(ctx, { session }, defect)).toThrow(GateError)

    expect(activeDriveInfo(project.id)).toBeNull()
    expect(listFindings(ctx, feature.id)).toEqual([])
  })

  it('refuses a caller with no session, and a gates review, which reports over its sandbox relay', async () => {
    await expect(toolReviewDrive(ctx, {}, { action: 'start' })).rejects.toThrow(/no session/)
    ctx.db.update(workers).set({ reviewMode: 'gates' }).where(eq(workers.id, review.id)).run()
    await expect(drive('start')).rejects.toThrow(GateError)
    expect(() => toolReportFinding(ctx, { session: review }, defect)).toThrow(GateError)
    expect(activeDriveInfo(project.id)).toBeNull()
  })
})

/**
 * The description is the only instruction a review agent reads before it acts on
 * a refusal, so it is contract, not documentation — read here the way the agent
 * reads it, off a `tools/list` from a review-audience server.
 */
describe('the review_drive tool description', () => {
  async function reviewDriveDescription(): Promise<string> {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    const client = new Client({ name: 'review-wires-test', version: '1' })
    await Promise.all([
      buildMcpServer('review').connect(serverTransport),
      client.connect(clientTransport),
    ])
    const tool = (await client.listTools()).tools.find((t) => t.name === 'review_drive')
    await client.close()
    return tool?.description ?? ''
  }

  it('points at the refusal fields, leaving the wait rules to the review prompt', async () => {
    const description = await reviewDriveDescription()

    expect(description).toMatch(/deniedCode/)
    expect(description).toMatch(/retriable/)
    expect(description).toMatch(/stop/)
    // The flat old rule is what sent a review to a repo-only review over a slot
    // that would have freed in ninety seconds.
    expect(description).not.toMatch(/never worth retrying/)
  })
})
