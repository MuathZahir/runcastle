import { statSync } from 'node:fs'
import {
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
import { hasThreadLog, readThreadEvents, threadLogPath } from './log'
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

/** What a thread with nothing said in it yet is called. */
const UNTITLED = 'Untitled'

/** The row behind a thread id; an unknown id is the caller's mistake. */
export function threadRow(ctx: AppCtx, threadId: string): SessionRow {
  const row = getSessionRow(ctx, threadId)
  if (!row) throw new GateError(`no thread ${threadId}`)
  return row
}

/**
 * A terminal-era conversation's transcript as thread events: each human turn a
 * prompt, each answer a whole turn of words. The launcher's kickoff lines are
 * left out, as the transcript pane leaves them out.
 */
function transcriptEvents(ctx: AppCtx, row: SessionRow): ThreadEvent[] {
  const at = row.createdAt ?? 0
  const events: ThreadEvent[] = []
  const push = (body: Record<string, unknown>) => events.push({ ...body, i: events.length, at } as ThreadEvent)
  conversationTranscript(ctx, row.id).turns.forEach((turn, n) => {
    if (turn.role === 'user') push({ type: 'prompt', id: `${row.id}-t${n}`, text: turn.text, source: 'human' })
    else {
      push({ type: 'turn_started' })
      push({ type: 'agent_text', messageId: `${row.id}-t${n}`, text: turn.text })
      push({ type: 'turn_ended', reason: 'end_turn' })
    }
  })
  return events
}

/** The thread's events after `after`: its log, or its transcript's turns when it has no log. */
export function threadEvents(ctx: AppCtx, threadId: string, after?: number): ThreadEvent[] {
  const row = threadRow(ctx, threadId)
  if (hasThreadLog(threadId)) return readThreadEvents(threadId, after)
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

function loggedEntry(ctx: AppCtx, row: SessionRow): ThreadEntry {
  const { view, events } = foldedLog(row.id)
  const said = events.flatMap((e) => (e.type === 'prompt' && e.source === 'human' ? [e.text] : []))
  return {
    id: row.id,
    title: row.title ?? view.title ?? titleFrom(row, said) ?? UNTITLED,
    role: ROLE[row.kind],
    // No process survives a restart: a log cut off mid-turn is not working.
    state: agentHost(ctx).isRunning(row.id) ? view.state : 'idle',
    updatedAt: events.at(-1)?.at ?? row.createdAt ?? 0,
    runtime: row.runtime ?? DEFAULT_RUNTIME,
  }
}

/** A thread nothing has been said in yet. */
function freshEntry(row: SessionRow): ThreadEntry {
  return {
    id: row.id,
    title: row.title ?? UNTITLED,
    role: ROLE[row.kind],
    state: 'idle',
    updatedAt: row.createdAt ?? 0,
    runtime: row.runtime ?? DEFAULT_RUNTIME,
  }
}

function transcriptEntry(ctx: AppCtx, row: SessionRow): ThreadEntry {
  let title = row.title
  if (!title) {
    // Derived once and cached on the row, as the conversation list does: the
    // first thing said never changes, and the column saves re-reading transcripts.
    const turns = conversationTranscript(ctx, row.id).turns
    title = titleFrom(row, turns.flatMap((t) => (t.role === 'user' ? [t.text] : [])))
    if (title) setSessionTitle(ctx, row.id, title)
  }
  return {
    id: row.id,
    title: title ?? UNTITLED,
    role: ROLE[row.kind],
    state: 'idle',
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
  const conversations = new Set<string>()
  const entries: ThreadEntry[] = []
  for (const row of rows) {
    if (row.ccSessionId && conversations.has(row.ccSessionId)) continue
    if (row.ccSessionId) conversations.add(row.ccSessionId)
    if (hasThreadLog(row.id)) entries.push(loggedEntry(ctx, row))
    else if (row.transcriptPath) entries.push(transcriptEntry(ctx, row))
    else if (row.status !== 'ended') entries.push(freshEntry(row))
  }
  return entries.sort((a, b) => b.updatedAt - a.updatedAt)
}
