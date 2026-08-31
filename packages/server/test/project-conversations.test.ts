import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentRuntime, Project } from '@runcastle/core'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { sessions } from '../src/db/schema'
import { launchProjectSession } from '../src/launcher/launcher'
import { KICKOFF_LINES } from '../src/launcher/runtimes/claude'
import { KICKOFF_LINES as CODEX_KICKOFF_LINES } from '../src/launcher/runtimes/codex'
import {
  awaitProjectLandings,
  getSessionRow,
  resumeKickoffLine,
} from '../src/launcher/sessions'
import { endSession } from '../src/pty/end-session'
import { deriveTitle, TITLE_MAX } from '../src/services/conversations'
import type { TranscriptTurn } from '../src/services/transcripts'
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

/**
 * Naming a conversation (decision 5). The first `user` turn on disk is not the
 * first thing the human SAID: slash commands, image pastes and interruptions are
 * all recorded as user turns, and on the runcastle project they had named 15 of
 * 19 rows.
 */
describe('deriving a conversation’s name', () => {
  const said = (role: 'user' | 'assistant', text: string): TranscriptTurn => ({ role, text })

  it('skips a slash command, which the runtime records as a user turn', () => {
    expect(
      deriveTitle(
        [
          said('user', '<command-name>/clear</command-name>\n<command-message>clear</command-message>'),
          said('user', 'rework the review page'),
        ],
        'claude-code',
      ),
    ).toBe('rework the review page')
  })

  it('skips an interruption', () => {
    expect(
      deriveTitle(
        [said('user', '[Request interrupted by user]'), said('user', 'rework the review page')],
        'claude-code',
      ),
    ).toBe('rework the review page')
  })

  it('strips the image tokens out of the turn it names the conversation after', () => {
    expect(
      deriveTitle([said('user', '[Image #1] this list is unusable')], 'claude-code'),
    ).toBe('this list is unusable')
  })

  /** A bare paste says nothing about what the conversation is; keep looking. */
  it('skips a turn that is nothing but images', () => {
    expect(
      deriveTitle(
        [said('user', '[Image #1] [Image #2]'), said('user', 'make the dot green')],
        'claude-code',
      ),
    ).toBe('make the dot green')
  })

  it('has no name for a conversation the human never spoke in', () => {
    expect(
      deriveTitle(
        [said('user', '<command-name>/model</command-name>'), said('assistant', 'Switched.')],
        'claude-code',
      ),
    ).toBeNull()
  })
})

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

  /** Record the Claude Code session id the SessionStart hook reports a beat later. */
  function giveCcId(sessionId: string, ccSessionId: string): void {
    ctx.db.update(sessions).set({ ccSessionId }).where(eq(sessions.id, sessionId)).run()
  }

  let ccSeq = 0

  /**
   * A launch the CLI picked up. Every listed row has a Claude Code conversation
   * behind it (decision 4), so a fixture without one is a fixture of the case
   * the list deliberately hides.
   */
  async function launch(ccSessionId = `cc-${(ccSeq += 1)}`): Promise<{ sessionId: string }> {
    const launched = await launchProjectSession(ctx, { projectId: project.id }, { spawn: false })
    giveCcId(launched.sessionId, ccSessionId)
    return launched
  }

  it('is empty for a project nobody has talked to', async () => {
    expect(await caller().project.conversations({ projectId: project.id })).toEqual([])
  })

  it('lists every conversation newest first, with its date, status and resumability', async () => {
    const first = await launch()
    endSession(ctx, first.sessionId)
    const second = await launch()

    const list = await caller().project.conversations({ projectId: project.id })

    expect(list.map((c) => c.id)).toEqual([second.sessionId, first.sessionId])
    expect(list[0]).toMatchObject({ status: 'launching', resumable: true })
    expect(list[1]).toMatchObject({ status: 'ended', resumable: true })
    expect(list[0].createdAt).toBeGreaterThan(0)
  })

  /**
   * The duplication this collapses (decision 4): `--resume` keeps the CLI's
   * session id, so every reopen inserted a second row of the SAME conversation
   * — three duplicate pairs on the runcastle project itself.
   */
  it('collapses the rows of one Claude Code conversation into a single row', async () => {
    const first = await launch('cc-same')
    endSession(ctx, first.sessionId)
    const reopened = await launchProjectSession(
      ctx,
      { projectId: project.id, resumeSessionId: first.sessionId },
      { spawn: false },
    )
    giveCcId(reopened.sessionId, 'cc-same')

    const list = await caller().project.conversations({ projectId: project.id })

    expect(list).toHaveLength(1)
    // Reopen hands this id straight back to `talkToProject`, which must resume
    // the LATEST session of the conversation, not the one it started as.
    expect(list[0].id).toBe(reopened.sessionId)
    expect(list[0].status).toBe('launching')
  })

  it('dates a collapsed conversation by its first launch', async () => {
    const first = await launch('cc-same')
    const firstAt = getSessionRow(ctx, first.sessionId)?.createdAt
    endSession(ctx, first.sessionId)
    const reopened = await launch('cc-same')
    ctx.db
      .update(sessions)
      .set({ createdAt: (firstAt ?? 0) + 60_000 })
      .where(eq(sessions.id, reopened.sessionId))
      .run()

    const [conversation] = await caller().project.conversations({ projectId: project.id })

    expect(conversation.createdAt).toBe(firstAt)
  })

  /** Nothing to read and nothing to resume: a row the CLI never picked up. */
  it('does not list a launch that never reached Claude Code', async () => {
    const orphan = await launchProjectSession(ctx, { projectId: project.id }, { spawn: false })
    endSession(ctx, orphan.sessionId)
    const real = await launch()

    const list = await caller().project.conversations({ projectId: project.id })

    expect(list.map((c) => c.id)).toEqual([real.sessionId])
  })

  /** The conversation's real first words are in the transcript it began with. */
  it('names a collapsed conversation from its earliest session', async () => {
    const first = await launch('cc-same')
    giveTranscript(first.sessionId, [entry('user', 'rework the review page')])
    endSession(ctx, first.sessionId)
    const reopened = await launch('cc-same')
    giveTranscript(reopened.sessionId, [entry('user', 'now the burn view')])

    const [conversation] = await caller().project.conversations({ projectId: project.id })

    expect(conversation.title).toBe('rework the review page')
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

  it('is Untitled when nothing has been said yet, and does not cache that', async () => {
    const { sessionId } = await launch()

    const [conversation] = await caller().project.conversations({ projectId: project.id })

    expect(conversation.title).toBe('Untitled')
    expect(getSessionRow(ctx, sessionId)?.title).toBeUndefined()
  })

  /**
   * The one-time self-heal (decision 5). Rows named before the derivation
   * learned to skip a `/clear` carry that junk in the cache, where no amount of
   * fixing the derivation would ever reach it.
   */
  it('clears a junk cached title and re-derives it', async () => {
    const { sessionId } = await launch()
    giveTranscript(sessionId, [
      entry('user', '<command-name>/clear</command-name>'),
      entry('user', 'rework the review page'),
    ])
    ctx.db
      .update(sessions)
      .set({ title: '<command-name>/clear</command-name> <command-message>clear</comman…' })
      .where(eq(sessions.id, sessionId))
      .run()

    const [conversation] = await caller().project.conversations({ projectId: project.id })

    expect(conversation.title).toBe('rework the review page')
    expect(getSessionRow(ctx, sessionId)?.title).toBe('rework the review page')
  })

  it('forgets a junk cached title even when there is nothing to re-derive', async () => {
    const { sessionId } = await launch()
    ctx.db
      .update(sessions)
      .set({ title: '[Request interrupted by user]' })
      .where(eq(sessions.id, sessionId))
      .run()

    const [conversation] = await caller().project.conversations({ projectId: project.id })

    expect(conversation.title).toBe('Untitled')
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
  function seedSession(lines: string[] | null, runtime: AgentRuntime | null = null): string {
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
        // A conversation the CLI picked up, so the list shows it (decision 4).
        ccSessionId: id,
        transcriptPath,
        runtime,
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

    expect(await caller().project.conversationTranscript({ sessionId: id })).toEqual({
      status: 'ok',
      runtime: 'claude-code',
      turns: [
        { role: 'user', text: 'add a settings page' },
        { role: 'assistant', text: 'Looking at what exists.' },
        { role: 'assistant', text: 'I would split that in two.' },
      ],
    })
  })

  /**
   * The other runtime, through the same pane (decision 10). A Codex session
   * records a rollout instead of a Claude transcript, and the pane must not have
   * to know that — including the `$`-spelled kickoff, which is dropped by the
   * same matcher because the adapter is what spells it.
   */
  it('reads a Codex session’s rollout into the same turns', async () => {
    const said = (role: 'user' | 'assistant', text: string) =>
      JSON.stringify({
        timestamp: '2026-01-01T00:00:00.000Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role,
          content: [{ type: role === 'user' ? 'input_text' : 'output_text', text }],
        },
      })
    const id = seedSession(
      [
        JSON.stringify({ timestamp: '2026-01-01T00:00:00.000Z', type: 'session_meta', payload: { id: 'r1' } }),
        said('user', CODEX_KICKOFF_LINES.project),
        said('assistant', 'What are we building?'),
        said('user', 'offline mode for the mobile app'),
      ],
      'codex',
    )

    expect(await caller().project.conversationTranscript({ sessionId: id })).toEqual({
      status: 'ok',
      runtime: 'codex',
      turns: [
        { role: 'assistant', text: 'What are we building?' },
        { role: 'user', text: 'offline mode for the mobile app' },
      ],
    })
  })

  /**
   * The derived title runs through the same kickoff matcher, so it needs the
   * same runtime — the adapters spell the kickoff differently, and a Codex
   * conversation matched against Claude's spelling would be NAMED after the
   * launcher's own opening line.
   */
  it('titles a Codex conversation from the human’s first message, not its kickoff', async () => {
    const said = (role: 'user' | 'assistant', text: string) =>
      JSON.stringify({
        timestamp: '2026-01-01T00:00:00.000Z',
        type: 'response_item',
        payload: { type: 'message', role, content: [{ type: 'input_text', text }] },
      })
    const id = seedSession(
      [said('user', CODEX_KICKOFF_LINES.project), said('user', 'rework the review page')],
      'codex',
    )

    const list = await caller().project.conversations({ projectId: project.id })

    expect(list.find((c) => c.id === id)?.title).toBe('rework the review page')
  })

  /** A rollout format we do not recognise is said so, not rendered as silence. */
  it('reports a transcript it cannot parse as unavailable', async () => {
    const id = seedSession(['{"some":"format we have never seen"}'], 'codex')

    expect(await caller().project.conversationTranscript({ sessionId: id })).toEqual({
      status: 'unavailable',
      runtime: 'codex',
      turns: [],
    })
  })

  /**
   * The kickoff is a `user` turn on disk, but nobody typed it — the launcher
   * did. The title path has always known that; the transcript used to render it
   * as the human's opening line.
   */
  it('never hands back the launcher’s kickoff as something the human said', async () => {
    const id = seedSession([
      entry('user', KICKOFF_LINES.project),
      entry('assistant', 'What are we building?'),
      entry('user', 'offline mode for the mobile app'),
    ])

    expect((await caller().project.conversationTranscript({ sessionId: id })).turns).toEqual([
      { role: 'assistant', text: 'What are we building?' },
      { role: 'user', text: 'offline mode for the mobile app' },
    ])
  })

  /** Reopening a conversation re-sends the kickoff, wrapped in the resume framing. */
  it('drops every kickoff, not just the first turn', async () => {
    const id = seedSession([
      entry('user', KICKOFF_LINES.project),
      entry('assistant', 'What are we building?'),
      entry('user', 'offline mode'),
      entry('user', resumeKickoffLine('project')),
      entry('assistant', 'We were slicing offline mode.'),
    ])

    const { turns } = await caller().project.conversationTranscript({ sessionId: id })

    expect(turns.filter((t) => t.role === 'user')).toEqual([{ role: 'user', text: 'offline mode' }])
  })

  /** Kickoff plus the answer it drew is nothing the human took part in. */
  it('leaves nothing the human said in a conversation that was only ever kicked off', async () => {
    const id = seedSession([
      entry('user', KICKOFF_LINES.project),
      entry('assistant', 'Tell me what you have in mind.'),
    ])

    const { turns } = await caller().project.conversationTranscript({ sessionId: id })

    expect(turns.some((t) => t.role === 'user')).toBe(false)
  })

  /** A record that is gone is an empty conversation, NOT a format we failed to read. */
  it('is empty rather than an error when the transcript file is gone', async () => {
    const id = seedSession([entry('user', 'hello')])
    rmSync(join(scratch, `${id}.jsonl`))

    expect(await caller().project.conversationTranscript({ sessionId: id })).toEqual({
      status: 'ok',
      runtime: 'claude-code',
      turns: [],
    })
  })

  it('is empty for a conversation that never recorded a transcript, or does not exist', async () => {
    const empty = { status: 'ok', runtime: 'claude-code', turns: [] }
    expect(await caller().project.conversationTranscript({ sessionId: seedSession(null) })).toEqual(empty)
    expect(await caller().project.conversationTranscript({ sessionId: 'sess_nope' })).toEqual(empty)
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
