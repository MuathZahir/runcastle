import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Readable, Writable } from 'node:stream'
import * as acp from '@agentclientprotocol/sdk/unstable'
import {
  DEFAULT_RUNTIME,
  foldThread,
  liveEvents,
  modelRoster,
  newId,
  TurnEnd,
  type AgentRuntime,
  type Ask,
  type AskAnswer,
  type Attachment,
  type BackgroundTask,
  type FileChange,
  type SessionRow,
  type ThreadEvent,
  type ThreadEventBody,
  type ThreadModels,
  type UsageReport,
} from '@runcastle/core'
import { sessionDir } from '@runcastle/core/paths'
import type { AppCtx } from '../db/types'
import { GateError } from '../errors'
import type { AcpLaunchSpec } from '../launcher/runtimes/types'
import {
  createSessionRow,
  getSessionRow,
  markAgentWorking,
  markAwaitingInput,
  markSessionEnded,
  markSessionLive,
  setSessionTitle,
} from '../launcher/sessions'
import { killProcessTree } from '../pty/kill-tree'
import { emitForSession } from '../services/events'
import { rosterConfig } from '../services/model-discovery'
import { runcastleVersion } from '../version'
import {
  catalogFromOptions,
  configRequests,
  forkAtMeta,
  lastAgentMessageId,
  threadMarkdown,
  turnEndIndex,
  type ConfigChoice,
} from './controls'
import { readClaudeUsage, readCodexRateLimits, rewindClaudeFiles } from './side-channels'
import { claudeUsageReport, codexUsageReport } from './usage'
import {
  backgroundTasks,
  CLAUDE_SDK_MESSAGE_METHOD,
  createUpdateMapper,
  elicitationAnswer,
  elicitationQuestions,
  fileChanges,
  modelEvent,
  rfdSubagentMessage,
  toolCallOf,
  toolDiffs,
  wentIdle,
  type ToolDiff,
} from './acp-map'
import { elicitationAsk, formContent, formLines, unsupportedLine } from './elicitation'
import { forgetWorktreeFiles } from './files'
import { saveThreadImage } from './images'
import { acpLaunchFor } from './launch'
import { threadLifecycle } from './lifecycle'
import { appendThreadEvent, readThreadEvents, seedThreadLog } from './log'
import { catalogEntry, readModelCatalog, threadModels, writeModelCatalog } from './model-catalog'
import { runtimeMayName } from './naming'
import { seedFromTranscript } from './read'
import type { AgentHost, PromptInput, PromptOptions, StopReason } from './types'
import { snapshotWorktree, worktreeChanges, worktreeRelative, type WorktreeSnapshot } from './worktree-changes'

/**
 * The agent host (chat-as-web-components; ADR-0015): owns every running agent
 * connection, one ACP adapter process per running thread, and turns all of it
 * into the thread's log. The process is the host's concern only — a thread is
 * its log, a process starts on the first prompt and stops when idle, and the
 * human never sees either happen except as "starting…".
 *
 * The log is written in the order core's `foldThread` reads it: the prompt,
 * the process starting and running, the turn starting, what the agent did and
 * asked, and the turn's end.
 */

/** A running agent process, as the host drives it. */
export interface AgentProcess {
  /** What the host's ACP client connects to: the adapter's stdio, or (in tests) an in-process agent. */
  target: acp.Stream | acp.AgentApp
  /** Resolves when the process exits, for whatever reason, with the tail of its stderr. */
  exited: Promise<{ stderr: string }>
  /** End the process and everything it started. */
  kill(): Promise<void>
}

/** Starts the agent process a launch describes. */
export type AgentTransport = (spec: AcpLaunchSpec, row: SessionRow) => AgentProcess | Promise<AgentProcess>

export interface AgentHostDeps {
  ctx: AppCtx
  /** How a process starts; the adapter as a child process by default. */
  transport?: AgentTransport
  /** How a thread's launch is described; its runtime's `acpLaunch` by default. */
  launch?: (ctx: AppCtx, row: SessionRow) => Promise<AcpLaunchSpec>
  /** How long a process with no turn and no open ask lives on. */
  idleMs?: number
  /** What the rest of the server does as a thread's process starts, works and stops. */
  lifecycle?: ThreadLifecycle
  /** Where a runtime's account usage limits are read; see `side-channels.ts`. */
  readUsage?: (runtime: AgentRuntime) => Promise<unknown>
  /** How Claude Code's file checkpoints are rewound; see `side-channels.ts`. */
  rewindFiles?: (input: { sessionId: string; cwd: string; text: string; occurrence: number }) => Promise<void>
  /** How long a turn the agent started by itself may go quiet before it counts as over, on a runtime that does not say. */
  selfTurnQuietMs?: number
}

/**
 * The server's own reactions to a thread's process, beside the log: the
 * launcher's briefing, the timeline's events and what a session's end has
 * always done (see `threads/lifecycle.ts`). Every hook is best effort.
 */
export interface ThreadLifecycle {
  /** Text sent after the first prompt of a newly started process (a resumed main chat's fresh state header). */
  opening?(row: SessionRow): string | undefined
  /** The briefing a new conversation of the row's kind opens with, for a thread whose conversation had to start over. */
  briefing?(row: SessionRow): string | undefined
  /** The process runs; `source` is who sent the prompt that started it. */
  started?(row: SessionRow, source: PromptOptions['source']): void
  /** A turn ended; `source` is who sent the prompt it answered. */
  turnEnded?(row: SessionRow, source: PromptOptions['source']): void
  /** The process stopped, with who started it. */
  stopped?(row: SessionRow, reason: StopReason, startedBy: PromptOptions['source']): void
}

/** codex-acp's hook-trust extension: the session's hooks, and trusting them. */
const CODEX_HOOKS_LIST = '_codex/hooks/list'
const CODEX_HOOKS_TRUST = '_codex/hooks/trust'

interface CodexHook {
  key: string
  currentHash: string
  trustStatus?: string
}

const readUsageOf = (runtime: AgentRuntime): Promise<unknown> => (runtime === 'codex' ? readCodexRateLimits() : readClaudeUsage())

/** The account each adapter pushes (`_auth/status_update`), which names the plan. */
const AUTH_STATUS_METHOD = '_auth/status_update'

/**
 * What a thread's next start, or its next prompt, does differently after an
 * edit, a branch or a held prompt. Kept on disk beside the log, since a branch
 * may wait for its first message across restarts.
 * - `open`: instead of loading the row's conversation, fork `from` at the agent
 *   message `messageId`, or (`fresh`) start a new conversation.
 * - `preface`: said to the agent ahead of the next prompt's words, when the
 *   conversation could not be forked where the thread now stands, or when a
 *   prompt was held for the next one (`PromptOptions.hold`).
 */
interface PendingFork {
  open?: { from: string; messageId: string } | 'fresh'
  preface?: string
}

