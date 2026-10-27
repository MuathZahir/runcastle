import { spawn } from 'node:child_process'
import { Readable, Writable } from 'node:stream'
import * as acp from '@agentclientprotocol/sdk/unstable'
import { newId, TurnEnd, type Ask, type AskAnswer, type Attachment, type SessionRow, type ThreadEventBody } from '@runcastle/core'
import type { AppCtx } from '../db/types'
import { GateError, NotImplementedError } from '../errors'
import type { AcpLaunchSpec } from '../launcher/runtimes/types'
import { getSessionRow, markAgentWorking, markAwaitingInput, markSessionEnded, markSessionLive } from '../launcher/sessions'
import { killProcessTree } from '../pty/kill-tree'
import { runcastleVersion } from '../version'
import {
  createUpdateMapper,
  elicitationAnswer,
  elicitationQuestions,
  fileChanges,
  modelEvent,
  toolCallOf,
  toolDiffs,
  type ToolDiff,
} from './acp-map'
import { saveThreadImage } from './images'
import { acpLaunchFor } from './launch'
import { threadLifecycle } from './lifecycle'
import { appendThreadEvent } from './log'
import type { AgentHost, PromptInput, PromptOptions, StopReason } from './types'

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
}

/**
 * The server's own reactions to a thread's process, beside the log: the
 * launcher's briefing, the timeline's events and what a session's end has
 * always done (see `threads/lifecycle.ts`). Every hook is best effort.
 */
export interface ThreadLifecycle {
  /** Text sent after the first prompt of a newly started process (a resumed main chat's fresh state header). */
  opening?(row: SessionRow): string | undefined
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

/** Decision 7: an idle agent process is stopped quietly after half an hour. */
export const IDLE_STOP_MS = 30 * 60_000

/** How much of a crashed adapter's stderr the thread keeps as its error. */
const STDERR_TAIL = 2000

/** Updates a `session/load` replays from history, which the log already holds. */
const REPLAYED = new Set(['user_message_chunk', 'agent_message_chunk', 'agent_thought_chunk', 'tool_call', 'tool_call_update', 'plan'])

/** The adapter's steering extension (`InitializeResponse._meta.steering`). */
const STEER_METHOD = '_session/steering'

/** What a self-planning run's asks are answered with: nobody is there to answer them. */
const UNATTENDED_LINE = { what: 'Declined', answer: 'nobody is watching this run', denied: true }

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
  /** Already in the log (a human's words show at once); runcastle's are logged when sent. */
  logged: boolean
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
  /** The running turn, with the file changes its tool calls reported, by call. */
  turn: { diffs: Map<string, ToolDiff[]> } | null
  queue: Queued[]
  ask?: { ask: Ask; settle: (answer: AskAnswer | 'cancelled') => void }
  idle?: ReturnType<typeof setTimeout>
  map: (update: acp.SessionUpdate) => ThreadEventBody[]
  /** Who sent the prompt that started this process. */
  startedBy: PromptOptions['source']
  /** The lifecycle's opening, sent with the first prompt and then forgotten. */
  opening?: string
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

  constructor(deps: AgentHostDeps) {
    this.ctx = deps.ctx
    this.transport = deps.transport ?? spawnAdapter
    this.launch = deps.launch ?? acpLaunchFor
    this.idleMs = deps.idleMs ?? IDLE_STOP_MS
    this.lifecycle = deps.lifecycle ?? {}
  }

