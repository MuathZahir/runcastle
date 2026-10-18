import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Feature, Project } from '@runcastle/core'
import { newId } from '@runcastle/core'
import { sessionDir, worktreeDir } from '@runcastle/core/paths'
import { simpleGit } from 'simple-git'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { runs } from '../src/db/schema'
import { launchSession } from '../src/launcher/launcher'
import {
  createSessionRow,
  getSessionRow,
  markSessionLive,
} from '../src/launcher/sessions'
import { landChatCommits } from '../src/services/chat-branch'
import { listAfter } from '../src/services/events'
import {
  chatBranchInWorktree,
  commitDocs,
  createFeatureBranch,
  ensureTalkWorktree,
  testDrive,
} from '../src/services/git'
import { featureLandingQueue } from '../src/services/landing-queue'
import { deliverToLead, type LeadLauncher, wakeLeadHeadless } from '../src/services/lead-delivery'
import { startRun } from '../src/workflows/runner'
import { workflowRegistry } from '../src/workflows/registry'
import { useDataDir } from './helpers/data-dir'
import { makeTestCtx } from './helpers/db'
import { rmTemp, seedFeature, seedProject } from './helpers/fixtures'

/**
 * The chat coexisting with a burn (`one-chat-per-feature` decisions 2 and 9):
 * a terminal spawns while the run holds `feature/<slug>`, it commits docs on a
 * chat temp branch of its own, and those commits land through the SAME serial
 * queue the burner's ticket landings run through.
 */

const tmpDirs: string[] = []

function mkTmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tmpDirs.push(dir)
  return dir
}

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