const pendingForkPath = (threadId: string): string => join(sessionDir(threadId), 'fork.json')

function readPendingFork(threadId: string): PendingFork {
  try {
    return JSON.parse(readFileSync(pendingForkPath(threadId), 'utf8')) as PendingFork
  } catch {
    return {}
  }
}

function writePendingFork(threadId: string, fork: PendingFork): void {
  const path = pendingForkPath(threadId)
  if (!fork.open && fork.preface === undefined) {
    if (existsSync(path)) rmSync(path)
    return
  }
  mkdirSync(sessionDir(threadId), { recursive: true })
  writeFileSync(path, JSON.stringify(fork))
}

/** Decision 7: an idle agent process is stopped quietly after half an hour. */
export const IDLE_STOP_MS = 30 * 60_000

/**
 * How long a turn the agent started by itself (Claude Code answering a finished
 * background command) may go quiet before it is over, on a runtime with no
 * signal for its end. Claude's own signal is its session going idle.
 */
export const SELF_TURN_QUIET_MS = 30_000

/** What the thread says when the conversation on record is gone and a new one starts in its place. */
const LOST_CONVERSATION = 'Started a new conversation — the earlier one could not be found'

/** What the lead hears ahead of its next prompt after the human stopped its self-planning run. */
const PLANNING_STOPPED =
  '[runcastle] The human stopped your self-planning run before it finished: planning was stopped by the human, so the plan may be incomplete.'

/** What the thread says after the human stopped its self-planning run, and how it goes on. */
const PLANNING_STOPPED_NOTICE = 'Planning stopped. Send a message to pick it up with the lead.'

/** How much of a crashed adapter's stderr the thread keeps as its error. */
const STDERR_TAIL = 2000

/** Updates a `session/load` replays from history, which the log already holds. */
const REPLAYED = new Set(['user_message_chunk', 'agent_message_chunk', 'agent_thought_chunk', 'tool_call', 'tool_call_update', 'plan', 'subagent_update'])

/** Updates that are the agent doing a turn's work: with no turn running, the agent started one itself. */
const TURN_OUTPUT = new Set(['agent_message_chunk', 'agent_thought_chunk', 'tool_call', 'tool_call_update', 'plan', 'subagent_update'])

/** The adapter's messages as the ACP client reads them: subagents in the RFD's form ({@link rfdSubagentMessage}). */
function inRfdForm(stream: acp.Stream): acp.Stream {
  return { writable: stream.writable, readable: stream.readable.pipeThrough(new TransformStream({ transform: (m, out) => out.enqueue(rfdSubagentMessage(m)) })) }
}

/** The adapter's steering extension (`InitializeResponse._meta.steering`). */
const STEER_METHOD = '_session/steering'

/**
 * The compaction command. Both adapters take it as a prompt: claude-agent-acp
 * hands it to Claude Code as its slash command, codex-acp runs it as its own
 * `compact` command (`thread/compact/start`).
 */
const COMPACT_COMMAND = '/compact'

/** What a self-planning run's asks are answered with: nobody is there to answer them. */
const UNATTENDED_LINE = { what: 'Declined', answer: 'nobody is watching this run', denied: true }

/** Each ask's kind, said in a refused answer's error. */
const ASK_NOUN: Record<Ask['kind'], string> = { approval: 'an approval', question: 'a question', form: 'a form', link: 'a link' }

