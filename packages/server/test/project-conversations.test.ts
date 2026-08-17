import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Project } from '@runcastle/core'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { sessions } from '../src/db/schema'
import { launchProjectSession } from '../src/launcher/launcher'
import { KICKOFF_LINES, awaitProjectLandings, getSessionRow } from '../src/launcher/sessions'
import { endSession } from '../src/pty/end-session'
import { TITLE_MAX } from '../src/services/conversations'
import { listByProject } from '../src/services/events'
import { createCallerFactory } from '../src/trpc/context'
import { appRouter } from '../src/trpc/router'
import { useDataDir } from './helpers/data-dir'
import { makeTestCtx } from './helpers/db'
import { seedProject } from './helpers/fixtures'

/**
 * The project chat as a conversation LIST (decision 5). What is worth pinning is
 * the reversal: opening the chat starts a new conversation, and picking up an
 * old one is a specific, named click — the opposite of the silent resume this
 * replaced. Plus the two reads that make a list usable at all: what each
 * conversation is called, and what was said in it.
 */

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

function initRepo(dir: string): void {
  git(dir, 'init', '-b', 'main')
  git(dir, 'config', 'user.email', 'test@runcastle.dev')
  git(dir, 'config', 'user.name', 'Runcastle Test')
  git(dir, 'config', 'core.autocrlf', 'false')
  writeFileSync(join(dir, 'README.md'), 'base\n')
  git(dir, 'add', 'README.md')
  git(dir, 'commit', '-m', 'initial commit')
}

/** One JSONL entry as Claude Code writes it. */
function entry(type: string, content: unknown, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ type, message: { role: type, content }, ...extra })
}

describe('the project conversation list', () => {
  let ctx: AppCtx
  let project: Project
  let repoPath: string
  let scratch: string
  const cleanup: string[] = []
  let restoreDataDir: () => void

  beforeEach(async () => {
    const home = mkdtempSync(join(tmpdir(), 'rc-convo-home-'))
    cleanup.push(home)
    restoreDataDir = useDataDir(home)

    ctx = await makeTestCtx()
    repoPath = mkdtempSync(join(tmpdir(), 'rc-convo-repo-'))
    cleanup.push(repoPath)
    initRepo(repoPath)
    project = seedProject(ctx, repoPath)
    scratch = mkdtempSync(join(tmpdir(), 'rc-convo-transcripts-'))
    cleanup.push(scratch)
  })

  afterEach(async () => {
    await awaitProjectLandings()
    restoreDataDir()
    for (const d of cleanup) rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    cleanup.length = 0
  })

  const caller = () => createCallerFactory(appRouter)(ctx)

  /** Write a transcript file and point a session row at it, as the hook would. */
  function giveTranscript(sessionId: string, lines: string[]): string {
    const path = join(scratch, `${sessionId}.jsonl`)
    writeFileSync(path, `${lines.join('\n')}\n`)
    ctx.db.update(sessions).set({ transcriptPath: path }).where(eq(sessions.id, sessionId)).run()
    return path
  }

  /** End a session and give it the Claude Code id a live one would have recorded. */
  function endWithCcId(sessionId: string, ccSessionId: string): void {
    endSession(ctx, sessionId)
    ctx.db.update(sessions).set({ ccSessionId }).where(eq(sessions.id, sessionId)).run()
  }

  async function launch(): Promise<{ sessionId: string }> {
    return launchProjectSession(ctx, { projectId: project.id }, { spawn: false })
  }

  it('is empty for a project nobody has talked to', async () => {
    expect(await caller().project.conversations({ projectId: project.id })).toEqual([])
  })

  it('lists every conversation newest first, with its date, status and resumability', async () => {
    const first = await launch()
    endWithCcId(first.sessionId, 'cc-1')
    const second = await launch()

    const list = await caller().project.conversations({ projectId: project.id })

    expect(list.map((c) => c.id)).toEqual([second.sessionId, first.sessionId])
    expect(list[0]).toMatchObject({ status: 'launching', resumable: false })
    expect(list[1]).toMatchObject({ status: 'ended', resumable: true })
    expect(list[0].createdAt).toBeGreaterThan(0)
  })

  it('titles a conversation from the human’s first message, not the injected kickoff', async () => {
    const { sessionId } = await launch()
    giveTranscript(sessionId, [
      entry('user', KICKOFF_LINES.project),
      entry('assistant', [{ type: 'text', text: 'What are we building?' }]),
      entry('user', 'I want offline mode for the mobile app'),
      entry('user', 'and also dark mode'),
    ])

    const [conversation] = await caller().project.conversations({ projectId: project.id })

    expect(conversation.title).toBe('I want offline mode for the mobile app')
  })

  it('caches the derived title on the row, so the list stops re-reading transcripts', async () => {
    const { sessionId } = await launch()
    const path = giveTranscript(sessionId, [entry('user', 'rework the review page')])

    await caller().project.conversations({ projectId: project.id })
    expect(getSessionRow(ctx, sessionId)?.title).toBe('rework the review page')

    // The transcript is Claude Code's, not ours — it can vanish, and the name
    // the human already saw in the list must not vanish with it.
    rmSync(path)
    const [conversation] = await caller().project.conversations({ projectId: project.id })
    expect(conversation.title).toBe('rework the review page')
  })

  it('elides a long opening message', async () => {
    const { sessionId } = await launch()
    giveTranscript(sessionId, [entry('user', 'x'.repeat(200))])

    const [conversation] = await caller().project.conversations({ projectId: project.id })

    expect(conversation.title).toHaveLength(TITLE_MAX + 1)
    expect(conversation.title.endsWith('…')).toBe(true)
  })

  it('falls back to the date when nothing has been said yet, and does not cache that', async () => {
    const { sessionId } = await launch()

    const [conversation] = await caller().project.conversations({ projectId: project.id })

    expect(conversation.title).toMatch(/^Chat from \d{4}-\d{2}-\d{2}$/)
    expect(getSessionRow(ctx, sessionId)?.title).toBeUndefined()
  })
})