describe('the chat beside a burn', () => {
  let ctx: AppCtx
  let project: Project
  let feature: Feature
  let talkWt: string
  let restoreDataDir: () => void

  beforeEach(async () => {
    restoreDataDir = useDataDir(mkTmp('rc-chat-home-'))
    ctx = await makeTestCtx()

    const repo = mkTmp('rc-chat-repo-')
    const g = simpleGit(repo)
    await g.init(['-b', 'main'])
    await g.addConfig('user.email', 'test@runcastle.dev')
    await g.addConfig('user.name', 'Runcastle Test')
    await g.addConfig('core.autocrlf', 'false')
    writeFileSync(join(repo, 'README.md'), 'base\n')
    await g.add(['README.md'])
    await g.commit('initial commit')

    project = seedProject(ctx, repo)
    feature = seedFeature(ctx, project.id, { slug: 'coex', phase: 'building' })
    await createFeatureBranch(project, feature.slug, 'main')
    talkWt = await ensureTalkWorktree(project, feature)
  })

  afterEach(() => {
    restoreDataDir()
    while (tmpDirs.length) {
      const dir = tmpDirs.pop()
      if (dir) {
        try {
          rmTemp(dir)
        } catch {
          // best-effort cleanup — a handle that outlives the retries on Windows
        }
      }
    }
  })

  /** A `running` run row for a workflow that claims the feature branch. */
  function seedBurn(): string {
    const id = newId('run')
    ctx.db
      .insert(runs)
      .values({
        id,
        featureId: feature.id,
        workflow: 'ticket-burner',
        status: 'running',
        startedAt: Date.now(),
        endedAt: null,
        summary: null,
      })
      .run()
    return id
  }

  /** Commit a docs file in the talk worktree, as the chat's own tools do. */
  async function chatCommits(name: string): Promise<string> {
    const docs = join(talkWt, 'docs', 'features', feature.slug)
    mkdirSync(docs, { recursive: true })
    writeFileSync(join(docs, name), 'a note\n')
    await commitDocs(talkWt, `runcastle: ${name}`)
    return (await simpleGit(talkWt).revparse(['HEAD'])).trim()
  }

  /** Whether `sha` is reachable from the feature branch. */
  async function landedOnFeature(sha: string): Promise<boolean> {
    const merged = await simpleGit(project.repoPath).raw([
      'branch',
      '--contains',
      sha,
      '--list',
      feature.branch,
    ])
    return merged.trim().length > 0
  }

  it('spawns a chat while the burn is in flight, on a branch forked from the feature tip', async () => {
    const tip = (await simpleGit(project.repoPath).revparse([feature.branch])).trim()
    seedBurn()

    const { sessionId } = await launchSession(
      ctx,
      { featureId: feature.id, kind: 'chat' },
      { spawn: false },
    )
    tmpDirs.push(sessionDir(sessionId))

    const branch = await chatBranchInWorktree(talkWt)
    expect(branch).toBeDefined()
    expect(branch?.startsWith('runcastle/chat/coex/')).toBe(true)
    // forked from the feature tip: it stands exactly there, with nothing on it yet
    expect((await simpleGit(talkWt).revparse(['HEAD'])).trim()).toBe(tip)
    // and the session works in the same talk worktree as ever
    expect(getSessionRow(ctx, sessionId)?.worktreePath).toBe(worktreeDir(project.id, feature.slug))
    const parked = listAfter(ctx, feature.id, 0).filter((e) => e.type === 'chat.worktree_parked')
    expect(parked).toHaveLength(1)
    expect(parked[0]?.featureId).toBe(feature.id)
    expect(parked[0]?.data).toMatchObject({ branch, worktreePath: talkWt })
  })

  it('lands a mid-burn docs commit on the feature branch, behind the landing in front of it', async () => {
    seedBurn()
    await launchSession(ctx, { featureId: feature.id, kind: 'chat' }, { spawn: false })
    const note = await chatCommits('notes.md')

    // A ticket landing is holding the feature's queue.
    let releaseTicket!: () => void
    const ticketLanding = featureLandingQueue(feature.id)(
      () => new Promise<void>((r) => (releaseTicket = r)),
    )

    const chatLanding = landChatCommits(ctx, project, feature)
    await delay(100)
    expect(await landedOnFeature(note)).toBe(false) // waiting its turn, not racing

    releaseTicket()
    await ticketLanding
    const landed = await chatLanding

    expect(landed?.commits).toBe(1)
    expect(landed?.result.ok).toBe(true)
    expect(await landedOnFeature(note)).toBe(true)
    // the chat kept a place to commit: a fresh branch, not a detached HEAD
    expect(await chatBranchInWorktree(talkWt)).toBeDefined()
    expect(await chatBranchInWorktree(talkWt)).not.toBe(landed?.branch)
    // and the timeline says the feature branch moved
    const landedEvents = listAfter(ctx, feature.id, 0).filter((e) => e.type === 'chat.landed')
    expect(landedEvents).toHaveLength(1)
    expect(landedEvents[0]?.data).toMatchObject({ branch: landed?.branch, commits: 1 })
  })

  it('names the rolled-over chat branch on the timeline before it reports the landing', async () => {
    seedBurn()
    await launchSession(ctx, { featureId: feature.id, kind: 'chat' }, { spawn: false })
    await chatCommits('rollover-note.md')

    const landed = await landChatCommits(ctx, project, feature)
    const rolledTo = await chatBranchInWorktree(talkWt)

    const chatEvents = listAfter(ctx, feature.id, 0).filter((e) => e.type.startsWith('chat.'))
    expect(chatEvents.map((e) => e.type)).toEqual([
      'chat.worktree_parked', // the spawn's park
      'chat.worktree_parked', // the rollover this landing cut
      'chat.landed',
    ])
    expect(chatEvents[1]?.data).toMatchObject({ branch: rolledTo, worktreePath: talkWt })
    expect(rolledTo).not.toBe(landed?.branch)
  })

  it('has nothing to land outside a burn — the chat commits to the feature branch directly', async () => {
    const note = await chatCommits('planning-note.md')

    expect(await landChatCommits(ctx, project, feature)).toBeNull()
    expect(await landedOnFeature(note)).toBe(true) // it was already there
  })

  it('switches a LIVE chat onto a chat branch in place when Burn is clicked', async () => {
    const session = createSessionRow(ctx, {
      featureId: feature.id,
      kind: 'chat',
      worktreePath: talkWt,
    })
    markSessionLive(ctx, session.id, { ccSessionId: 'cc-chat' })
    writeFileSync(join(talkWt, 'draft.md'), 'mid-thought\n') // an unsaved edit

    let open!: () => void
    const gate = new Promise<void>((r) => (open = r))
    const original = workflowRegistry.get('ticket-burner')
    workflowRegistry.set('ticket-burner', {
      id: 'ticket-burner',
      async run() {
        await gate
        return { status: 'succeeded', summary: 'ok' }
      },
    })
    try {
      const { done } = await startRun(ctx, feature.id, 'ticket-burner')

      const parkedBranch = await chatBranchInWorktree(talkWt)
      expect(parkedBranch).toBeDefined()
      // the session is untouched: same worktree, still live, edits still there
      const row = getSessionRow(ctx, session.id)
      expect(row?.status).toBe('live')
      expect(row?.worktreePath).toBe(talkWt)
      expect(readFileSync(join(talkWt, 'draft.md'), 'utf8')).toBe('mid-thought\n')

      open()
      await done

      const handoffEvents = listAfter(ctx, feature.id, 0).filter((e) => e.type.startsWith('chat.'))
      expect(handoffEvents.map((e) => e.type)).toEqual([
        'chat.worktree_parked',
        'chat.worktree_released',
        'chat.branch_deleted',
      ])
      expect(handoffEvents.every((e) => e.featureId === feature.id)).toBe(true)
      expect(handoffEvents[2]?.data).toMatchObject({ branch: parkedBranch })
    } finally {
      if (original) workflowRegistry.set('ticket-burner', original)
      else workflowRegistry.delete('ticket-burner')
    }
  })

  /**
   * While a drive of the feature holds the slot it runs the feature branch on
   * the main checkout, so nothing the chat commits may land under it
   * (`the-feature-lead-runs-rounds` decision 19) — it lands when the drive stops.
   */
  describe('while the feature is being driven', () => {
    const typesOf = (prefix: string) =>
      listAfter(ctx, feature.id, 0)
        .filter((e) => e.type.startsWith(prefix))
        .map((e) => e.type)

    it('defers a mid-round chat landing until the drive stops, then lands it', async () => {
      seedBurn()
      await launchSession(ctx, { featureId: feature.id, kind: 'chat' }, { spawn: false })
      const note = await chatCommits('drive-note.md')
      const chatBranch = await chatBranchInWorktree(talkWt)
      // A review drive is the one kind that can start mid-round.
      expect((await testDrive(ctx, project, feature, 'start', 'review')).ok).toBe(true)

      const deferred = await landChatCommits(ctx, project, feature)
      expect(deferred).toMatchObject({ deferred: true, branch: chatBranch, commits: 1 })
      expect(await landedOnFeature(note)).toBe(false)
      expect(await chatBranchInWorktree(talkWt)).toBe(chatBranch) // no rollover
      const deferredEvent = listAfter(ctx, feature.id, 0).find((e) => e.type === 'chat.landing_deferred')
      expect(deferredEvent?.data).toEqual({ branch: chatBranch, commits: 1 })

      expect((await testDrive(ctx, project, feature, 'stop')).ok).toBe(true)
      expect(await landedOnFeature(note)).toBe(true)
      expect(await chatBranchInWorktree(talkWt)).toBeDefined() // the round still runs
      expect(typesOf('chat.')).toContain('chat.landed')
      // docs only: no "agent fix" on the trail
      expect(typesOf('lead.')).toEqual([])
    })

    it('lands what the lead committed on the drive`s detached worktree, announcing its code fix', async () => {
      expect((await testDrive(ctx, project, feature, 'start')).ok).toBe(true)
      // The drive detached the talk worktree; the lead keeps committing there.
      mkdirSync(join(talkWt, 'src'), { recursive: true })
      writeFileSync(join(talkWt, 'src', 'fix.ts'), 'export const fixed = true\n')
      writeFileSync(join(talkWt, 'src', 'other.ts'), 'export const other = true\n')
      const wt = simpleGit(talkWt)
      await wt.add(['src'])
      await wt.commit('feat(app): a tiny fix')
      const fix = (await wt.revparse(['HEAD'])).trim()
      expect(await landedOnFeature(fix)).toBe(false)

      expect((await testDrive(ctx, project, feature, 'stop')).ok).toBe(true)

      expect(await landedOnFeature(fix)).toBe(true)
      expect((await wt.revparse(['--abbrev-ref', 'HEAD'])).trim()).toBe(feature.branch)
      const codeLanded = listAfter(ctx, feature.id, 0).filter((e) => e.type === 'lead.code_landed')
      expect(codeLanded).toHaveLength(1)
      expect(codeLanded[0]?.data).toEqual({
        commits: [{ sha: fix, subject: 'feat(app): a tiny fix' }],
        files: 2,
        afterRunId: null,
      })
    })

    /** Commit a code file in the talk worktree, as the lead's own fix would be. */
    async function leadCommits(name: string): Promise<string> {
      mkdirSync(join(talkWt, 'src'), { recursive: true })
      writeFileSync(join(talkWt, 'src', name), 'export const fixed = true\n')
      const wt = simpleGit(talkWt)
      await wt.add(['src'])
      await wt.commit(`feat(app): ${name}`)
      return (await wt.revparse(['HEAD'])).trim()
    }

    const launchNoSpawn: LeadLauncher = (c, input) => launchSession(c, input, { spawn: false })

    it('wakes a closed lead headless mid-drive with the notes, and lands its commits when the drive stops', async () => {
      expect((await testDrive(ctx, project, feature, 'start')).ok).toBe(true)
      await deliverToLead(ctx, feature, { text: 'Notes from the drive: the button is off', source: 'human' })

      expect(await wakeLeadHeadless(ctx, feature.id, launchNoSpawn)).not.toBeNull()
      expect(typesOf('lead.')).toContain('lead.woken_headless')
      expect(typesOf('lead.')).not.toContain('lead.wake_failed')
      // It works in the worktree the drive detached; nothing lands under the drive.
      expect((await simpleGit(talkWt).revparse(['--abbrev-ref', 'HEAD'])).trim()).toBe('HEAD')
      const fix = await leadCommits('button.ts')
      expect(await landedOnFeature(fix)).toBe(false)

      expect((await testDrive(ctx, project, feature, 'stop')).ok).toBe(true)
      expect(await landedOnFeature(fix)).toBe(true)
    })

    it('opens a lead mid-drive when the feature has no talk worktree, parked on a chat branch', async () => {
      await simpleGit(project.repoPath).raw(['worktree', 'remove', '--force', talkWt])
      expect((await testDrive(ctx, project, feature, 'start')).ok).toBe(true)

      await launchSession(ctx, { featureId: feature.id, kind: 'chat' }, { spawn: false })
      expect(await chatBranchInWorktree(talkWt)).toBeDefined()
      const fix = await leadCommits('fresh.ts')
      expect(await landedOnFeature(fix)).toBe(false)

      expect((await testDrive(ctx, project, feature, 'stop')).ok).toBe(true)
      expect(await landedOnFeature(fix)).toBe(true)
      expect((await simpleGit(talkWt).revparse(['--abbrev-ref', 'HEAD'])).trim()).toBe(feature.branch)
    })

    it('hands the worktree straight back when nothing was committed during the drive', async () => {
      expect((await testDrive(ctx, project, feature, 'start')).ok).toBe(true)
      expect((await testDrive(ctx, project, feature, 'stop')).ok).toBe(true)
      expect((await simpleGit(talkWt).revparse(['--abbrev-ref', 'HEAD'])).trim()).toBe(feature.branch)
      expect(typesOf('chat.')).toEqual([])
    })
  })
})
