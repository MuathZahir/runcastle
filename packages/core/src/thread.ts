import * as z from 'zod'

/**
 * Threads (chat-as-web-components; ADR-0015). Every agent conversation is a
 * thread: the server turns the agent's ACP session updates, the prompts it
 * sends and the asks it answers into {@link ThreadEvent}s and appends them to
 * the thread's log; {@link foldThread} turns the log into the {@link ThreadView}
 * the web renders. Server and web fold with this same function, so a thread
 * reads the same from the log as it does live, and its behaviour is decided in
 * exactly one place.
 *
 * Tool calls carry ACP's own `kind` and `status` words, so mapping from the
 * protocol is a rename, not a translation.
 */

// ---- the leaf shapes, shared by events and the view ----

/** ACP's `ToolKind`: what a tool call does, which picks its glyph and verb. */
export const ToolKind = z.enum(['read', 'edit', 'delete', 'move', 'search', 'execute', 'think', 'fetch', 'other'])
export type ToolKind = z.infer<typeof ToolKind>

/** ACP's `ToolCallStatus`. */
export const ToolStatus = z.enum(['pending', 'in_progress', 'completed', 'failed'])
export type ToolStatus = z.infer<typeof ToolStatus>

/** One line of a file change. */
export const DiffLine = z.object({ op: z.enum([' ', '+', '-']), text: z.string() })
export type DiffLine = z.infer<typeof DiffLine>

export const ToolCall = z.object({
  id: z.string(),
  kind: ToolKind,
  /** What the call did, short: a path, a command, a query. */
  title: z.string(),
  status: ToolStatus,
  /** What it printed, for an `execute` or a failure. */
  output: z.string().optional(),
  diff: z.object({ path: z.string(), lines: z.array(DiffLine) }).optional(),
})
export type ToolCall = z.infer<typeof ToolCall>

/** One file a turn changed, for the turn's changes card. */
export const FileChange = z.object({
  path: z.string(),
  added: z.number().int().nonnegative(),
  removed: z.number().int().nonnegative(),
  lines: z.array(DiffLine),
})
export type FileChange = z.infer<typeof FileChange>

/**
 * An image on a prompt. In the log `src` is a reference the server can serve
 * (never inline base64, which would bloat every read); the web shows it in an
 * `<img>`. In the composer, before sending, it is a local object URL.
 */
export const Attachment = z.object({ id: z.string(), src: z.string(), name: z.string() })
export type Attachment = z.infer<typeof Attachment>

export const QuestionOption = z.object({ label: z.string(), description: z.string().optional() })
export type QuestionOption = z.infer<typeof QuestionOption>

export const Question = z.object({
  header: z.string(),
  question: z.string(),
  options: z.array(QuestionOption),
  multiSelect: z.boolean().optional(),
})
export type Question = z.infer<typeof Question>

/** What every field of an MCP server's form carries, whatever it holds. */
const FormFieldBase = {
  /** The key its value is sent back under. */
  key: z.string(),
  title: z.string(),
  description: z.string().optional(),
  required: z.boolean().optional(),
}

/**
 * One field of a form an MCP server asks the human to fill (an ACP form
 * elicitation): only the flat primitives MCP allows, each its own control.
 */
export const FormField = z.discriminatedUnion('type', [
  z.object({ ...FormFieldBase, type: z.literal('string'), format: z.enum(['email', 'uri', 'date']).optional(), default: z.string().optional() }),
  z.object({ ...FormFieldBase, type: z.literal('number'), integer: z.boolean().optional(), default: z.number().optional() }),
  z.object({ ...FormFieldBase, type: z.literal('boolean'), default: z.boolean().optional() }),
  /** A single choice; `value` is what is sent, `label` what is shown. */
  z.object({
    ...FormFieldBase,
    type: z.literal('enum'),
    options: z.array(z.object({ value: z.string(), label: z.string() })),
    default: z.string().optional(),
  }),
])
export type FormField = z.infer<typeof FormField>