  async prompt(threadId: string, input: PromptInput, opts: PromptOptions): Promise<{ promptId: string }> {
    const row = this.row(threadId)
    const images = (input.images ?? []).map((image) => saveThreadImage(threadId, image))
    const item: Queued = {
      id: newId('prompt'),
      text: input.text,
      ...(images.length ? { images } : {}),
      blocks: [
        { type: 'text', text: input.text },
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
  }

  async answer(threadId: string, askId: string, answer: AskAnswer): Promise<void> {
    const t = this.threads.get(threadId)
    const open = t?.ask
    if (!t || !open || open.ask.id !== askId) throw new GateError(`ask ${askId} is not open on this thread`)
    if (open.ask.kind !== answer.kind) throw new GateError(`ask ${askId} is ${open.ask.kind === 'approval' ? 'an approval' : 'a question'}`)
    let lines: Extract<ThreadEventBody, { type: 'ask_resolved' }>['lines']
    if (open.ask.kind === 'approval' && answer.kind === 'approval') {
      const what = { allow: 'Allowed', always: 'Always allowed', deny: 'Denied' }[answer.choice]
      lines = [{ what, answer: open.ask.call.title, ...(answer.choice === 'deny' ? { denied: true } : {}) }]
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

  async stop(threadId: string, reason: StopReason): Promise<void> {
    const t = this.threads.get(threadId)
    if (!t) return
    this.detach(t)
    await t.proc?.kill().catch(() => {})
    appendThreadEvent(t.id, { type: 'process', state: 'stopped' })
    this.ended(t, reason)
  }

  async stopAll(reason: StopReason): Promise<void> {
    await Promise.all([...this.threads.keys()].map((id) => this.stop(id, reason)))
  }

  isRunning(threadId: string): boolean {
    return this.threads.has(threadId)
  }

  async setConfig(): Promise<void> {
    throw new NotImplementedError('chat-as-web-components ticket 5')
  }

  async fork(): Promise<{ threadId: string }> {
    throw new NotImplementedError('chat-as-web-components ticket 5')
  }

  async usage(): Promise<never> {
    throw new NotImplementedError('chat-as-web-components ticket 5')
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
    const spec = await this.launch(this.ctx, row)
    const proc = await this.transport(spec, row)
    t.proc = proc
    void proc.exited.then(({ stderr }) => this.crashed(t, stderr))
    if (t.state === 'stopped') return
    const app = acp
      .client({ name: 'runcastle' })
      .onNotification(acp.methods.client.session.update, ({ params }) => this.onUpdate(t, params.update))
      .onRequest(acp.methods.client.session.requestPermission, ({ params }) => this.onPermission(t, params))
      .onRequest(acp.methods.client.elicitation.create, ({ params }) => this.onElicitation(t, params))
    const conn = proc.target instanceof acp.AgentApp ? app.connect(proc.target) : app.connect(proc.target)
    t.conn = conn
    const init = await conn.agent.request(acp.methods.agent.initialize, {
      protocolVersion: acp.PROTOCOL_VERSION,
      // The agent uses its own tools on its own disk; runcastle is not an editor.
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false, elicitation: { form: {} } },
      clientInfo: { name: 'runcastle', version: runcastleVersion() },
    })
    t.steering = (init._meta?.steering as { supported?: unknown } | undefined)?.supported === true
    const session: acp.NewSessionRequest = { cwd: row.worktreePath, mcpServers: [], _meta: spec.sessionMeta }
    let opened: acp.NewSessionResponse | acp.LoadSessionResponse
    if (row.ccSessionId) {
      t.loading = true
      try {
        opened = await conn.agent.request(acp.methods.agent.session.load, { ...session, sessionId: row.ccSessionId })
      } finally {
        t.loading = false
      }
      t.sessionId = row.ccSessionId
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
    // Stopped while it started (an archive, a shutdown): the stop already logged it.
    if (isStopped(t)) return
    const live = markSessionLive(this.ctx, t.id, { ccSessionId: t.sessionId })
    t.state = 'running'
    appendThreadEvent(t.id, { type: 'process', state: 'running' })
    const model = modelEvent(opened.configOptions)
    if (model) appendThreadEvent(t.id, model)
    this.hook(() => this.lifecycle.started?.(live ?? row, t.startedBy))
  }

  /**
   * Trust the session's own hooks (codex-acp): Codex runs a hook only once its
   * hash is trusted, and the adapter has no flag that skips the check, so
   * runcastle's generated guards and status line would otherwise never fire.
   */
  private async trustHooks(conn: acp.ClientConnection, cwd: string): Promise<void> {
    const listed = await conn.agent.request<{ hooks?: CodexHook[] }>(CODEX_HOOKS_LIST, { cwd })
    const hooks = (listed?.hooks ?? []).filter((h) => h.trustStatus !== 'trusted').map(({ key, currentHash }) => ({ key, currentHash }))
    if (hooks.length) await conn.agent.request(CODEX_HOOKS_TRUST, { cwd, hooks })
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
    })
    item.logged = true
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
    const turn = { diffs: new Map<string, ToolDiff[]>() }
    t.turn = turn
    markAgentWorking(this.ctx, t.id)
    appendThreadEvent(t.id, { type: 'turn_started' })
    // The opening rides after the prompt's own words, so a human's message
    // still reads as the human's (the UserPromptSubmit hook looks at its start).
    const [first, ...rest] = item.blocks
    const prompt: acp.ContentBlock[] =
      t.opening && first?.type === 'text' ? [{ type: 'text', text: `${first.text}\n\n${t.opening}` }, ...rest] : item.blocks
    t.opening = undefined
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
    const files = fileChanges([...turn.diffs.values()].flat())
    t.turn = null
    appendThreadEvent(t.id, { ...end, ...(files.length ? { files } : {}) })
    markAwaitingInput(this.ctx, t.id)
    const row = getSessionRow(this.ctx, t.id)
    if (row) this.hook(() => this.lifecycle.turnEnded?.(row, item.source))
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

  private onUpdate(t: Thread, update: acp.SessionUpdate): void {
    if (t.state === 'stopped' || (t.loading && REPLAYED.has(update.sessionUpdate))) return
    if (t.turn && (update.sessionUpdate === 'tool_call' || update.sessionUpdate === 'tool_call_update')) {
      const diffs = toolDiffs(update.content)
      if (update.status === 'failed') t.turn.diffs.delete(update.toolCallId)
      else if (diffs.length) t.turn.diffs.set(update.toolCallId, diffs)
    }
    for (const body of t.map(update)) appendThreadEvent(t.id, body)
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
    const questions = elicitationQuestions(req)
    // Only AskUserQuestion has a place in the thread; other forms get the SDK's own default.
    if (!questions) return { action: 'decline' }
    if (this.unattended(t)) {
      appendThreadEvent(t.id, { type: 'ask_resolved', id: newId('ask'), lines: [UNATTENDED_LINE] })
      return { action: 'decline' }
    }
    const answer = await this.openAsk(t, { kind: 'question', id: newId('ask'), questions })
    if (answer === 'cancelled' || answer.kind !== 'question') return { action: 'cancel' }
    return elicitationAnswer(questions, answer.answers)
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
