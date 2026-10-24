import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Feature, Project } from '@runcastle/core'
import { sessionDir, worktreeDir } from '@runcastle/core/paths'
import { eq } from 'drizzle-orm'
import { simpleGit } from 'simple-git'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { sessions } from '../src/db/schema'
import type { AppCtx } from '../src/db/types'
import { launchSession, launchSideSession } from '../src/launcher/launcher'
import { clearRuntimeCtx, setRuntimeCtx } from '../src/launcher/runtime'
import {
  createSessionRow,
  getSessionRow,
  kickoffLineFor,
  markAwaitingInput,
  markSessionEnded,
  markSessionLive,
} from '../src/launcher/sessions'
import { stopAllDocsWatch } from '../src/services/docs-watch'
import { __resetTestDriveState, createFeatureBranch } from '../src/services/git'
import { openProject } from '../src/services/projects'
import { createCallerFactory } from '../src/trpc/context'
import { appRouter } from '../src/trpc/router'
import { useDataDir } from './helpers/data-dir'
import { makeTestCtx } from './helpers/db'
import { seedFeature } from './helpers/fixtures'

/**
 * The feature's session switcher, server side (several-sessions-per-feature
 * decisions 8, 10, 12): what `feature.sessions` lists, in what order, and what
 * each side session is called — which is the human's first message, never the
 * side kickoff or the main chat's lines it quotes.
 */

const tmpDirs: string[] = []

function mkTmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tmpDirs.push(dir)
  return dir
}

let ctx: AppCtx
let project: Project
let scratch: string
let restoreDataDir: () => void

beforeEach(async () => {
  restoreDataDir = useDataDir(mkTmp('rc-fsess-home-'))
  ctx = await makeTestCtx()
  const repo = mkTmp('rc-fsess-repo-')
  const g = simpleGit(repo)
  await g.init(['-b', 'main'])
  await g.addConfig('user.email', 'test@runcastle.dev')
  await g.addConfig('user.name', 'Runcastle Test')
  await g.addConfig('core.autocrlf', 'false')
  writeFileSync(join(repo, 'README.md'), 'base\n')
  await g.add(['README.md'])
  await g.commit('initial commit')
  project = await openProject(ctx, repo)
  scratch = mkTmp('rc-fsess-transcripts-')
  setRuntimeCtx(ctx)
})

