import { statSync } from 'node:fs'
import {
  DEFAULT_RUNTIME,
  foldThread,
  lastHumanAt,
  lastTurnAnsweredHuman,
  newestNeed,
  type Need,
  outsideCompactions,
  threadActivity,
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
import { isRuncastlePrompt, runcastleLines } from '../services/lead-prompt'
import { withRelativePaths } from './acp-map'
import { appendThreadEvent, hasThreadLog, readThreadEvents, seedThreadLog, threadLogPath } from './log'
import { givenNames, NEW_CHAT_NAME, threadAbout, threadName, type ThreadAbout } from './naming'
import { agentHost } from './types'
import { waitOf } from '../services/waits'

/**
 * The thread router's reads (chat-as-web-components; ADR-0015): the thread
 * list, a thread's events, and its folded view. A thread is read from its log;
 * a conversation from the terminal era has no log, and reads back from its
 * transcript as plain turns until it is continued.
 */

/** The conversation kinds a feature's thread list holds, and the project's. */
const FEATURE_THREAD_KINDS: SessionKind[] = ['chat', 'side', 'worker', 'scenario', 'drive-fix']
const PROJECT_THREAD_KINDS: SessionKind[] = ['project']

const ROLE: Record<SessionKind, ThreadEntry['role']> = {
  chat: 'main',
  // A side chat from before workers: listed, read-only (interactive-workers decision 23).
  side: 'side',
  worker: 'worker',
  // The drive's chats are workers now; the ones from before stay as read-only transcripts.
  scenario: 'old-drive-chat',
  'drive-fix': 'old-drive-chat',
  project: 'project',
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
 * A conversation's transcript as thread events, for a thread with no log — one
 * from the terminal era, or any thread in a test drive, whose copied data has
 * the database but not the logs. Each user turn is a prompt, runcastle's or the
 * human's by its tag, and each answer a whole turn of words. The launcher's
 * kickoff lines are left out, as the transcript pane leaves them out. No process runs behind it,
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
      if (text === null) return
      const id = `${row.id}-t${n}`
      if (isRuncastlePrompt(text)) push({ type: 'prompt', id, text: runcastleLines(text), source: 'runcastle' })
      else push({ type: 'prompt', id, text, source: 'human' })
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
  const running = agentHost(ctx).isRunning(row.id)
  const background = running && threadActivity(events, true, Date.now()) === 'background'
  const given = givenNames(events)
  return {
    id: row.id,
    title: threadName(row, events, about),
    epicNamed: given.epicName !== undefined,
    humanNamed: given.renamed !== undefined,
    role: ROLE[row.kind],
    // No process survives a restart: a log cut off mid-turn is not working.
    state: background ? 'working' : running ? view.state : 'idle',
    need: threadNeed(ctx, row),
    createdAt: row.createdAt ?? 0,
    updatedAt: events.at(-1)?.at ?? row.createdAt ?? 0,
    lastHumanAt: lastHumanAt(events),
    runtime: row.runtime ?? DEFAULT_RUNTIME,
    ...epicLookOf(row),
  }
}

/** What a feature's lead is doing, as {@link leadState} reads it: its turn, never a need. */
export interface LeadState {
  /** It ended its turn and its background work still runs. */
  inBackground: boolean
  /** Its process runs and it is mid-turn or its background work still runs. */
  working: boolean
}

/** What a feature with no lead at work reads as. */
export const NO_LEAD: LeadState = { inBackground: false, working: false }

/**
 * What the feature's lead is doing (decision 15): {@link threadActivity} over its
 * main chat — the newest one with a log, as the thread list's newest main entry
 * — so the header and the sidebar read one answer. A conversation from the
 * terminal era has no log, and does nothing.
 */
export function leadState(ctx: AppCtx, featureId: string): LeadState {
  let newest: { at: number; state: LeadState } | null = null
  for (const row of featureSessions(ctx, featureId, ['chat'])) {
    if (!hasThreadLog(row.id)) continue
    const { events } = foldedLog(row.id)
    // A compaction at a quiet moment is not the lead moving.
    const at = outsideCompactions(events).at(-1)?.at ?? row.createdAt ?? 0
    if (newest && newest.at >= at) continue
    const running = agentHost(ctx).isRunning(row.id)
    const activity = threadActivity(events, running, Date.now())
    newest = {
      at,
      state: {
        inBackground: activity === 'background',
        // No process survives a restart: a log cut off mid-turn is not working.
        working: running && (activity === 'turn' || activity === 'background'),
      },
    }
  }
  return newest?.state ?? NO_LEAD
}

/**
 * Whether a turn of the thread actually runs now (runcastle-says-when-nothing-is-running):
 * its process is up and its log says a turn or its background work runs. A
 * thread with no process never runs, whatever its log was cut off at.
 */
export function threadBusy(ctx: AppCtx, threadId: string): boolean {
  if (!agentHost(ctx).isRunning(threadId)) return false
  if (!hasThreadLog(threadId)) return true
  const activity = threadActivity(foldedLog(threadId).events, true, Date.now())
  return activity === 'turn' || activity === 'background'
}

/**
 * Whether the feature's lead last answered the human's own message (its newest
 * main chat with a log, as {@link leadState} picks it): then the next move is
 * the human's (runcastle-says-when-nothing-is-running decision 4).
 */
export function leadAnsweredHuman(ctx: AppCtx, featureId: string): boolean {
  let newest: { at: number; answered: boolean } | null = null
  for (const row of featureSessions(ctx, featureId, ['chat'])) {
    if (!hasThreadLog(row.id)) continue
    const { events } = foldedLog(row.id)
    const at = outsideCompactions(events).at(-1)?.at ?? row.createdAt ?? 0
    if (newest && newest.at >= at) continue
    newest = { at, answered: lastTurnAnsweredHuman(events) }
  }
  return newest?.answered ?? false
}

/**
 * The open question ask in the thread, as a need: its first question is its
 * line (needs-you decision 2). Command approvals never reach the human
 * (agents-never-stop-for-approval decision 1). Read from the
 * thread's log, folded as the chat folds it; only a thread whose process runs
 * can hold one open, since no ask outlives its process. Forms and links an MCP
 * server asks are the agent's own errand, not a need.
 */
export function openAskNeed(ctx: AppCtx, threadId: string): Need | null {
  if (!agentHost(ctx).isRunning(threadId) || !hasThreadLog(threadId)) return null
  const { view, events } = foldedLog(threadId)
  const ask = view.ask
  if (ask?.kind !== 'question') return null
  const since = [...events].reverse().find((e) => e.type === 'ask' && e.ask.id === ask.id)?.at ?? 0
  const why = ask.questions[0]?.question ?? ''
  return { why, since, threadId, by: 'agent' }
}

/** What the thread needs from the human: the newest of its agent's wait and its open ask; null when nothing. */
export function threadNeed(ctx: AppCtx, row: Pick<SessionRow, 'id'>): Need | null {
  return newestNeed([waitOf(ctx, row.id), openAskNeed(ctx, row.id)])
}

/** A project chat's epic look, as its row stores it (epics-that-look-alive decisions 1–3); nothing for other kinds. */
export function epicLookOf(row: SessionRow): Pick<ThreadEntry, 'color' | 'icon' | 'iconByHuman' | 'autopilot'> {
  if (row.kind !== 'project') return {}
  return {
    ...(row.epicColor ? { color: row.epicColor } : {}),
    ...(row.epicIcon ? { icon: row.epicIcon } : {}),
    ...(row.epicIconByHuman ? { iconByHuman: true } : {}),
    // An epic always says whether it is on autopilot: the sidebar reads only this.
    autopilot: row.autopilot ?? false,
  }
}

/** A thread nothing has been said in yet. */
function freshEntry(ctx: AppCtx, row: SessionRow, about: ThreadAbout): ThreadEntry {
  return {
    id: row.id,
    title: threadName(row, [], about),
    role: ROLE[row.kind],
    state: 'idle',
    need: waitOf(ctx, row.id),
    createdAt: row.createdAt ?? 0,
    updatedAt: row.createdAt ?? 0,
    runtime: row.runtime ?? DEFAULT_RUNTIME,
    ...epicLookOf(row),
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
    need: waitOf(ctx, row.id),
    createdAt: row.createdAt ?? 0,
    updatedAt: row.endedAt ?? row.createdAt ?? 0,
    runtime: row.runtime ?? DEFAULT_RUNTIME,
    readOnlyTranscript: true,
    ...epicLookOf(row),
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
    else if (row.status !== 'ended') entries.push(freshEntry(ctx, row, about))
  }
  return entries.sort((a, b) => b.updatedAt - a.updatedAt)
}