/** A filled form, keyed by each field's `key`. */
export const FormValues = z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
export type FormValues = z.infer<typeof FormValues>

/** What the agent waits on the human for, docked where the composer is. */
export const Ask = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('approval'), id: z.string(), call: ToolCall }),
  z.object({ kind: z.literal('question'), id: z.string(), questions: z.array(Question) }),
  /** An MCP server asks the human to fill a form. */
  z.object({ kind: z.literal('form'), id: z.string(), server: z.string().optional(), message: z.string(), fields: z.array(FormField) }),
  /** An MCP server asks the human to open a page (a sign-in, a consent) and say when they are done. */
  z.object({ kind: z.literal('link'), id: z.string(), server: z.string().optional(), message: z.string(), url: z.string() }),
])
export type Ask = z.infer<typeof Ask>

/** How the human answered an ask — the input to the host's `answer`. */
export const AskAnswer = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('approval'),
    choice: z.enum(['allow', 'always', 'deny']),
    /** With `deny`: what the agent should do instead, sent as the human's next words. */
    instead: z.string().optional(),
  }),
  /** Keyed by each question's `question` text, as Claude's AskUserQuestion answers are. */
  z.object({ kind: z.literal('question'), answers: z.record(z.string(), z.string()) }),
  z.object({ kind: z.literal('form'), values: FormValues }),
  z.object({ kind: z.literal('link'), done: z.literal(true) }),
  /** Refusing a form or a link. */
  z.object({ kind: z.literal('decline') }),
])
export type AskAnswer = z.infer<typeof AskAnswer>

/** A slash command the agent offers, from the adapter's command list. */
export const SlashCommand = z.object({ name: z.string(), description: z.string() })
export type SlashCommand = z.infer<typeof SlashCommand>

/** The agent's own task list for the turn (ACP plan updates). */
export const PlanEntry = z.object({
  content: z.string(),
  status: z.enum(['pending', 'in_progress', 'completed']),
})
export type PlanEntry = z.infer<typeof PlanEntry>

/** A command the agent left running in the background. */
export const BackgroundTask = z.object({ id: z.string(), title: z.string(), startedAt: z.number() })
export type BackgroundTask = z.infer<typeof BackgroundTask>

/** How hard the model thinks; the runtime's own levels. */
export const Effort = z.enum(['low', 'medium', 'high', 'max'])
export type Effort = z.infer<typeof Effort>

/** How full the context window is, from ACP's usage updates. */
export const ContextUsage = z.object({
  used: z.number().nonnegative(),
  size: z.number().positive(),
  /** Cost of this thread so far, when the runtime reports it. */
  costUsd: z.number().nonnegative().optional(),
})
export type ContextUsage = z.infer<typeof ContextUsage>

/** A model the thread's runtime offers, from the adapter's config options. */
export interface ModelChoice {
  id: string
  label: string
  note?: string
  /** The runtime offers fast mode on this model (Claude's `fast`, Codex's `fast-mode` option). */
  fast?: boolean
  /**
   * The effort levels the model takes: as a session on it said, else as one on
   * a model of its family said, else its runtime's known levels.
   */
  efforts?: Effort[]
  /** The level a session on this model starts on when nobody picks one, once a session on it has said. */
  defaultEffort?: Effort
}

const VERSION = /^\d+(?:\.\d+)*$/

/**
 * A model label's family and version: "Opus 4.8" → Opus, [4, 8]. Codex names
 * its models by version alone ("5.6 Sol", "5.5 Mini"), so a GPT generation is
 * the family: "5.6 Sol" → GPT-5, [5, 6].
 */
export function modelFamily(label: string): { family: string; version: number[] } {
  const words = label.split(/\s+/).filter(Boolean)
  const at = words.findIndex((w) => VERSION.test(w))
  if (at < 0) return { family: words[0] ?? label, version: [] }
  const version = words[at].split('.').map(Number)
  return { family: at > 0 ? words.slice(0, at).join(' ') : `GPT-${version[0]}`, version }
}