afterEach(() => {
  clearRuntimeCtx()
  stopAllDocsWatch()
  __resetTestDriveState()
  restoreDataDir()
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const caller = () => createCallerFactory(appRouter)(ctx)

async function feature(slug: string): Promise<Feature> {
  const f = seedFeature(ctx, project.id, { slug })
  await createFeatureBranch(project, slug, 'main')
  tmpDirs.push(worktreeDir(project.id, slug))
  return f
}

/** A main chat the CLI picked up; ended unless said otherwise. */
async function mainChat(featureId: string, opts: { live?: boolean } = {}): Promise<string> {
  const { sessionId } = await launchSession(ctx, { featureId, kind: 'chat' }, { spawn: false })
  tmpDirs.push(sessionDir(sessionId))
  markSessionLive(ctx, sessionId, { ccSessionId: `cc-main-${sessionId}` })
  if (!opts.live) markSessionEnded(ctx, sessionId)
  return sessionId
}

/** A side session the CLI picked up as `ccSessionId`; reopens `reopenSessionId` when given. */
async function side(featureId: string, ccSessionId: string, reopenSessionId?: string): Promise<string> {
  const { sessionId } = await launchSideSession(
    ctx,
    { featureId, ...(reopenSessionId ? { reopenSessionId } : {}) },
    { spawn: false },
  )
  tmpDirs.push(sessionDir(sessionId))
  markSessionLive(ctx, sessionId, { ccSessionId })
  return sessionId
}

/** One JSONL entry as Claude Code writes it. */
function entry(type: 'user' | 'assistant', content: string): string {
  return JSON.stringify({ type, message: { role: type, content } })
}

function giveTranscript(sessionId: string, lines: string[]): string {
  const path = join(scratch, `${sessionId}.jsonl`)
  writeFileSync(path, `${lines.join('\n')}\n`)
  ctx.db.update(sessions).set({ transcriptPath: path }).where(eq(sessions.id, sessionId)).run()
  return path
}

/**
 * A side session's opening turn as the CLI records it: the side kickoff, the
 * feature state, and the main chat's latest turns quoted inside it — lines the
 * human typed, but to the main chat, not here.
 */
const SIDE_KICKOFF_TURN = [
  `[runcastle] ${kickoffLineFor('side', undefined, 'claude-code')}`,
  'Feature state: planning; docs: brief.md.',
  "The main chat's latest turns:",
  '> You: rework the review page',
  '> Agent: Which part of it first?',
].join('\n')

describe('feature.sessions', () => {
  it('is empty for a feature nobody has talked to', async () => {
    const f = await feature('empty')
    expect(await caller().feature.sessions({ featureId: f.id })).toEqual([])
  })

  it('lists the main chat first, then live side sessions, then ended ones, then a live scenario chat', async () => {
    const f = await feature('order')
    const chat = await mainChat(f.id, { live: true })
    const ended = await side(f.id, 'cc-ended')
    markSessionEnded(ctx, ended)
    const live = await side(f.id, 'cc-live')
    markAwaitingInput(ctx, live)
    const scenario = createSessionRow(ctx, {
      featureId: f.id,
      kind: 'scenario',
      worktreePath: scratch,
    })

    const list = await caller().feature.sessions({ featureId: f.id })

    expect(list.map((s) => [s.kind, s.id, s.status])).toEqual([
      ['chat', chat, 'live'],
      ['side', live, 'live'],
      ['side', ended, 'ended'],
      ['scenario', scenario.id, 'launching'],
    ])
    expect(list[0]).toMatchObject({ title: 'Main chat', awaitingInput: false })
    expect(list[1]).toMatchObject({ awaitingInput: true, endedAt: null })
    expect(list[2].endedAt).toBeGreaterThan(0)
  })

  it('lists the newest main chat, ended or not', async () => {
    const f = await feature('newest-chat')
    await mainChat(f.id)
    const newest = await mainChat(f.id)
    const list = await caller().feature.sessions({ featureId: f.id })
    expect(list).toEqual([expect.objectContaining({ id: newest, kind: 'chat', status: 'ended' })])
  })

  it('does not list a scenario chat once it has ended', async () => {
    const f = await feature('scenario-ended')
    const scenario = createSessionRow(ctx, { featureId: f.id, kind: 'scenario', lap: 1, worktreePath: scratch })
    markSessionEnded(ctx, scenario.id)
    expect(await caller().feature.sessions({ featureId: f.id })).toEqual([])
  })

  it('collapses a reopened side session into one row, identified by its latest session', async () => {
    const f = await feature('reopen')
    await mainChat(f.id)
    const first = await side(f.id, 'cc-same')
    markSessionEnded(ctx, first)
    const reopened = await side(f.id, 'cc-same', first)

    const sides = (await caller().feature.sessions({ featureId: f.id })).filter((s) => s.kind === 'side')

    expect(sides).toHaveLength(1)
    expect(sides[0]).toMatchObject({ id: reopened, status: 'live' })
    expect(sides[0].createdAt).toBe(getSessionRow(ctx, first)?.createdAt)
  })

  it('does not list a side session the CLI never picked up', async () => {
    const f = await feature('orphan')
    const { sessionId } = await launchSideSession(ctx, { featureId: f.id }, { spawn: false })
    tmpDirs.push(sessionDir(sessionId))
    expect(await caller().feature.sessions({ featureId: f.id })).toEqual([])
  })
})

describe('a side session’s name', () => {
  it('is the human’s first message, never the kickoff or the main-chat lines it quotes', async () => {
    const f = await feature('title')
    const id = await side(f.id, 'cc-title')
    giveTranscript(id, [
      entry('user', SIDE_KICKOFF_TURN),
      entry('assistant', 'I am a side session. What do you need?'),
      entry('user', 'why does the burn skip ticket 4?'),
    ])

    const [row] = await caller().feature.sessions({ featureId: f.id })

    expect(row.title).toBe('why does the burn skip ticket 4?')
  })

  it('is Untitled until the human types, and that is not cached', async () => {
    const f = await feature('untitled')
    const id = await side(f.id, 'cc-untitled')
    giveTranscript(id, [entry('user', SIDE_KICKOFF_TURN), entry('assistant', 'Waiting for your ask.')])

    const [row] = await caller().feature.sessions({ featureId: f.id })

    expect(row.title).toBe('Untitled')
    expect(getSessionRow(ctx, id)?.title).toBeUndefined()
  })

  it('is cached on the conversation’s earliest row, so it outlives its transcript', async () => {
    const f = await feature('cached')
    const first = await side(f.id, 'cc-cached')
    const path = giveTranscript(first, [entry('user', SIDE_KICKOFF_TURN), entry('user', 'write the drive scenario')])
    markSessionEnded(ctx, first)
    const reopened = await side(f.id, 'cc-cached', first)
    giveTranscript(reopened, [entry('user', 'and another one')])

    expect((await caller().feature.sessions({ featureId: f.id }))[0].title).toBe('write the drive scenario')
    expect(getSessionRow(ctx, first)?.title).toBe('write the drive scenario')

    rmSync(path)
    expect((await caller().feature.sessions({ featureId: f.id }))[0].title).toBe('write the drive scenario')
  })
})

describe('an ended side session’s transcript', () => {
  it('leaves out the side kickoff turn, excerpt and all', async () => {
    const f = await feature('transcript')
    const id = await side(f.id, 'cc-transcript')
    giveTranscript(id, [
      entry('user', SIDE_KICKOFF_TURN),
      entry('assistant', 'What do you need?'),
      entry('user', 'why does the burn skip ticket 4?'),
    ])
    markSessionEnded(ctx, id)

    const transcript = await caller().project.conversationTranscript({ sessionId: id })

    expect(transcript.turns).toEqual([
      { role: 'assistant', text: 'What do you need?' },
      { role: 'user', text: 'why does the burn skip ticket 4?' },
    ])
  })
})

describe('the feature’s live session in the sidebar', () => {
  it('speaks for the main chat, not a side session', async () => {
    const f = await feature('sidebar')
    await mainChat(f.id)
    const id = await side(f.id, 'cc-sidebar')
    markAwaitingInput(ctx, id)

    const [row] = await caller().feature.list({ projectId: project.id })

    expect(row.liveSession).toBeNull()
  })
})
