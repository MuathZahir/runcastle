import { statSync } from 'node:fs'
import {
  awaitsHuman,
  DEFAULT_RUNTIME,
  foldThread,
  type SessionKind,
  type SessionRow,
  type ThreadEntry,
  type ThreadEvent,
  type ThreadView,
} from '@runcastle/core'
import type { AppCtx } from '../db/types'
import { GateError } from '../errors'
import { featureSessions, getSessionRow, projectSessions, setSessionTitle } from '../launcher/sessions'
import { conversationTranscript, deriveTitle } from '../services/conversations'
import { withRelativePaths } from './acp-map'
import { appendThreadEvent, hasThreadLog, readThreadEvents, seedThreadLog, threadLogPath } from './log'
import { NEW_CHAT_NAME, threadAbout, threadName, type ThreadAbout } from './naming'
import { agentHost } from './types'

/**
 * The thread router's reads (chat-as-web-components; ADR-0015): the thread
 * list, a thread's events, and its folded view. A thread is read from its log;
 * a conversation from the terminal era has no log, and reads back from its
 * transcript as plain turns until it is continued.
 */

/** The conversation kinds a feature's thread list holds, and the project's. */
const FEATURE_THREAD_KINDS: SessionKind[] = ['chat', 'side', 'scenario', 'drive-fix']
const PROJECT_THREAD_KINDS: SessionKind[] = ['project', 'prepare']

const ROLE: Record<SessionKind, ThreadEntry['role']> = {
  chat: 'main',
  side: 'side',
  scenario: 'scenario',
  'drive-fix': 'scenario',
  project: 'project',
  prepare: 'prepare',
}

/** The row behind a thread id; an unknown id is the caller's mistake. */
export function threadRow(ctx: AppCtx, threadId: string): SessionRow {
  const row = getSessionRow(ctx, threadId)
  if (!row) throw new GateError(`no thread ${threadId}`)
  return row
}

/**
 * The row whose transcript a terminal-era thread reads back: its own, or — when
 * the relaunch that made this row never recorded one — another row of the same
 * conversation that did. Null for a row with no conversation on record.
 */
function transcriptRow(ctx: AppCtx, row: SessionRow): SessionRow | null {
  if (row.transcriptPath) return row
  if (!row.ccSessionId) return null
  const siblings = row.featureId
    ? featureSessions(ctx, row.featureId, [row.kind])
    : row.projectId
      ? projectSessions(ctx, row.projectId, row.kind)
      : []
  return siblings.find((r) => r.ccSessionId === row.ccSessionId && r.transcriptPath) ?? null
}

/**
 * A terminal-era conversation's transcript as thread events: each human turn a
 * prompt, each answer a whole turn of words. The launcher's kickoff lines are
 * left out, as the transcript pane leaves them out. No process runs behind it,
 * so a last prompt that got no answer folds as said, not as starting an agent.
 * A slash command reads as what was typed, and the CLI's own lines are dropped
 * (see {@link typedText}).
 */
function transcriptEvents(ctx: AppCtx, row: SessionRow): ThreadEvent[] {
  const at = row.createdAt ?? 0
  const events: ThreadEvent[] = []
  const push = (body: Record<string, unknown>) => events.push({ ...body, i: events.length, at } as ThreadEvent)
  const source = transcriptRow(ctx, row)
  if (!source) return events
  conversationTranscript(ctx, source.id).turns.forEach((turn, n) => {
    if (turn.role === 'user') {
      const text = typedText(turn.text)
      if (text !== null) push({ type: 'prompt', id: `${row.id}-t${n}`, text, source: 'human' })
    } else {
      push({ type: 'turn_started' })
      push({ type: 'agent_text', messageId: `${row.id}-t${n}`, text: turn.text })
      push({ type: 'turn_ended', reason: 'end_turn' })
    }
  })
  if (events.at(-1)?.type === 'prompt') push({ type: 'process', state: 'stopped' })
  return events
}

const COMMAND_NAME = /<command-name>([\s\S]*?)<\/command-name>/
const COMMAND_ARGS = /<command-args>([\s\S]*?)<\/command-args>/

/**
 * What the human typed in a Claude Code terminal's `user` turn, or null for a
 * turn the CLI wrote itself. A slash command is recorded as markup
 * (`<command-name>/model</command-name>…<command-args>sonnet</command-args>`)
 * and reads back as the line typed, `/model sonnet`; its output and the caveat
 * before it (`<local-command-stdout>…`, `<local-command-caveat>…`) were never
 * said by anyone, and are dropped.
 */
function typedText(text: string): string | null {
  const trimmed = text.trim()
  if (trimmed.startsWith('<local-command-')) return null
  const name = COMMAND_NAME.exec(trimmed)?.[1]?.trim()
  if (!name) return text
  return `${name} ${COMMAND_ARGS.exec(trimmed)?.[1]?.trim() ?? ''}`.trim()
}

/**
 * Continue a terminal-era conversation: before anything else is logged, its log
 * starts as the transcript's turns, indexed as {@link threadEvents} read them
 * back, so history survives a reload and a client holding those turns reads on
 * after them. The kickoff the conversation began with is left out of the turns,
 * so the log says runcastle `briefed` it. No-op for a thread with a log, or with
 * no conversation on record.
 */
export function seedFromTranscript(ctx: AppCtx, threadId: string): void {
  if (hasThreadLog(threadId)) return
  const events = transcriptEvents(ctx, threadRow(ctx, threadId))
  if (!events.length) return
  seedThreadLog(threadId, events)
  appendThreadEvent(threadId, { type: 'briefed' })
}