/** What the composer's model controls offer a thread: its runtime's one catalog, and the model it is on. */
export interface ThreadModels {
  runtime: 'claude-code' | 'codex'
  models: ModelChoice[]
  /** The model the thread runs on, or would start on; null while its runtime offers none. */
  current: string | null
}

/** One subscription limit (Claude's 5-hour and weekly windows, Codex's rate limits). */
export interface UsageLimit {
  label: string
  /** 0–100. */
  percent: number
  /** When it resets, said for a person: "3:40 pm", "Thu 9:00 am". */
  resets: string
}

/** The usage popover's numbers: the account's limits and which plan it is on. */
export interface UsageReport {
  limits: UsageLimit[]
  /** "Claude Max", "ChatGPT Pro"; absent when the runtime does not say. */
  plan?: string
}

// ---- events: what the log holds ----

/** Why a turn ended (ACP's `StopReason`, plus `error` for a turn the adapter failed). */
export const TurnEnd = z.enum(['end_turn', 'max_tokens', 'max_turn_requests', 'refusal', 'cancelled', 'error'])
export type TurnEnd = z.infer<typeof TurnEnd>

export const ThreadEventBody = z.discriminatedUnion('type', [
  /** A prompt sent to the agent: the human's, or runcastle's own (a kickoff, a wake, an orchestrator line). */
  z.object({
    type: z.literal('prompt'),
    id: z.string(),
    text: z.string(),
    images: z.array(Attachment).optional(),
    source: z.enum(['human', 'runcastle']),
    /** Sent while a turn ran: it joined that turn rather than starting one. */
    steered: z.boolean().optional(),
    /** A command runcastle sent for the human (Compact now's `/compact`): it runs a turn but is no message in the thread. */
    hidden: z.boolean().optional(),
  }),
  /** The agent process: starting on a prompt, running, stopped (idle, shutdown, crash). */
  z.object({
    type: z.literal('process'),
    state: z.enum(['starting', 'running', 'stopped']),
    /** Why it stopped or failed to start, when that is not a normal idle stop. */
    error: z.string().optional(),
  }),
  /** A turn begins: the answer to a prompt, or (`source: 'agent'`) one the agent started by itself, as Claude Code does when a background command it left running finishes. */
  z.object({ type: z.literal('turn_started'), source: z.literal('agent').optional() }),
  z.object({
    type: z.literal('turn_ended'),
    reason: TurnEnd,
    /** What the turn changed, for the changes card. */
    files: z.array(FileChange).optional(),
    error: z.string().optional(),
  }),
  /** A chunk of the agent's words; consecutive chunks with one `messageId` join. */
  z.object({ type: z.literal('agent_text'), messageId: z.string(), text: z.string() }),
  /** A chunk of the agent's thinking; consecutive chunks with one `thoughtId` join. */
  z.object({ type: z.literal('thought'), thoughtId: z.string(), text: z.string() }),
  /** A tool call, first seen or updated: fields present replace, `id` matches. */
  z.object({
    type: z.literal('tool'),
    call: ToolCall.partial().required({ id: true }),
    /** The subagent this call belongs to, when it is one of a subagent's calls. */
    parentId: z.string().optional(),
  }),
  /** A subagent the turn delegated to, first seen or updated. */
  z.object({ type: z.literal('subagent'), id: z.string(), title: z.string().optional(), status: ToolStatus.optional() }),
  z.object({ type: z.literal('plan'), entries: z.array(PlanEntry) }),
  z.object({ type: z.literal('tasks'), tasks: z.array(BackgroundTask) }),
  z.object({ type: z.literal('ask'), ask: Ask }),
  /**
   * An ask answered — by the human, by the host on an unattended thread, or
   * withdrawn by the agent. `lines` is what the thread keeps of it, one per
   * question or form field filled (or one for an approval, a link, a decline):
   * "Allowed  bun add …", "Page size: A4".
   */
  z.object({
    type: z.literal('ask_resolved'),
    id: z.string(),
    lines: z.array(z.object({ what: z.string(), answer: z.string(), denied: z.boolean().optional() })),
  }),
  z.object({ type: z.literal('usage'), context: ContextUsage }),
  /** The model (and effort, fast mode) the next turns run on. */
  z.object({
    type: z.literal('model'),
    model: z.string(),
    label: z.string(),
    effort: Effort.optional(),
    fast: z.boolean().optional(),
  }),
  z.object({ type: z.literal('commands'), commands: z.array(SlashCommand) }),
  z.object({ type: z.literal('compacted') }),
  z.object({ type: z.literal('title'), title: z.string() }),
  /** The agent's guess at the human's next message; `null` clears it. */
  z.object({ type: z.literal('suggestion'), text: z.string().nullable() }),
  /**
   * Edit-and-rewind (decision 10): the conversation went back to just before the
   * prompt `toPromptId`. Every event from that prompt up to this one is
   * superseded — kept in the log, left out of the fold.
   */
  z.object({ type: z.literal('rewound'), toPromptId: z.string() }),
  /** A failure the thread itself hit, outside any turn (the adapter would not start, auth expired). */
  z.object({ type: z.literal('error'), message: z.string() }),
  /** Something the thread says quietly about itself ("Started a new conversation — the earlier one could not be found"). */
  z.object({ type: z.literal('notice'), text: z.string() }),
  /**
   * Runcastle's own words reached the agent's conversation without being a
   * message in the thread: an opening that rode with a prompt (a resumed main
   * chat's state header, a lost conversation's briefing), or the kickoff a
   * terminal-era conversation began with before its log. Shows nothing; it
   * keeps the runtime's generated title, made of those words, from naming the thread.
   */
  z.object({ type: z.literal('briefed') }),
])
export type ThreadEventBody = z.infer<typeof ThreadEventBody>

