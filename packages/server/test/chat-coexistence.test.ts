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
} from '../src/services/git'
import { featureLandingQueue } from '../src/services/landing-queue'
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
})