describe('reading a conversation back', () => {
  let ctx: AppCtx
  let project: Project
  let scratch: string
  const cleanup: string[] = []

  beforeEach(async () => {
    ctx = await makeTestCtx()
    project = seedProject(ctx)
    scratch = mkdtempSync(join(tmpdir(), 'rc-convo-read-'))
    cleanup.push(scratch)
  })

  afterEach(() => {
    for (const d of cleanup) rmSync(d, { recursive: true, force: true })
    cleanup.length = 0
  })

  let seq = 0

  /** A session row with a transcript, without spawning anything. */
  function seedSession(lines: string[] | null): string {
    const id = `sess_seeded_${(seq += 1)}`
    let transcriptPath: string | null = null
    if (lines) {
      transcriptPath = join(scratch, `${id}.jsonl`)
      writeFileSync(transcriptPath, `${lines.join('\n')}\n`)
    }
    ctx.db
      .insert(sessions)
      .values({
        id,
        projectId: project.id,
        kind: 'project',
        status: 'ended',
        worktreePath: '/wt',
        transcriptPath,
        createdAt: Date.now(),
      })
      .run()
    return id
  }

  const caller = () => createCallerFactory(appRouter)(ctx)

  it('returns the said turns, with the tool traffic stripped out', async () => {
    const id = seedSession([
      entry('user', 'add a settings page'),
      entry('assistant', [
        { type: 'text', text: 'Looking at what exists.' },
        { type: 'tool_use', id: 'tu_1', name: 'Read', input: { file: 'x.ts' } },
      ]),
      entry('user', [{ type: 'tool_result', tool_use_id: 'tu_1', content: 'file contents' }]),
      entry('assistant', 'I would split that in two.'),
      entry('summary', 'a compaction summary'),
      entry('user', 'ignore me', { isMeta: true }),
      'not json at all',
    ])

    expect(await caller().project.conversationTranscript({ sessionId: id })).toEqual([
      { role: 'user', text: 'add a settings page' },
      { role: 'assistant', text: 'Looking at what exists.' },
      { role: 'assistant', text: 'I would split that in two.' },
    ])
  })

  it('is empty rather than an error when the transcript file is gone', async () => {
    const id = seedSession([entry('user', 'hello')])
    rmSync(join(scratch, `${id}.jsonl`))

    expect(await caller().project.conversationTranscript({ sessionId: id })).toEqual([])
  })

  it('is empty for a conversation that never recorded a transcript, or does not exist', async () => {
    expect(await caller().project.conversationTranscript({ sessionId: seedSession(null) })).toEqual([])
    expect(await caller().project.conversationTranscript({ sessionId: 'sess_nope' })).toEqual([])
  })
})