/** One line of a thread's log: a monotonic index (the read cursor), when, and what. */
export const ThreadEvent = z.intersection(z.object({ i: z.number().int().nonnegative(), at: z.number() }), ThreadEventBody)
export type ThreadEvent = z.infer<typeof ThreadEvent>

// ---- the view: what the web renders ----

/** One step of a turn's work, before its final words. */
export type WorkStep =
  | { kind: 'tools'; id: string; calls: ToolCall[] }
  | { kind: 'thought'; id: string; seconds: number; text: string }
  /** Words the agent said between tool calls, not its final answer. */
  | { kind: 'narration'; id: string; text: string }
  /** A subagent the turn delegated to, with its own calls. */
  | { kind: 'subagent'; id: string; title: string; status: ToolStatus; calls: ToolCall[] }

export type ThreadItem =
  | {
      kind: 'user'
      id: string
      text: string
      images?: Attachment[]
      /** Sent while no agent was running: it waits for one to start. */
      starting?: boolean
      /** Sent while a turn ran: it went into that turn rather than starting a new one. */
      steered?: boolean
      /** Runcastle's own message to the agent (a round's end, Go), not the human's. */
      from?: 'runcastle'
    }
  /**
   * A turn's work. While the turn runs it shows step by step; once settled it
   * folds to one line ("Worked for 3m 43s") and the final words stay in view.
   */
  | { kind: 'work'; id: string; steps: WorkStep[]; seconds: number; live?: boolean }
  /** The agent's words: the end of a turn, or a turn that was only words. */
  | { kind: 'agent'; id: string; text: string; model?: string }
  | { kind: 'changes'; id: string; files: FileChange[] }
  /** An answered approval or question, folded to a line. */
  | { kind: 'answered'; id: string; what: string; answer: string; denied?: boolean }
  /** A turn stopped by the human (Stop or Esc). */
  | { kind: 'stopped'; id: string }
  | { kind: 'compacted'; id: string }
  /** The model changed between two messages; `effort` when that changed with it. */
  | { kind: 'model'; id: string; model: string; effort?: Effort }
  /** Something went wrong: a failed turn, an agent that would not start. */
  | { kind: 'error'; id: string; message: string }
  /** A quiet line the thread says about itself. */
  | { kind: 'notice'; id: string; text: string }