/** The adapter as a child process speaking ACP on its stdio. */
export const spawnAdapter: AgentTransport = (spec, row) => {
  const env: Record<string, string | undefined> = { ...process.env, ...spec.env }
  for (const name of spec.envScrub) delete env[name]
  const child = spawn(spec.command, spec.args, { cwd: row.worktreePath, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
  let stderr = ''
  child.stderr.on('data', (chunk: Buffer) => {
    stderr = (stderr + chunk.toString('utf8')).slice(-STDERR_TAIL)
  })
  const exited = new Promise<{ stderr: string }>((resolve) => {
    child.once('exit', () => resolve({ stderr }))
    child.once('error', (err) => resolve({ stderr: `${stderr}${err.message}` }))
  })
  return {
    target: acp.ndJsonStream(Writable.toWeb(child.stdin) as WritableStream<Uint8Array>, Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>),
    exited,
    kill: async () => {
      if (child.pid !== undefined && child.exitCode === null) await killProcessTree(child.pid)
    },
  }
}

/** A prompt waiting for the running turn to end. */
interface Queued {
  id: string
  text: string
  images?: Attachment[]
  blocks: acp.ContentBlock[]
  source: PromptOptions['source']
  /** A command (Compact now): logged so the fold knows a turn is coming, never shown as a message. */
  hidden?: boolean
  /** Already in the log (a human's words show at once); runcastle's are logged when sent. */
  logged: boolean
}

/** The running turn. */
interface Turn {
  /** The file changes its tool calls reported, by call. */
  diffs: Map<string, ToolDiff[]>
  /** The worktree as the turn started, to find what else (a shell command) changed in it. */
  snapshot: Promise<WorktreeSnapshot | null>
  /** Started by the agent with no prompt (see `Host.selfTurn`). */
  self?: boolean
  /** A self-started turn on a runtime with no end signal ends when this fires. */
  quiet?: ReturnType<typeof setTimeout>
}

interface Thread {
  id: string
  state: 'starting' | 'running' | 'stopped'
  proc?: AgentProcess
  conn?: acp.ClientConnection
  sessionId?: string
  steering: boolean
  /** Replaying history in `session/load`: those updates are not logged again. */
  loading: boolean
  turn: Turn | null
  queue: Queued[]
  ask?: {
    ask: Ask
    settle: (answer: AskAnswer | 'cancelled') => void
    /** A link ask's elicitation, which the agent may report finished on its own (`elicitation/complete`). */
    elicitationId?: string
  }
  idle?: ReturnType<typeof setTimeout>
  map: (update: acp.SessionUpdate, from?: string) => ThreadEventBody[]
  /** The background commands the agent runs now, as last logged. */
  tasks: BackgroundTask[]
  /** Who sent the prompt that started this process. */
  startedBy: PromptOptions['source']
  /** The lifecycle's opening, sent with the first prompt and then forgotten. */
  opening?: string
  /** The session's config options (model, effort, fast mode), as it last reported them. */
  configOptions?: acp.SessionConfigOption[]
}

/** Read through a function so a check after an `await` is not narrowed away. */
function isStopped(t: Thread): boolean {
  return t.state === 'stopped'
}

/** What went wrong, in the agent's words: an ACP internal error carries them in `data.details`. */
function errorText(err: unknown): string {
  const details = err instanceof acp.RequestError ? (err.data as { details?: unknown } | undefined)?.details : undefined
  if (typeof details === 'string' && details) return details
  return err instanceof Error ? err.message : String(err)
}

/**
 * A `session/load` refused because the conversation is not on disk any more:
 * ACP's resource-not-found (claude-agent-acp's "Resource not found: <id>"), or
 * an adapter that says so in words.
 */
function conversationGone(err: unknown): boolean {
  if (err instanceof acp.RequestError && err.code === -32002) return true
  return /not found|no (such )?(conversation|session|thread|rollout)/i.test(errorText(err))
}

/** The tail of a crashed process's stderr, said as the thread's error. */
function crashText(stderr: string): string {
  const lines = stderr.trim().split(/\r?\n/).slice(-8).join('\n').trim()
  return lines || 'The agent process exited unexpectedly.'
}

class Host implements AgentHost {
  private readonly threads = new Map<string, Thread>()
  private readonly ctx: AppCtx
  private readonly transport: AgentTransport
  private readonly launch: (ctx: AppCtx, row: SessionRow) => Promise<AcpLaunchSpec>
  private readonly idleMs: number
  private readonly lifecycle: ThreadLifecycle
  private readonly readUsage: (runtime: AgentRuntime) => Promise<unknown>
  private readonly rewindFiles: NonNullable<AgentHostDeps['rewindFiles']>
  private readonly selfTurnQuietMs: number
  /** A model, effort or fast mode chosen while no session could take it, applied when one opens. */
  private readonly pendingConfig = new Map<string, ConfigChoice>()
  /** Each runtime's last usage report, and the account its adapter last pushed. */
  private readonly usageReports = new Map<AgentRuntime, UsageReport>()
  private readonly authStatus = new Map<AgentRuntime, unknown>()

  constructor(deps: AgentHostDeps) {
    this.ctx = deps.ctx
    this.transport = deps.transport ?? spawnAdapter
    this.launch = deps.launch ?? acpLaunchFor
    this.idleMs = deps.idleMs ?? IDLE_STOP_MS
    this.lifecycle = deps.lifecycle ?? {}
    this.readUsage = deps.readUsage ?? readUsageOf
    this.rewindFiles = deps.rewindFiles ?? rewindClaudeFiles
    this.selfTurnQuietMs = deps.selfTurnQuietMs ?? SELF_TURN_QUIET_MS
  }

  async prompt(threadId: string, input: PromptInput, opts: PromptOptions): Promise<{ promptId: string }> {
    const row = this.row(threadId)
    seedFromTranscript(this.ctx, threadId)
    if (opts.hold) return this.hold(threadId, input.text, opts.source)
    const change = this.configChange(threadId, opts)
    if (change) await this.setConfig(threadId, change)
    const images = (input.images ?? []).map((image) => saveThreadImage(threadId, image))
    const pending = readPendingFork(threadId)
    if (pending.preface !== undefined) writePendingFork(threadId, { ...pending, preface: undefined })
    const item: Queued = {
      id: newId('prompt'),
      text: input.text,
      ...(images.length ? { images } : {}),
      blocks: [
        { type: 'text', text: pending.preface !== undefined ? `${pending.preface}\n\n${input.text}` : input.text },
        ...(input.images ?? []).map((image): acp.ContentBlock => ({ type: 'image', data: image.data, mimeType: image.mimeType })),
      ],
      source: opts.source,
      logged: false,
    }
    const t = this.threads.get(threadId)
    if (t?.turn && opts.source === 'runcastle') {
      t.queue.push(item)
      return { promptId: item.id }
    }
    if (t?.turn && t.steering) {
      this.logPrompt(t.id, item, true)
      void this.steer(t, item)
      return { promptId: item.id }
    }
    this.logPrompt(threadId, item)
    this.enqueue(t ?? this.start(row, opts.source), item)
    return { promptId: item.id }
  }

  async cancel(threadId: string): Promise<void> {
    const t = this.threads.get(threadId)
    if (!t?.turn || !t.conn || !t.sessionId) return
    // ACP: a cancelled turn's open permission request is answered `cancelled`.
    this.settleAsk(t, 'cancelled')
    await t.conn.agent.notify(acp.methods.agent.session.cancel, { sessionId: t.sessionId })
    // No prompt of runcastle's answers for a turn the agent started: it ends here.
    if (t.turn?.self) await this.endSelfTurn(t, t.turn, 'cancelled')
  }

  async answer(threadId: string, askId: string, answer: AskAnswer): Promise<void> {
    const t = this.threads.get(threadId)
    const open = t?.ask
    if (!t || !open || open.ask.id !== askId) throw new GateError(`ask ${askId} is not open on this thread`)
    const declinable = open.ask.kind === 'form' || open.ask.kind === 'link'
    if (open.ask.kind !== answer.kind && !(answer.kind === 'decline' && declinable)) throw new GateError(`ask ${askId} is ${ASK_NOUN[open.ask.kind]}`)
    let lines: Extract<ThreadEventBody, { type: 'ask_resolved' }>['lines']
    if (open.ask.kind === 'approval' && answer.kind === 'approval') {
      const what = { allow: 'Allowed', always: 'Always allowed', deny: 'Denied' }[answer.choice]
      lines = [{ what, answer: open.ask.call.title, ...(answer.choice === 'deny' ? { denied: true } : {}) }]
    } else if ((open.ask.kind === 'form' || open.ask.kind === 'link') && answer.kind === 'decline') {
      lines = [{ what: 'Declined', answer: open.ask.message, denied: true }]
    } else if (open.ask.kind === 'form' && answer.kind === 'form') {
      lines = formLines(open.ask, answer.values)
    } else if (open.ask.kind === 'link') {
      lines = [{ what: 'Done', answer: open.ask.message }]
    } else {
      const answers = answer.kind === 'question' ? answer.answers : {}
      lines = open.ask.kind === 'question' ? open.ask.questions.map((q) => ({ what: `${q.header}:`, answer: answers[q.question] ?? '' })) : []
    }
    appendThreadEvent(t.id, { type: 'ask_resolved', id: askId, lines })
    markAgentWorking(this.ctx, t.id)
    this.settleAsk(t, answer)
    if (answer.kind === 'approval' && answer.choice === 'deny' && answer.instead?.trim()) {
      const item: Queued = { id: newId('prompt'), text: answer.instead, blocks: [{ type: 'text', text: answer.instead }], source: 'human', logged: false }
      this.logPrompt(t.id, item)
      this.enqueue(t, item)
    }
  }

  async compact(threadId: string): Promise<void> {
    const row = this.row(threadId)
    const t = this.threads.get(threadId)
    if (t?.turn || t?.ask || t?.queue.length) throw new GateError('the agent is working: compact once its turn ends')
    seedFromTranscript(this.ctx, threadId)
    const item: Queued = {
      id: newId('prompt'),
      text: COMPACT_COMMAND,
      blocks: [{ type: 'text', text: COMPACT_COMMAND }],
      source: 'runcastle',
      hidden: true,
      logged: false,
    }
    this.logPrompt(threadId, item)
    this.enqueue(t ?? this.start(row, 'runcastle'), item)
  }

  async stop(threadId: string, reason: StopReason): Promise<void> {
    const t = this.threads.get(threadId)
    if (!t) return
    const turn = t.turn
    // Read before the stop's lifecycle makes the thread the lead's ordinary chat again.
    const planning = turn !== null && this.unattended(t)
    this.detach(t)
    await t.proc?.kill().catch(() => {})
    if (turn) {
      // The turn is over, and says so: "Stopped by you", with what it changed by then.
      if (turn.quiet) clearTimeout(turn.quiet)
      const files = await this.turnFiles(t, turn)
      appendThreadEvent(t.id, { type: 'turn_ended', reason: 'cancelled', ...(files.length ? { files } : {}) })
    }
    if (planning && reason === 'archived') {
      appendThreadEvent(t.id, { type: 'notice', text: PLANNING_STOPPED_NOTICE })
      const pending = readPendingFork(t.id)
      writePendingFork(t.id, { ...pending, preface: pending.preface !== undefined ? `${PLANNING_STOPPED}\n\n${pending.preface}` : PLANNING_STOPPED })
    }
    appendThreadEvent(t.id, { type: 'process', state: 'stopped' })
    this.ended(t, reason)
  }

  async stopAll(reason: StopReason): Promise<void> {
    await Promise.all([...this.threads.keys()].map((id) => this.stop(id, reason)))
  }

  isRunning(threadId: string): boolean {
    return this.threads.has(threadId)
  }

  // ---- controls ----

  /**
   * On a session that is open, the change goes to the agent now and the model
   * it then reports is logged. Otherwise the choice goes to the agent when its
   * session next opens; a thread that has run before logs it as made, while
   * one that never has just starts on it, with no divider before its first
   * message.
   */
  async setConfig(threadId: string, choice: ConfigChoice): Promise<void> {
    const row = this.row(threadId)
    const t = this.threads.get(threadId)
    if (t?.conn && t.sessionId && t.configOptions) {
      await this.applyConfig(t, choice)
      const model = modelEvent(t.configOptions)
      if (model) appendThreadEvent(threadId, model)
      return
    }
    this.pendingConfig.set(threadId, { ...this.pendingConfig.get(threadId), ...choice })
    const now = foldThread(readThreadEvents(threadId)).model
    if (!now) return
    const entry = choice.model === undefined ? undefined : catalogEntry(row.runtime ?? DEFAULT_RUNTIME, modelRoster(rosterConfig(this.ctx)), choice.model)
    const model = entry?.id ?? choice.model ?? now.id
    const label = model === now.id ? now.label : (entry?.label ?? model)
    const effort = choice.effort ?? now.effort
    const fast = choice.fast ?? now.fast
    appendThreadEvent(threadId, { type: 'model', model, label, ...(effort ? { effort } : {}), ...(fast !== undefined ? { fast } : {}) })
  }

  async fork(threadId: string, atPromptId: string, opts: { into: 'same' | 'new'; undoFiles?: boolean }): Promise<{ threadId: string }> {
    const row = this.row(threadId)
    const events = liveEvents(readThreadEvents(threadId))
    const at = events.findIndex((e) => e.type === 'prompt' && e.id === atPromptId)
    const prompt = events[at]
    if (prompt?.type !== 'prompt') throw new GateError(`no message ${atPromptId} on this thread`)
    if (opts.into === 'new') return this.branch(row, events, at)

    const t = this.threads.get(threadId)
    if (t?.turn || t?.ask) throw new GateError('the agent is working: stop it before editing a message')
    if (opts.undoFiles && (row.runtime ?? DEFAULT_RUNTIME) === 'claude-code' && row.ccSessionId) {
      const said = prompt.text.trim()
      const occurrence = events.slice(0, at + 1).filter((e) => e.type === 'prompt' && e.text.includes(said)).length
      await this.rewindFiles({ sessionId: row.ccSessionId, cwd: row.worktreePath, text: prompt.text, occurrence })
    }
    const point = lastAgentMessageId(events.slice(0, at))
    if (point === 'unknown' && row.ccSessionId) {
      // Nothing to fork at: the conversation carries on, told the message was replaced.
      writePendingFork(threadId, {
        ...readPendingFork(threadId),
        preface: `[runcastle] The human edited an earlier message of theirs and sent the message below in its place. Disregard that earlier message ("${prompt.text}") and everything you did in answer to it.`,
      })
    } else {
      // The next start opens the forked conversation; a running process would keep the old one.
      if (t) await this.stop(threadId, 'idle')
      writePendingFork(threadId, { open: point && point !== 'unknown' && row.ccSessionId ? { from: row.ccSessionId, messageId: point } : 'fresh' })
    }
    appendThreadEvent(threadId, { type: 'rewound', toPromptId: atPromptId })
    return { threadId }
  }

  /**
   * A new thread beside `row` carrying its conversation through the turn of the
   * prompt at `at`: the log's prefix copied, the agent's conversation forked
   * there when its next start opens it. Nothing is sent.
   */
  private branch(row: SessionRow, events: ThreadEvent[], at: number): { threadId: string } {
    const prefix = events.slice(0, turnEndIndex(events, at)).filter((e) => e.type !== 'process')
    const model = row.model ? { model: { id: row.model, runtime: row.runtime ?? DEFAULT_RUNTIME } } : {}
    const created = row.featureId
      ? createSessionRow(this.ctx, {
          featureId: row.featureId,
          kind: 'side',
          worktreePath: row.worktreePath,
          ...model,
          ...(row.kind === 'chat' ? { openedBeside: row.id } : row.openedBeside ? { openedBeside: row.openedBeside } : {}),
        })
      : createSessionRow(this.ctx, { projectId: row.projectId!, kind: 'project', worktreePath: row.worktreePath, ...model })
    seedThreadLog(created.id, prefix)
    const point = lastAgentMessageId(prefix)
    if (point && point !== 'unknown' && row.ccSessionId) writePendingFork(created.id, { open: { from: row.ccSessionId, messageId: point } })
    else if (point) {
      writePendingFork(created.id, {
        open: 'fresh',
        preface: `[runcastle] This thread branched off an earlier conversation, which is below up to where it branched. Carry on from there.\n\n${threadMarkdown(foldThread(prefix), 'The conversation so far')}`,
      })
    }
    emitForSession(this.ctx, created, {
      type: 'session.branched',
      message: 'branched a thread off an earlier message',
      data: { sessionId: created.id, from: row.id },
    })
    return { threadId: created.id }
  }

  /** Only a thread whose agent runs asks the account: reading usage is never a reason to start one. */
  async usage(threadId: string): Promise<UsageReport> {
    const runtime = this.row(threadId).runtime ?? DEFAULT_RUNTIME
    const last = (): UsageReport => this.usageReports.get(runtime) ?? { limits: [] }
    if (!this.threads.get(threadId)?.conn) return last()
    try {
      const read = await this.readUsage(runtime)
      const raw = { ...(typeof read === 'object' && read !== null ? read : {}), authStatus: this.authStatus.get(runtime) }
      const report = runtime === 'codex' ? codexUsageReport(raw) : claudeUsageReport(raw)
      this.usageReports.set(runtime, report)
      return report
    } catch {
      return last()
    }
  }

  /** The runtime's one catalog (kept from its sessions, else the roster), and the model the thread is on or would start on. */
  models(threadId: string): ThreadModels {
    const row = this.row(threadId)
    const chosen = this.pendingConfig.get(threadId)?.model
    const logged = foldThread(readThreadEvents(threadId)).model?.id
    return threadModels(row.runtime ?? DEFAULT_RUNTIME, modelRoster(rosterConfig(this.ctx)), chosen ?? logged ?? row.model)
  }

  /** What of the message's model, effort and fast mode differs from what the thread runs on; null when nothing does. */
  private configChange(threadId: string, opts: PromptOptions): ConfigChoice | null {
    if (opts.model === undefined && opts.effort === undefined && opts.fast === undefined) return null
    const now = foldThread(readThreadEvents(threadId)).model
    const change: ConfigChoice = {
      ...(opts.model !== undefined && opts.model !== now?.id ? { model: opts.model } : {}),
      ...(opts.effort !== undefined && opts.effort !== now?.effort ? { effort: opts.effort } : {}),
      ...(opts.fast !== undefined && opts.fast !== now?.fast ? { fast: opts.fast } : {}),
    }
    return Object.keys(change).length ? change : null
  }

  /**
   * What a session opening for the thread must run on, whoever sent the prompt
   * that starts it: the model (and effort, fast mode) its log last records — the
   * human's pick, kept across idle stops and restarts — else the model runcastle
   * resolved for its row. The adapter opens on its own choice (the CLI's
   * settings, a resumed conversation's last model) whatever the launch names.
   */
  private intendedConfig(threadId: string, row: SessionRow): ConfigChoice {
    const logged = foldThread(readThreadEvents(threadId)).model
    if (!logged) return row.model ? { model: row.model } : {}
    return { model: logged.id, ...(logged.effort ? { effort: logged.effort } : {}), ...(logged.fast !== undefined ? { fast: logged.fast } : {}) }
  }

  /** Set each option in turn: the model first, since the effort levels and fast mode offered are the model's. */
  private async applyConfig(t: Thread, choice: ConfigChoice): Promise<void> {
    for (const key of ['model', 'effort', 'fast'] as const) {
      if (choice[key] === undefined || !t.conn || !t.sessionId) continue
      for (const req of configRequests(t.sessionId, t.configOptions, { [key]: choice[key] })) {
        const res = await t.conn.agent.request(acp.methods.agent.session.setConfigOption, req)
        this.noteOptions(t, res.configOptions)
      }
    }
  }

  /** A session's options are its config, and what its runtime's catalog learns from; `opened`, as the session opened them. */
  private noteOptions(t: Thread, options: acp.SessionConfigOption[] | null | undefined, opened = false): void {
    if (!options) return
    t.configOptions = options
    const runtime = getSessionRow(this.ctx, t.id)?.runtime ?? DEFAULT_RUNTIME
    const catalog = catalogFromOptions(readModelCatalog(runtime), options, opened)
    if (catalog) writeModelCatalog(runtime, catalog)
  }

  // ---- the process ----

  private row(threadId: string): SessionRow {
    const row = getSessionRow(this.ctx, threadId)
    if (!row) throw new GateError(`no thread ${threadId}`)
    return row
  }

  /** Begin starting the thread's agent; prompts queue until it runs. */
  private start(row: SessionRow, startedBy: PromptOptions['source']): Thread {
    let n = 0
    const opening = this.hook(() => this.lifecycle.opening?.(row))
    const t: Thread = {
      id: row.id,
      state: 'starting',
      steering: false,
      loading: false,
      turn: null,
      queue: [],
      map: createUpdateMapper((prefix) => `${prefix}_${row.id}_${Date.now().toString(36)}_${++n}`),
      tasks: [],
      startedBy,
      ...(opening ? { opening } : {}),
    }
    this.threads.set(t.id, t)
    appendThreadEvent(t.id, { type: 'process', state: 'starting' })
    this.connect(t, row).then(
      () => this.pump(t),
      (err) => void this.failStart(t, err),
    )
    return t
  }

  private async connect(t: Thread, row: SessionRow): Promise<void> {
    // Read before the session opens: the adapter announces its own model as it
    // opens (claude-agent-acp), and that logged announcement is not a pick.
    const intended = this.intendedConfig(t.id, row)
    const spec = await this.launch(this.ctx, row)
    const proc = await this.transport(spec, row)
    t.proc = proc
    void proc.exited.then(({ stderr }) => this.crashed(t, stderr))
    // Stopped while it spawned: the stop found no process to kill, so this one goes now.
    if (t.state === 'stopped') return void (await proc.kill().catch(() => {}))
    const app = acp
      .client({ name: 'runcastle' })
      .onNotification(acp.methods.client.session.update, ({ params }) => this.onUpdate(t, params.sessionId, params.update))
      .onNotification(CLAUDE_SDK_MESSAGE_METHOD, (raw: unknown) => raw as { message?: unknown }, ({ params }) => this.onSdkMessage(t, params.message))
      .onRequest(acp.methods.client.session.requestPermission, ({ params }) => this.onPermission(t, params))
      .onRequest(acp.methods.client.elicitation.create, ({ params }) => this.onElicitation(t, params))
      .onNotification(acp.methods.client.elicitation.complete, ({ params }) => this.onElicitationComplete(t, params.elicitationId))
      .onNotification(AUTH_STATUS_METHOD, (raw: unknown) => raw as { authStatus?: unknown }, ({ params }) => {
        if (params.authStatus !== undefined) this.authStatus.set(row.runtime ?? DEFAULT_RUNTIME, params.authStatus)
      })
    const conn = proc.target instanceof acp.AgentApp ? app.connect(proc.target) : app.connect(inRfdForm(proc.target))
    t.conn = conn
    const init = await conn.agent.request(acp.methods.agent.initialize, {
      protocolVersion: acp.PROTOCOL_VERSION,
      // The agent uses its own tools on its own disk; runcastle is not an editor.
      // `session.compaction` asks both adapters for `compaction_update`, the thread's "Conversation compacted".
      // Subagents run as child sessions the thread nests under their rows.
      clientCapabilities: {
        fs: { readTextFile: false, writeTextFile: false },
        terminal: false,
        elicitation: { form: {}, url: {} },
        session: { compaction: {} },
        subagents: {},
      },
      clientInfo: { name: 'runcastle', version: runcastleVersion() },
    })
    t.steering = (init._meta?.steering as { supported?: unknown } | undefined)?.supported === true
    const session: acp.NewSessionRequest = { cwd: row.worktreePath, mcpServers: [], _meta: spec.sessionMeta }
    let opened: acp.NewSessionResponse | acp.LoadSessionResponse | acp.ForkSessionResponse
    const fork = readPendingFork(t.id).open
    if (fork && fork !== 'fresh') {
      const forked = await conn.agent.request(acp.methods.agent.session.fork, {
        ...session,
        sessionId: fork.from,
        _meta: { ...spec.sessionMeta, ...forkAtMeta(fork.messageId) },
      })
      t.sessionId = forked.sessionId
      opened = forked
    } else if (row.ccSessionId && !fork) {
      // Known before the replay, so a replayed subagent's updates read as not the thread's own.
      t.sessionId = row.ccSessionId
      t.loading = true
      let loaded: acp.LoadSessionResponse | null = null
      try {
        loaded = await conn.agent.request(acp.methods.agent.session.load, { ...session, sessionId: row.ccSessionId })
      } catch (err) {
        if (!conversationGone(err)) throw err
      } finally {
        t.loading = false
      }
      opened = loaded ?? (await this.startOver(t, conn, session, row))
    } else {
      const created = await conn.agent.request(acp.methods.agent.session.new, session)
      t.sessionId = created.sessionId
      opened = created
    }
    const mode = spec.sessionMode
    if (mode && opened.modes && opened.modes.currentModeId !== mode && opened.modes.availableModes.some((m) => m.id === mode)) {
      await conn.agent.request(acp.methods.agent.session.setMode, { sessionId: t.sessionId, modeId: mode })
    }
    if (spec.trustHooks) await this.trustHooks(conn, row.worktreePath)
    this.noteOptions(t, opened.configOptions, true)
    const chosen = { ...intended, ...this.pendingConfig.get(t.id) }
    this.pendingConfig.delete(t.id)
    await this.applyConfig(t, chosen)
    // Stopped while it started (an archive, a shutdown): the stop already logged it.
    if (isStopped(t)) return
    const live = markSessionLive(this.ctx, t.id, { ccSessionId: t.sessionId })
    if (fork) writePendingFork(t.id, { ...readPendingFork(t.id), open: undefined })
    t.state = 'running'
    appendThreadEvent(t.id, { type: 'process', state: 'running' })
    const model = modelEvent(t.configOptions)
    if (model) appendThreadEvent(t.id, model)
    this.hook(() => this.lifecycle.started?.(live ?? row, t.startedBy))
  }

  /**
   * The conversation on record is gone (its transcript deleted, its CLI
   * reinstalled): start a new one in its place, briefed as a new conversation
   * of the thread's kind is — the briefing rides with the prompt that started
   * the process, as one prompt (decision 12) — and say so in the thread.
   */
  private async startOver(t: Thread, conn: acp.ClientConnection, session: acp.NewSessionRequest, row: SessionRow): Promise<acp.NewSessionResponse> {
    const created = await conn.agent.request(acp.methods.agent.session.new, session)
    t.sessionId = created.sessionId
    const briefing = this.hook(() => this.lifecycle.briefing?.(row))
    if (briefing) t.opening = briefing
    else delete t.opening
    appendThreadEvent(t.id, { type: 'notice', text: LOST_CONVERSATION })
    return created
  }

  /**
   * Trust the session's own hooks (codex-acp): Codex runs a hook only once its
   * hash is trusted, and the adapter has no flag that skips the check, so
   * runcastle's generated guards and status line would otherwise never fire.
   * A CLI that cannot list its hooks still runs the conversation; it is logged.
   */
  private async trustHooks(conn: acp.ClientConnection, cwd: string): Promise<void> {
    try {
      const listed = await conn.agent.request<{ hooks?: CodexHook[] }>(CODEX_HOOKS_LIST, { cwd })
      const hooks = (listed?.hooks ?? []).filter((h) => h.trustStatus !== 'trusted').map(({ key, currentHash }) => ({ key, currentHash }))
      if (hooks.length) await conn.agent.request(CODEX_HOOKS_TRUST, { cwd, hooks })
    } catch (err) {
      console.error(`could not trust the Codex hooks in ${cwd}`, err)
    }
  }

  private async failStart(t: Thread, err: unknown): Promise<void> {
    if (t.state === 'stopped') return
    this.detach(t)
    await t.proc?.kill().catch(() => {})
    appendThreadEvent(t.id, { type: 'process', state: 'stopped', error: `The agent could not start: ${errorText(err)}` })
    this.ended(t, 'crashed')
  }

  private crashed(t: Thread, stderr: string): void {
    if (t.state === 'stopped') return
    this.detach(t)
    appendThreadEvent(t.id, { type: 'process', state: 'stopped', error: crashText(stderr) })
    this.ended(t, 'crashed')
  }

  /** The row's process is over: mark it so, and let the lifecycle react. */
  private ended(t: Thread, reason: StopReason): void {
    const row = markSessionEnded(this.ctx, t.id)
    if (row) this.hook(() => this.lifecycle.stopped?.(row, reason, t.startedBy))
  }

  /** Run a lifecycle hook; one that throws is logged, never the thread's failure. */
  private hook<T>(fn: () => T): T | undefined {
    try {
      return fn()
    } catch (err) {
      console.error('thread lifecycle hook failed', err)
      return undefined
    }
  }

  /** Forget the thread's process: no more events from it, no asks left waiting. */
  private detach(t: Thread): void {
    t.state = 'stopped'
    if (this.threads.get(t.id) === t) this.threads.delete(t.id)
    if (t.idle) clearTimeout(t.idle)
    this.settleAsk(t, 'cancelled')
    t.conn?.close()
  }

  // ---- turns ----

  private logPrompt(threadId: string, item: Queued, steered = false): void {
    appendThreadEvent(threadId, {
      type: 'prompt',
      id: item.id,
      text: item.text,
      ...(item.images ? { images: item.images } : {}),
      source: item.source,
      ...(steered ? { steered: true } : {}),
      ...(item.hidden ? { hidden: true } : {}),
    })
    item.logged = true
  }

  /** Log a held prompt and keep its text, on disk, as the preface of the thread's next prompt. */
  private hold(threadId: string, text: string, source: PromptOptions['source']): { promptId: string } {
    const item: Queued = { id: newId('prompt'), text, blocks: [], source, logged: false }
    this.logPrompt(threadId, item)
    const pending = readPendingFork(threadId)
    writePendingFork(threadId, { ...pending, preface: pending.preface !== undefined ? `${pending.preface}\n\n${text}` : text })
    return { promptId: item.id }
  }

  private enqueue(t: Thread, item: Queued): void {
    t.queue.push(item)
    this.pump(t)
  }

  /** Send the next queued prompt when the agent runs and no turn does; otherwise arm the idle stop. */
  private pump(t: Thread): void {
    if (t.state !== 'running' || t.turn) return
    const next = t.queue.shift()
    if (!next) return this.armIdle(t)
    if (!next.logged) this.logPrompt(t.id, next)
    void this.runTurn(t, next)
  }

  private async runTurn(t: Thread, item: Queued): Promise<void> {
    if (t.idle) clearTimeout(t.idle)
    const turn = this.newTurn(t)
    t.turn = turn
    markAgentWorking(this.ctx, t.id)
    appendThreadEvent(t.id, { type: 'turn_started' })
    // Taken before the agent hears the prompt, so nothing it does is in it.
    await turn.snapshot
    // The opening rides after the prompt's own words, so a human's message
    // still reads as the human's (the UserPromptSubmit hook looks at its start).
    // A command is never given it: the opening would become the command's argument.
    const [first, ...rest] = item.blocks
    // The thread says it was briefed, so no title made of the opening names it (`naming.ts`).
    const opening = item.hidden ? undefined : t.opening
    const prompt: acp.ContentBlock[] =
      opening && first?.type === 'text' ? [{ type: 'text', text: `${first.text}\n\n${opening}` }, ...rest] : item.blocks
    if (!item.hidden) t.opening = undefined
    if (prompt !== item.blocks) appendThreadEvent(t.id, { type: 'briefed' })
    let end: Extract<ThreadEventBody, { type: 'turn_ended' }>
    try {
      const res = await t.conn!.agent.request(acp.methods.agent.session.prompt, { sessionId: t.sessionId!, prompt })
      const reason = TurnEnd.safeParse(res.stopReason)
      end = { type: 'turn_ended', reason: reason.success ? reason.data : 'end_turn' }
    } catch (err) {
      // A stopped process's own event closes the turn.
      if (t.state === 'stopped') return
      end = { type: 'turn_ended', reason: 'error', error: errorText(err) }
    }
    if (t.state === 'stopped') return
    const files = await this.turnFiles(t, turn)
    if (isStopped(t)) return
    t.turn = null
    appendThreadEvent(t.id, { ...end, ...(files.length ? { files } : {}) })
    markAwaitingInput(this.ctx, t.id)
    const row = getSessionRow(this.ctx, t.id)
    // The turn may have written files: the composer's `@` lists them afresh.
    if (row) forgetWorktreeFiles(row.worktreePath)
    if (row) this.hook(() => this.lifecycle.turnEnded?.(row, item.source))
    this.pump(t)
  }

  private newTurn(t: Thread): Turn {
    const cwd = getSessionRow(this.ctx, t.id)?.worktreePath ?? ''
    return { diffs: new Map(), snapshot: snapshotWorktree(cwd).catch(() => null) }
  }

  /**
   * What the turn changed: every file whose content moved in the worktree since
   * the turn began (a shell command's writes too), and the edit tools' diffs
   * for any file git does not see; paths relative to the worktree.
   */
  private async turnFiles(t: Thread, turn: Turn): Promise<FileChange[]> {
    const snap = await turn.snapshot
    const root = snap?.root ?? getSessionRow(this.ctx, t.id)?.worktreePath ?? ''
    const worktree = snap ? await worktreeChanges(snap).catch((): ToolDiff[] => []) : []
    const seen = new Set(worktree.map((d) => d.path))
    const edits = [...turn.diffs.values()].flat().map((d) => ({ ...d, path: worktreeRelative(root, d.path) }))
    return fileChanges([...worktree, ...edits.filter((d) => !seen.has(d.path))])
  }

  /**
   * Agent output with no turn running: the agent started a turn by itself
   * (Claude Code answering a background command that finished). It is wrapped
   * in a turn like any other, ended by Claude's session going idle
   * ({@link onSdkMessage}) or, on a runtime that has no such signal, by going
   * quiet for {@link SELF_TURN_QUIET_MS}.
   */
  private selfTurn(t: Thread): Turn {
    if (t.idle) clearTimeout(t.idle)
    const turn: Turn = { ...this.newTurn(t), self: true }
    t.turn = turn
    markAgentWorking(this.ctx, t.id)
    appendThreadEvent(t.id, { type: 'turn_started', source: 'agent' })
    return turn
  }

  /** Push a quiet-ended self-started turn's end back: the agent still says things. */
  private stillTalking(t: Thread, turn: Turn): void {
    if (!turn.self || this.saysWhenIdle(t)) return
    if (turn.quiet) clearTimeout(turn.quiet)
    turn.quiet = setTimeout(() => void this.endSelfTurn(t, turn, 'end_turn'), this.selfTurnQuietMs)
    turn.quiet.unref?.()
  }

  /** Claude reports its session going idle (forwarded SDK `session_state_changed`). */
  private saysWhenIdle(t: Thread): boolean {
    return (getSessionRow(this.ctx, t.id)?.runtime ?? DEFAULT_RUNTIME) === 'claude-code'
  }

  private async endSelfTurn(t: Thread, turn: Turn, reason: 'end_turn' | 'cancelled'): Promise<void> {
    if (t.turn !== turn) return
    if (turn.quiet) clearTimeout(turn.quiet)
    const files = await this.turnFiles(t, turn)
    // Ended meanwhile: by the stop that closed it, or by another end signal.
    if (isStopped(t) || t.turn !== turn) return
    t.turn = null
    appendThreadEvent(t.id, { type: 'turn_ended', reason, ...(files.length ? { files } : {}) })
    markAwaitingInput(this.ctx, t.id)
    this.pump(t)
  }

  /** Steer a human prompt into the running turn; when the turn has just ended, it is the next prompt. */
  private async steer(t: Thread, item: Queued): Promise<void> {
    try {
      const res = await t.conn!.agent.request<{ outcome?: string }>(STEER_METHOD, {
        sessionId: t.sessionId,
        prompt: item.blocks,
        _meta: { steering: { idleBehavior: 'promptRequired' } },
      })
      if (res?.outcome !== 'promptRequired') return
    } catch {
      if (t.state === 'stopped') return
    }
    this.enqueue(t, item)
  }

  private armIdle(t: Thread): void {
    if (t.idle) clearTimeout(t.idle)
    t.idle = setTimeout(() => {
      if (this.threads.get(t.id) === t && !t.turn && !t.ask && !t.queue.length) void this.stop(t.id, 'idle')
    }, this.idleMs)
    t.idle.unref?.()
  }

  // ---- what the agent says and asks ----

  private onUpdate(t: Thread, sessionId: string, update: acp.SessionUpdate): void {
    if (t.state === 'stopped' || (t.loading && REPLAYED.has(update.sessionUpdate))) return
    if (TURN_OUTPUT.has(update.sessionUpdate) && t.state === 'running' && !t.loading) {
      const turn = t.turn ?? this.selfTurn(t)
      this.stillTalking(t, turn)
    }
    // A subagent's file changes are the turn's too.
    if (t.turn && (update.sessionUpdate === 'tool_call' || update.sessionUpdate === 'tool_call_update')) {
      const diffs = toolDiffs(update.content)
      if (update.status === 'failed') t.turn.diffs.delete(update.toolCallId)
      else if (diffs.length) t.turn.diffs.set(update.toolCallId, diffs)
    }
    const own = !t.sessionId || sessionId === t.sessionId
    if (own && update.sessionUpdate === 'config_option_update') this.noteOptions(t, update.configOptions)
    for (const body of t.map(update, own ? undefined : sessionId)) {
      // The model a session opens on is logged once it runs, after the thread's own
      // choice is applied; the adapter's announcement while it opens is not news.
      if (body.type === 'model' && t.state === 'starting') continue
      if (body.type === 'title') {
        // The runtime's generated title names a thread nobody named, unless it was made from
        // runcastle's opening (see `naming.ts`); a name the human gave stays.
        if (getSessionRow(this.ctx, t.id)?.title) continue
        if (runtimeMayName(readThreadEvents(t.id))) setSessionTitle(this.ctx, t.id, body.title)
      }
      appendThreadEvent(t.id, body)
    }
  }

  /**
   * A Claude session's forwarded SDK message: the background commands it runs,
   * when they change, and its session going idle, which ends a turn it started
   * by itself.
   */
  private onSdkMessage(t: Thread, message: unknown): void {
    if (t.state === 'stopped') return
    if (t.turn?.self && wentIdle(message)) return void this.endSelfTurn(t, t.turn, 'end_turn')
    const tasks = backgroundTasks(message, t.tasks, Date.now())
    if (!tasks) return
    t.tasks = tasks
    appendThreadEvent(t.id, { type: 'tasks', tasks })
  }

  private unattended(t: Thread): boolean {
    return getSessionRow(this.ctx, t.id)?.purpose === 'self-plan'
  }

  private async onPermission(t: Thread, req: acp.RequestPermissionRequest): Promise<acp.RequestPermissionResponse> {
    const option = (...kinds: acp.PermissionOptionKind[]): acp.RequestPermissionResponse => {
      const found = kinds.map((kind) => req.options.find((o) => o.kind === kind)).find((o) => o !== undefined)
      return { outcome: found ? { outcome: 'selected', optionId: found.optionId } : { outcome: 'cancelled' } }
    }
    if (this.unattended(t)) {
      appendThreadEvent(t.id, { type: 'ask_resolved', id: newId('ask'), lines: [UNATTENDED_LINE] })
      return option('reject_once', 'reject_always')
    }
    const answer = await this.openAsk(t, { kind: 'approval', id: newId('ask'), call: toolCallOf(req.toolCall) })
    if (answer === 'cancelled' || answer.kind !== 'approval') return { outcome: { outcome: 'cancelled' } }
    if (answer.choice === 'allow') return option('allow_once')
    if (answer.choice === 'always') return option('allow_always', 'allow_once')
    return option('reject_once', 'reject_always')
  }

  private async onElicitation(t: Thread, req: acp.CreateElicitationRequest): Promise<acp.CreateElicitationResponse> {
    if (this.unattended(t)) {
      appendThreadEvent(t.id, { type: 'ask_resolved', id: newId('ask'), lines: [UNATTENDED_LINE] })
      return { action: 'decline' }
    }
    const questions = elicitationQuestions(req)
    if (questions) {
      const answer = await this.openAsk(t, { kind: 'question', id: newId('ask'), questions })
      if (answer === 'cancelled' || answer.kind !== 'question') return { action: 'cancel' }
      return elicitationAnswer(questions, answer.answers)
    }
    // An MCP server's own form or link.
    const ask = elicitationAsk(req, newId('ask'))
    if ('unsupported' in ask) {
      appendThreadEvent(t.id, { type: 'ask_resolved', id: newId('ask'), lines: [unsupportedLine(req, ask.unsupported)] })
      return { action: 'decline' }
    }
    const pending = this.openAsk(t, ask)
    if (t.ask && ask.kind === 'link') t.ask.elicitationId = (req as acp.ElicitationUrlMode).elicitationId
    const answer = await pending
    if (answer === 'cancelled') return { action: 'cancel' }
    if (answer.kind === 'form' && ask.kind === 'form') return { action: 'accept', content: formContent(ask, answer.values) }
    if (answer.kind === 'link') return { action: 'accept' }
    return { action: 'decline' }
  }

  /** The page a link ask opened was finished on the server's side (a sign-in completed): the dock goes. */
  private onElicitationComplete(t: Thread, elicitationId: string): void {
    const open = t.ask
    if (open?.ask.kind !== 'link' || open.elicitationId !== elicitationId) return
    appendThreadEvent(t.id, { type: 'ask_resolved', id: open.ask.id, lines: [{ what: 'Done', answer: open.ask.message }] })
    markAgentWorking(this.ctx, t.id)
    this.settleAsk(t, { kind: 'link', done: true })
  }

  /** Log the ask, tell the sidebar the agent waits, and hold until it is answered or withdrawn. */
  private openAsk(t: Thread, ask: Ask): Promise<AskAnswer | 'cancelled'> {
    if (t.state === 'stopped') return Promise.resolve('cancelled')
    this.settleAsk(t, 'cancelled')
    appendThreadEvent(t.id, { type: 'ask', ask })
    markAwaitingInput(this.ctx, t.id)
    return new Promise((settle) => {
      t.ask = { ask, settle }
    })
  }

  private settleAsk(t: Thread, answer: AskAnswer | 'cancelled'): void {
    const open = t.ask
    t.ask = undefined
    open?.settle(answer)
  }
}

/** A host of its own, for tests and for the process-wide one. */
export function createAgentHost(deps: AgentHostDeps): AgentHost {
  return new Host(deps)
}

const HOST_KEY = Symbol.for('runcastle.threads.host')
type GlobalWithHost = typeof globalThis & { [HOST_KEY]?: AgentHost }

/** The process-wide host, pinned on `globalThis` so a `bun --hot` reload keeps its processes. */
export function processAgentHost(ctx: AppCtx): AgentHost {
  const g = globalThis as GlobalWithHost
  if (!g[HOST_KEY]) g[HOST_KEY] = createAgentHost({ ctx, lifecycle: threadLifecycle(ctx) })
  return g[HOST_KEY]
}

/** Put a host (a fake agent behind it) in the process-wide slot; `undefined` clears it. */
export function setAgentHostForTests(host: AgentHost | undefined): void {
  const g = globalThis as GlobalWithHost
  if (host) g[HOST_KEY] = host
  else delete g[HOST_KEY]
}