describe('opening a project conversation', () => {
  let ctx: AppCtx
  let project: Project
  let repoPath: string
  const cleanup: string[] = []
  let restoreDataDir: () => void

  beforeEach(async () => {
    const home = mkdtempSync(join(tmpdir(), 'rc-convo-launch-home-'))
    cleanup.push(home)
    restoreDataDir = useDataDir(home)

    ctx = await makeTestCtx()
    repoPath = mkdtempSync(join(tmpdir(), 'rc-convo-launch-repo-'))
    cleanup.push(repoPath)
    initRepo(repoPath)
    project = seedProject(ctx, repoPath)
  })

  afterEach(async () => {
    await awaitProjectLandings()
    restoreDataDir()
    for (const d of cleanup) rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    cleanup.length = 0
  })

  function launchCommand(): string {
    const launched = listByProject(ctx, project.id)
      .filter((e) => e.type === 'session.launched')
      .at(-1)
    return String((launched?.data as { command?: string })?.command ?? '')
  }

  function endWithCcId(sessionId: string, ccSessionId: string): void {
    endSession(ctx, sessionId)
    ctx.db.update(sessions).set({ ccSessionId }).where(eq(sessions.id, sessionId)).run()
  }

  /**
   * The reversal (decision 5). This used to resume the one endless conversation
   * whatever the human meant by opening the chat.
   */
  it('starts a NEW conversation by default, even with a resumable one behind it', async () => {
    const first = await launchProjectSession(ctx, { projectId: project.id }, { spawn: false })
    endWithCcId(first.sessionId, 'cc-project-1')

    await launchProjectSession(ctx, { projectId: project.id }, { spawn: false })

    expect(launchCommand()).not.toContain('--resume')
    expect(listByProject(ctx, project.id).map((e) => e.type)).not.toContain('session.resumed')
  })

  it('resumes the conversation it is pointed at, not the most recent one', async () => {
    const older = await launchProjectSession(ctx, { projectId: project.id }, { spawn: false })
    endWithCcId(older.sessionId, 'cc-older')
    const newer = await launchProjectSession(ctx, { projectId: project.id }, { spawn: false })
    endWithCcId(newer.sessionId, 'cc-newer')

    await launchProjectSession(
      ctx,
      { projectId: project.id, resumeSessionId: older.sessionId },
      { spawn: false },
    )

    expect(launchCommand()).toContain('--resume cc-older')
    expect(listByProject(ctx, project.id).map((e) => e.type)).toContain('session.resumed')
  })

  it('starts fresh, and says so, when the chosen conversation never reached Claude Code', async () => {
    const never = await launchProjectSession(ctx, { projectId: project.id }, { spawn: false })
    endSession(ctx, never.sessionId)

    await launchProjectSession(
      ctx,
      { projectId: project.id, resumeSessionId: never.sessionId },
      { spawn: false },
    )

    expect(launchCommand()).not.toContain('--resume')
    expect(listByProject(ctx, project.id).map((e) => e.type)).toContain(
      'session.resume_unavailable',
    )
  })

  it('lets `fresh` overrule a conversation id, so New chat can never resume', async () => {
    const prior = await launchProjectSession(ctx, { projectId: project.id }, { spawn: false })
    endWithCcId(prior.sessionId, 'cc-prior')

    await launchProjectSession(
      ctx,
      { projectId: project.id, fresh: true, resumeSessionId: prior.sessionId },
      { spawn: false },
    )

    expect(launchCommand()).not.toContain('--resume')
  })

  /** Many stored conversations, still one terminal (the launcher's rule stands). */
  it('still refuses a second live conversation', async () => {
    await launchProjectSession(ctx, { projectId: project.id }, { spawn: false })

    await expect(
      launchProjectSession(ctx, { projectId: project.id }, { spawn: false }),
    ).rejects.toThrow(/already open/i)
  })

  it('takes the whole contract over tRPC', async () => {
    const trpc = createCallerFactory(appRouter)(ctx)
    expect(typeof trpc.project.talkToProject).toBe('function')
    expect(typeof trpc.project.conversations).toBe('function')
    expect(typeof trpc.project.conversationTranscript).toBe('function')
  })
})