/** The thread's events after `after`: its log, or its transcript's turns when it has no log. */
export function threadEvents(ctx: AppCtx, threadId: string, after?: number): ThreadEvent[] {
  const row = threadRow(ctx, threadId)
  if (hasThreadLog(threadId)) return readThreadEvents(threadId, after).map((e) => withRelativePaths(row.worktreePath, e))
  const events = transcriptEvents(ctx, row)
  return after === undefined ? events : events.filter((e) => e.i > after)
}

export function threadView(ctx: AppCtx, threadId: string): ThreadView {
  return foldThread(threadEvents(ctx, threadId))
}

/** Folds of logged threads, kept until the log file changes. */
const folds = new Map<string, { key: string; view: ThreadView; events: ThreadEvent[] }>()

function foldedLog(threadId: string): { view: ThreadView; events: ThreadEvent[] } {
  const stat = statSync(threadLogPath(threadId))
  const key = `${stat.size}:${stat.mtimeMs}`
  const cached = folds.get(threadId)
  if (cached?.key === key) return cached
  const events = readThreadEvents(threadId)
  const entry = { key, view: foldThread(events), events }
  folds.set(threadId, entry)
  return entry
}

function titleFrom(row: SessionRow, said: string[]): string | null {
  return deriveTitle(
    said.map((text) => ({ role: 'user' as const, text })),
    row.runtime ?? DEFAULT_RUNTIME,
    row.kind,
  )
}

function loggedEntry(ctx: AppCtx, row: SessionRow, about: ThreadAbout): ThreadEntry {
  const { view, events } = foldedLog(row.id)
  return {
    id: row.id,
    title: threadName(row, events, about),
    role: ROLE[row.kind],
    // No process survives a restart: a log cut off mid-turn is not working.
    state: agentHost(ctx).isRunning(row.id) ? view.state : 'idle',
    createdAt: row.createdAt ?? 0,
    updatedAt: events.at(-1)?.at ?? row.createdAt ?? 0,
    runtime: row.runtime ?? DEFAULT_RUNTIME,
  }
}

/**
 * The feature's lead waits on the human (decision 15): {@link awaitsHuman} over
 * its main chat — the newest one with a log, as the thread list's newest main
 * entry — so the header and the sidebar read one answer. A conversation from
 * the terminal era has no log, and waits on nobody.
 */
export function leadAwaitsHuman(ctx: AppCtx, featureId: string): boolean {
  let newest: { at: number; waits: boolean } | null = null
  for (const row of featureSessions(ctx, featureId, ['chat'])) {
    if (!hasThreadLog(row.id)) continue
    const { events } = foldedLog(row.id)
    const at = events.at(-1)?.at ?? row.createdAt ?? 0
    if (newest && newest.at >= at) continue
    newest = { at, waits: awaitsHuman(events, agentHost(ctx).isRunning(row.id)) }
  }
  return newest?.waits ?? false
}

/** A thread nothing has been said in yet. */
function freshEntry(row: SessionRow, about: ThreadAbout): ThreadEntry {
  return {
    id: row.id,
    title: threadName(row, [], about),
    role: ROLE[row.kind],
    state: 'idle',
    createdAt: row.createdAt ?? 0,
    updatedAt: row.createdAt ?? 0,
    runtime: row.runtime ?? DEFAULT_RUNTIME,
  }
}

function transcriptEntry(ctx: AppCtx, row: SessionRow, source: SessionRow): ThreadEntry {
  let title = row.title
  if (!title) {
    // Derived once and cached on the row, as the conversation list does: the
    // first thing said never changes, and the column saves re-reading transcripts.
    const turns = conversationTranscript(ctx, source.id).turns
    title = titleFrom(row, turns.flatMap((t) => (t.role === 'user' ? [t.text] : [])))
    if (title) setSessionTitle(ctx, row.id, title)
  }
  return {
    id: row.id,
    title: title ?? NEW_CHAT_NAME,
    role: ROLE[row.kind],
    state: 'idle',
    createdAt: row.createdAt ?? 0,
    updatedAt: row.endedAt ?? row.createdAt ?? 0,
    runtime: row.runtime ?? DEFAULT_RUNTIME,
    readOnlyTranscript: true,
  }
}

/**
 * The feature's or the project's threads, newest first. A terminal-era
 * conversation spans many rows (each relaunch resumed it on a new one), so it
 * is listed once, by its newest row; once continued it has a log and is a
 * thread like any other. A row with neither a log nor a transcript is listed
 * only while it is not ended: an ended one never said anything.
 */
export function listThreads(ctx: AppCtx, scope: { featureId: string } | { projectId: string }): ThreadEntry[] {
  const rows =
    'featureId' in scope
      ? featureSessions(ctx, scope.featureId, FEATURE_THREAD_KINDS)
      : PROJECT_THREAD_KINDS.flatMap((kind) => projectSessions(ctx, scope.projectId, kind))
  const about = threadAbout(ctx, 'featureId' in scope ? scope.featureId : null)
  const conversations = new Set<string>()
  const entries: ThreadEntry[] = []
  for (const row of rows) {
    if (row.ccSessionId && conversations.has(row.ccSessionId)) continue
    if (row.ccSessionId) conversations.add(row.ccSessionId)
    if (hasThreadLog(row.id)) {
      entries.push(loggedEntry(ctx, row, about))
      continue
    }
    const source = transcriptRow(ctx, row)
    if (source) entries.push(transcriptEntry(ctx, row, source))
    else if (row.status !== 'ended') entries.push(freshEntry(row, about))
  }
  return entries.sort((a, b) => b.updatedAt - a.updatedAt)
}