/** Where a thread is, which is all the human is told about its process. */
export type ThreadState = 'working' | 'waiting' | 'idle'

export interface ThreadView {
  items: ThreadItem[]
  state: ThreadState
  /** What the agent waits on the human for, when `state` is `waiting`. */
  ask?: Ask
  /** The turn's task list; empty once the thread is idle. */
  plan: PlanEntry[]
  tasks: BackgroundTask[]
  context?: ContextUsage
  /** The model, effort and fast mode the next message runs on. */
  model?: { id: string; label: string; effort?: Effort; fast?: boolean }
  commands: SlashCommand[]
  title?: string
  /** The agent's guess at the next message, offered in an empty composer. */
  suggestion?: string
  /** When the running turn began, for "Working · 1m 19s". */
  turnStartedAt?: number
  process: 'stopped' | 'starting' | 'running'
  /** The index of the last event folded: the next read's cursor. -1 for an empty log. */
  cursor: number
}

/** A row of the thread list in the header's switcher. */
export interface ThreadEntry {
  id: string
  title: string
  /** What kind of thread: the feature's main chat, a side thread, a scenario chat, a project chat. */
  role: 'main' | 'side' | 'scenario' | 'project' | 'prepare'
  state: ThreadState
  /** When it last moved, for "4m", "2d". */
  updatedAt: number
  runtime: 'claude-code' | 'codex'
  /** A conversation from before threads had logs: it reads back as plain turns until it is continued. */
  readOnlyTranscript?: boolean
}

/** Prompts runcastle sends wear this; the fold shows them as runcastle's line, not the human's bubble. */
export const EMPTY_THREAD_VIEW: ThreadView = { items: [], state: 'idle', plan: [], tasks: [], commands: [], process: 'stopped', cursor: -1 }

/** The events {@link foldThread} still reads after edit-and-rewind cut some out. */
export function liveEvents(events: readonly ThreadEvent[]): ThreadEvent[] {
  const superseded = new Set<number>()
  events.forEach((e, at) => {
    if (e.type !== 'rewound') return
    const from = events.findIndex((p, j) => j < at && p.type === 'prompt' && p.id === e.toPromptId)
    if (from < 0) return
    for (let j = from; j < at; j++) superseded.add(j)
  })
  return events.filter((e, j) => !superseded.has(j) && e.type !== 'rewound')
}

/** One piece of a turn, in arrival order, before it is split into work and answer. */
type Segment =
  | { kind: 'text'; id: string; text: string }
  | { kind: 'thought'; id: string; text: string; from: number; to: number }
  | { kind: 'tools'; id: string; calls: ToolCall[] }
  | { kind: 'subagent'; id: string; title: string; status: ToolStatus; calls: ToolCall[] }

interface Turn {
  id: string
  startedAt: number
  segments: Segment[]
  /** Subagents by id, for routing their calls. */
  subagents: Map<string, Extract<Segment, { kind: 'subagent' }>>
  /** Every call by id, wherever it sits, for updates. */
  calls: Map<string, ToolCall>
  model?: string
  /** Opened by a `turn_started`; one opened by output alone is no turn anything is known to be running. */
  started: boolean
}

const BLANK_CALL: Omit<ToolCall, 'id'> = { kind: 'other', title: '', status: 'pending' }

/**
 * Fold a thread's log into what the web renders. Pure, total and deterministic:
 * unknown orderings (an update before its call, a turn end with no start) are
 * absorbed, never thrown on, because a log written by a crashed process still
 * has to open.
 *
 * The rules, each decided here and nowhere else:
 * - A turn's segments arrive in order (text, thinking, tool calls, subagents).
 *   Its trailing words — text after the last tool call — are its answer
 *   (`agent`); everything before goes into one `work` item, live while the
 *   turn runs and folded to "Worked for …" once it ends. Live or settled, the
 *   split is the same, so streaming words show as the answer until a tool call
 *   turns them into narration.
 * - A prompt sent before the process ran shows `starting` until the process
 *   runs or a turn starts. A `hidden` prompt (a command) shows nothing.
 * - A thread is `working` only inside a turn a `turn_started` opened: words
 *   logged after a turn's end (with no turn around them) fold as settled.
 * - A model divider appears only when the model changes after one was set; a
 *   compaction shows once however many times it is reported before the next
 *   prompt; a usage report without a cost keeps the last one.
 * - The plan shows only while the thread is not idle; a suggestion clears on
 *   the next prompt.
 */
export function foldThread(log: readonly ThreadEvent[]): ThreadView {
  const events = liveEvents(log)
  const items: ThreadItem[] = []
  const view: ThreadView = { ...EMPTY_THREAD_VIEW, items, plan: [], tasks: [], commands: [] }
  view.cursor = log.length ? log[log.length - 1].i : -1

  let turn: Turn | null = null
  let workIndex = -1
  let answerIndex = -1
  let ask: Ask | undefined
  let startingPrompt: Extract<ThreadItem, { kind: 'user' }> | null = null
  /** A compaction was shown since the last prompt: the next one is the same compaction told twice. */
  let compactedSincePrompt = false

  /** Re-render the open turn's work and answer items in place. */
  const render = (live: boolean, endedAt?: number) => {
    if (!turn) return
    const segs = turn.segments
    let last = segs.length - 1
    while (last >= 0 && segs[last].kind === 'text' && !(segs[last] as { text: string }).text.trim()) last--
    const answer = last >= 0 && segs[last].kind === 'text' ? (segs[last] as Extract<Segment, { kind: 'text' }>) : null
    const work = answer ? segs.slice(0, last) : segs.slice(0, last + 1)
    const steps: WorkStep[] = work
      .map((s): WorkStep | null => {
        switch (s.kind) {
          case 'text':
            return s.text.trim() ? { kind: 'narration', id: s.id, text: s.text } : null
          case 'thought':
            return { kind: 'thought', id: s.id, text: s.text, seconds: Math.max(1, Math.round((s.to - s.from) / 1000)) }
          case 'tools':
            return { kind: 'tools', id: s.id, calls: s.calls.map((c) => ({ ...c })) }
          case 'subagent':
            return { kind: 'subagent', id: s.id, title: s.title, status: s.status, calls: s.calls.map((c) => ({ ...c })) }
        }
      })
      .filter((s): s is WorkStep => s !== null)
    const seconds = Math.max(0, Math.round(((endedAt ?? turn.startedAt) - turn.startedAt) / 1000))
    const workItem: ThreadItem | null = steps.length ? { kind: 'work', id: `work:${turn.id}`, steps, seconds, ...(live ? { live } : {}) } : null
    const answerItem: ThreadItem | null = answer
      ? { kind: 'agent', id: answer.id, text: answer.text, ...(turn.model ? { model: turn.model } : {}) }
      : null
    // Work always precedes the answer; both keep their first-seen slots.
    if (workItem) {
      if (workIndex < 0) {
        workIndex = answerIndex >= 0 ? answerIndex : items.length
        items.splice(workIndex, 0, workItem)
        if (answerIndex >= 0) answerIndex++
      } else items[workIndex] = workItem
    } else if (workIndex >= 0) {
      items.splice(workIndex, 1)
      if (answerIndex > workIndex) answerIndex--
      workIndex = -1
    }
    if (answerItem) {
      if (answerIndex < 0) {
        answerIndex = items.length
        items.push(answerItem)
      } else items[answerIndex] = answerItem
    } else if (answerIndex >= 0) {
      items.splice(answerIndex, 1)
      answerIndex = -1
    }
  }

  const openTurn = (e: ThreadEvent): Turn => {
    if (!turn) {
      turn = { id: String(e.i), startedAt: e.at, segments: [], subagents: new Map(), calls: new Map(), model: view.model?.label, started: e.type === 'turn_started' }
      workIndex = -1
      answerIndex = -1
      view.turnStartedAt = e.at
    }
    return turn
  }

  const closeTurn = (e: ThreadEvent, reason: TurnEnd, files?: FileChange[], error?: string) => {
    if (turn) {
      for (const c of turn.calls.values()) if (c.status === 'in_progress' || c.status === 'pending') c.status = reason === 'end_turn' ? 'completed' : 'failed'
      for (const s of turn.subagents.values()) if (s.status === 'in_progress' || s.status === 'pending') s.status = reason === 'end_turn' ? 'completed' : 'failed'
      render(false, e.at)
    }
    if (files?.length) items.push({ kind: 'changes', id: `changes:${e.i}`, files })
    if (reason === 'cancelled') items.push({ kind: 'stopped', id: `stopped:${e.i}` })
    if (reason === 'error' || reason === 'refusal' || reason === 'max_tokens' || reason === 'max_turn_requests') {
      const message =
        error ??
        (reason === 'refusal'
          ? 'The model declined to continue.'
          : reason === 'error'
            ? 'The turn failed.'
            : 'The turn hit its limit and stopped.')
      items.push({ kind: 'error', id: `error:${e.i}`, message })
    }
    turn = null
    ask = undefined
    view.turnStartedAt = undefined
  }

  /**
   * Something the human did mid-turn (a steered message, an answered ask) sits
   * between what the agent did before it and what it does after: settle the
   * part before, and start a fresh work/answer pair after it in the same turn.
   */
  const splitTurn = (e: ThreadEvent) => {
    if (!turn) return
    render(false, e.at)
    turn.id = String(e.i)
    turn.startedAt = e.at
    turn.segments = []
    turn.subagents = new Map()
    turn.calls = new Map()
    workIndex = -1
    answerIndex = -1
  }

  for (const e of events) {
    switch (e.type) {
      case 'prompt': {
        compactedSincePrompt = false
        if (e.hidden) {
          // No message to show; what the command's turn does still folds as a turn.
          if (turn) splitTurn(e)
          break
        }
        const item: Extract<ThreadItem, { kind: 'user' }> = {
          kind: 'user',
          id: e.id,
          text: e.text,
          ...(e.images?.length ? { images: e.images } : {}),
          ...(e.steered ? { steered: true } : {}),
          ...(e.source === 'runcastle' ? { from: 'runcastle' as const } : {}),
        }
        if (view.process !== 'running' && !e.steered) {
          // Only the latest prompt waits visibly: a held opening's next prompt takes its place.
          if (startingPrompt) delete startingPrompt.starting
          item.starting = true
          startingPrompt = item
        }
        // A prompt between two turns closes the open answer slot: the next words are a new turn's.
        if (turn) splitTurn(e)
        else {
          workIndex = -1
          answerIndex = -1
        }
        items.push(item)
        view.suggestion = undefined
        break
      }
      case 'process':
        view.process = e.state
        if (e.state !== 'starting' && startingPrompt) {
          delete startingPrompt.starting
          startingPrompt = null
        }
        if (e.state === 'stopped') {
          if (turn) closeTurn(e, e.error ? 'error' : 'cancelled', undefined, e.error)
          if (e.error && !items.some((x) => x.id === `error:${e.i}`)) items.push({ kind: 'error', id: `error:${e.i}`, message: e.error })
          ask = undefined
          view.tasks = []
        }
        break
      case 'turn_started':
        if (startingPrompt) {
          delete startingPrompt.starting
          startingPrompt = null
        }
        if (turn) closeTurn(e, 'end_turn')
        openTurn(e)
        break
      case 'turn_ended':
        closeTurn(e, e.reason, e.files, e.error)
        break
      case 'agent_text': {
        const t = openTurn(e)
        const lastSeg = t.segments[t.segments.length - 1]
        if (lastSeg?.kind === 'text' && lastSeg.id === e.messageId) lastSeg.text += e.text
        else t.segments.push({ kind: 'text', id: e.messageId, text: e.text })
        render(true)
        break
      }
      case 'thought': {
        const t = openTurn(e)
        const lastSeg = t.segments[t.segments.length - 1]
        if (lastSeg?.kind === 'thought' && lastSeg.id === e.thoughtId) {
          lastSeg.text += e.text
          lastSeg.to = e.at
        } else t.segments.push({ kind: 'thought', id: e.thoughtId, text: e.text, from: e.at, to: e.at })
        render(true)
        break
      }
      case 'tool': {
        const t = openTurn(e)
        const known = t.calls.get(e.call.id)
        if (known) {
          Object.assign(known, Object.fromEntries(Object.entries(e.call).filter(([, v]) => v !== undefined)))
        } else {
          const call: ToolCall = { ...BLANK_CALL, ...(e.call as Partial<ToolCall>), id: e.call.id }
          t.calls.set(call.id, call)
          const parent = e.parentId ? t.subagents.get(e.parentId) : undefined
          if (parent) parent.calls.push(call)
          else {
            const lastSeg = t.segments[t.segments.length - 1]
            if (lastSeg?.kind === 'tools') lastSeg.calls.push(call)
            else t.segments.push({ kind: 'tools', id: `tools:${e.i}`, calls: [call] })
          }
        }
        render(true)
        break
      }
      case 'subagent': {
        const t = openTurn(e)
        const known = t.subagents.get(e.id)
        if (known) {
          if (e.title !== undefined) known.title = e.title
          if (e.status !== undefined) known.status = e.status
        } else {
          const seg: Extract<Segment, { kind: 'subagent' }> = { kind: 'subagent', id: e.id, title: e.title ?? 'Subagent', status: e.status ?? 'in_progress', calls: [] }
          t.subagents.set(e.id, seg)
          t.segments.push(seg)
        }
        render(true)
        break
      }
      case 'plan':
        view.plan = e.entries
        break
      case 'tasks':
        view.tasks = e.tasks
        break
      case 'ask':
        ask = e.ask
        break
      case 'ask_resolved':
        if (ask?.id === e.id) ask = undefined
        // The answer sits between the turn's work and whatever the agent does next.
        splitTurn(e)
        e.lines.forEach((l, n) =>
          items.push({ kind: 'answered', id: `answered:${e.i}:${n}`, what: l.what, answer: l.answer, ...(l.denied ? { denied: true } : {}) }),
        )
        break
      case 'usage': {
        // The thread's cost so far only grows: a report without it (one after a compaction) keeps the last.
        const costUsd = e.context.costUsd ?? view.context?.costUsd
        view.context = { ...e.context, ...(costUsd !== undefined ? { costUsd } : {}) }
        break
      }
      case 'model': {
        const before = view.model
        if (before && before.id !== e.model) {
          const effortChanged = !!before.effort && !!e.effort && before.effort !== e.effort
          items.push({ kind: 'model', id: `model:${e.i}`, model: e.label, ...(effortChanged ? { effort: e.effort } : {}) })
        }
        view.model = { id: e.model, label: e.label, ...(e.effort ? { effort: e.effort } : {}), ...(e.fast !== undefined ? { fast: e.fast } : {}) }
        break
      }
      case 'commands':
        view.commands = e.commands
        break
      case 'compacted':
        if (!compactedSincePrompt) items.push({ kind: 'compacted', id: `compacted:${e.i}` })
        compactedSincePrompt = true
        break
      case 'notice':
        items.push({ kind: 'notice', id: `notice:${e.i}`, text: e.text })
        break
      case 'title':
        view.title = e.title
        break
      case 'suggestion':
        view.suggestion = e.text ?? undefined
        break
      case 'error':
        items.push({ kind: 'error', id: `error:${e.i}`, message: e.message })
        break
      case 'rewound':
      case 'briefed':
        break
    }
  }

  // Output no turn_started opened (words logged after a turn's end) is settled
  // where it stands: nothing says a turn runs, so the thread is not working.
  const loose = turn as Turn | null
  if (loose && !loose.started) {
    const open = ask
    closeTurn(events[events.length - 1], 'end_turn')
    ask = open
  }
  view.ask = ask
  view.state = ask ? 'waiting' : turn ? 'working' : 'idle'
  if (view.state === 'idle') view.plan = []
  return view
}
