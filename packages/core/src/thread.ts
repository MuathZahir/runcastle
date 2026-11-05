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

/**
 * What a file an agent showed turned out to be, decided once when it was shown
 * (`threads/shown.ts`): a picture in the chat, read in the viewer as Markdown,
 * HTML or plain text, handed to the browser, or downloaded.
 */
export const ShownAs = z.enum(['image', 'markdown', 'html', 'text', 'browser', 'download'])
export type ShownAs = z.infer<typeof ShownAs>

/** A file an agent showed: a copy kept with the thread, served at `src`. */
export const ShownFile = z.object({
  id: z.string(),
  src: z.string(),
  name: z.string(),
  /** Where it was when shown; relative to the session's worktree when it sat inside it. */
  path: z.string(),
  size: z.number().int().nonnegative(),
  as: ShownAs,
  caption: z.string().optional(),
})
export type ShownFile = z.infer<typeof ShownFile>

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
  /** The effort a thread not running starts on: the human's choice, else the level its model starts on; absent while it runs, or when neither is known. */
  effort?: Effort
  /** Fast mode as the human chose it for a thread not running to start on. */
  fast?: boolean
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

/** What a turn a server restart cut off reads as, in place of "Stopped by you". */
export const RESTART_INTERRUPTED = 'Interrupted — runcastle restarted'

/** What an orchestrator tool did to a feature, as the features card says it. */
export const FeatureAction = z.enum([
  'created',
  'parked',
  'started',
  'planning',
  'planningStopped',
  'messaged',
  'relayed',
  'brief',
  'taken',
  'merged',
  'driveStarted',
  'driveStopped',
])
export type FeatureAction = z.infer<typeof FeatureAction>

/** What the human reads of a runcastle prompt, beside the text the agent gets. */
export const PromptDisplay = z.union([
  z.object({
    news: z.array(
      z.object({
        featureId: z.string(),
        title: z.string(),
        events: z.array(z.object({ tone: z.enum(['done', 'needsYou', 'failed', 'info']), words: z.string() })),
      }),
    ),
  }),
  z.object({ summary: z.string() }),
  z.object({ orchestrator: z.array(z.object({ text: z.string(), relayed: z.boolean() })) }),
])
export type PromptDisplay = z.infer<typeof PromptDisplay>

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
    /** What the human reads of a runcastle prompt; the agent never gets it. */
    display: PromptDisplay.optional(),
  }),
  /** The agent process: starting on a prompt, running, stopped (idle, shutdown, crash). */
  z.object({
    type: z.literal('process'),
    state: z.enum(['starting', 'running', 'stopped']),
    /** Why it stopped or failed to start, when that is not a normal idle stop. */
    error: z.string().optional(),
    /** It died with the server: written at boot over a log a restart cut off (a turn it cut reads {@link RESTART_INTERRUPTED}). */
    restarted: z.literal(true).optional(),
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
    /** What the call printed since its last update (a command's streamed output): added to its `output`. */
    outputAppend: z.string().optional(),
  }),
  /** A subagent the turn delegated to, first seen or updated. */
  z.object({ type: z.literal('subagent'), id: z.string(), title: z.string().optional(), status: ToolStatus.optional() }),
  z.object({ type: z.literal('plan'), entries: z.array(PlanEntry) }),
  /** `agents`: how many sub-agents run in the background beside the commands. */
  z.object({ type: z.literal('tasks'), tasks: z.array(BackgroundTask), agents: z.number().int().nonnegative().optional() }),
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
    /**
     * The human chose it (a pick in the composer, before or after the agent
     * started). Absent: what the adapter reported on its own, which a restart
     * does not take as the thread's model.
     */
    picked: z.boolean().optional(),
  }),
  z.object({ type: z.literal('commands'), commands: z.array(SlashCommand) }),
  z.object({ type: z.literal('compacted') }),
  /** The thread's name: the runtime's generated title, or with `renamed` the human's rename, which wins over every other name. */
  z.object({ type: z.literal('title'), title: z.string(), renamed: z.boolean().optional() }),
  /** The thread branched off another thread, then called `from`; shows nothing, and names it "Branch of …" until the human writes in it. */
  z.object({ type: z.literal('branched'), from: z.string() }),
  /** The agent's guess at the human's next message; `null` clears it. */
  z.object({ type: z.literal('suggestion'), text: z.string().nullable() }),
  /**
   * Edit-and-rewind (decision 10): the conversation went back to just before the
   * prompt `toPromptId`. Every event from that prompt up to this one is
   * superseded — kept in the log, left out of the fold.
   */
  z.object({ type: z.literal('rewound'), toPromptId: z.string() }),
  /** An agent showed the human a file (`show_file`). */
  z.object({ type: z.literal('file_shown'), file: ShownFile }),
  /** What a review pass left, shown as one package (`show_review_package`, or the pass's end). */
  z.object({ type: z.literal('review_package'), ticketId: z.string() }),
  /** The agent showed the feature's plan (`show_plan`): a plan card. */
  z.object({ type: z.literal('plan_shown') }),
  /** The agent showed one recorded design (`show_design`): a design card, which reads the record by id. */
  z.object({ type: z.literal('design_shown'), designId: z.string() }),
  /** An orchestrator tool changed a feature (`create_feature`, `merge_feature`…): a row of the turn's features card. */
  z.object({
    type: z.literal('feature_acted'),
    featureId: z.string(),
    title: z.string(),
    action: FeatureAction,
    /** The first line of a message sent to the feature. */
    quote: z.string().optional(),
    /** The branch a merge landed in. */
    into: z.string().optional(),
  }),
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
      /** What the human reads of a runcastle line, in place of its text. */
      display?: PromptDisplay
      /** When the line arrived; carried with `display`, for a news block's "6m ago". */
      at?: number
    }
  /**
   * A turn's work. While the turn runs it shows step by step; once settled it
   * folds to one line ("Worked for 3m 43s") and the final words stay in view.
   */
  | { kind: 'work'; id: string; steps: WorkStep[]; seconds: number; live?: boolean }
  /** The agent's words: the end of a turn, or a turn that was only words. */
  | { kind: 'agent'; id: string; text: string; model?: string }
  | { kind: 'changes'; id: string; files: FileChange[] }
  /** The files a turn showed. It stays in view when the turn's work folds. */
  | { kind: 'shown'; id: string; files: ShownFile[] }
  /** A review pass's package: one attachment that opens everything the pass left. */
  | { kind: 'review_package'; id: string; ticketId: string }
  /** The plan, shown as a card; `older` when a later plan card follows it (it still opens the current plan). */
  | { kind: 'plan_card'; id: string; older?: boolean }
  /**
   * The designs a turn showed, one card each, in order. `older` names the
   * designs a later card for the same design follows (decision 19).
   */
  | { kind: 'design_cards'; id: string; designIds: string[]; older: string[] }
  /** What a turn's orchestrator tools did to features: one row per feature. */
  | {
      kind: 'features_card'
      id: string
      rows: { featureId: string; title: string; actions: FeatureAction[]; quote?: string; into?: string }[]
    }
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

/** A row of a thread list: the sidebar's, under the open feature or the Orchestrator. */
export interface ThreadEntry {
  id: string
  title: string
  /** What kind of thread: the feature's main chat, a side thread, a scenario chat, a project chat. */
  role: 'main' | 'side' | 'scenario' | 'project'
  state: ThreadState
  /** When it was started: the sidebar's order, which an agent posting never changes. */
  createdAt: number
  /** When it last moved, for "4m", "2d". */
  updatedAt: number
  /** When the human last wrote in it; absent when they never did, or it has no log. */
  lastHumanAt?: number
  runtime: 'claude-code' | 'codex'
  /** A conversation from before threads had logs: it reads back as plain turns until it is continued. */
  readOnlyTranscript?: boolean
}

/** Prompts runcastle sends wear this; the fold shows them as runcastle's line, not the human's bubble. */
export const EMPTY_THREAD_VIEW: ThreadView = { items: [], state: 'idle', plan: [], tasks: [], commands: [], process: 'stopped', cursor: -1 }

/** When the human last wrote in a thread, rewound words aside; undefined when they never did. */
export function lastHumanAt(events: readonly ThreadEvent[]): number | undefined {
  return liveEvents(events).findLast((e) => e.type === 'prompt' && e.source === 'human' && !e.hidden)?.at
}

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

/**
 * How long after its turn ended a thread's background work keeps it reading as
 * working (threads-open-fast decision 2). Nothing reported tells a test run the
 * agent waits for from a dev server it left up, and a false "working" hides a
 * question, so past this the thread waits on the human whatever still runs.
 */
export const BACKGROUND_WINDOW_MS = 10 * 60_000

/** A message that ends on a question, closing marks after it aside, in any script's question mark. */
const ENDS_ASKING = /[?？؟][\s*_`'"”’)\]]*$/

/** What a thread is doing, read off its log. */
export type ThreadActivity =
  /** The agent asks something and waits for the answer. */
  | 'asking'
  /** A turn runs. */
  | 'turn'
  /** It replied, and background work it started still runs: the human is not being waited on yet. */
  | 'background'
  /** It replied and the next move is the human's. */
  | 'replied'
  | 'idle'

/**
 * What a thread is doing (decision 15). It waits on the human when the agent asks
 * something while its process runs, or its turn ended after the last message it
 * was sent and nothing has been sent since — whoever sent that message, a wake
 * included, and whether or not its process is still up. A turn the human stopped
 * is no reply, nor is one a stopped process cut off, nor one a hidden command ran.
 *
 * A reply with background work still running is not waiting yet
 * (threads-open-fast decisions 1 to 3), unless it ends on a question, the work is
 * no longer running with its process, or {@link BACKGROUND_WINDOW_MS} has passed
 * since the turn ended. The chat's own `foldThread` state knows none of this: the
 * turn is over, and the composer treats it so.
 */
export function threadActivity(events: readonly ThreadEvent[], running: boolean, now: number): ThreadActivity {
  let answering = false
  let replied = false
  let asking = false
  let inTurn = false
  let background = 0
  let endedAt = 0
  let lastSaid = ''
  let lastMessage: string | undefined
  for (const e of liveEvents(events)) {
    if (e.type === 'prompt') {
      answering = !e.hidden
      replied = false
    } else if (e.type === 'turn_started') {
      if (e.source === 'agent') answering = true
      replied = false
      inTurn = true
      lastSaid = ''
      lastMessage = undefined
    } else if (e.type === 'turn_ended') {
      replied = answering && e.reason !== 'cancelled'
      inTurn = false
      endedAt = e.at
    } else if (e.type === 'agent_text') {
      lastSaid = e.messageId === lastMessage ? lastSaid + e.text : e.text
      lastMessage = e.messageId
    } else if (e.type === 'tasks') {
      background = e.tasks.length + (e.agents ?? 0)
    } else if (e.type === 'ask') {
      asking = true
    } else if (e.type === 'ask_resolved') {
      asking = false
    } else if (e.type === 'process' && e.state === 'stopped') {
      asking = false
      inTurn = false
      background = 0
    }
  }
  if (running && asking) return 'asking'
  if (inTurn) return 'turn'
  if (!replied) return 'idle'
  const stillWorking = running && background > 0 && now - endedAt < BACKGROUND_WINDOW_MS
  return stillWorking && !ENDS_ASKING.test(lastSaid.trimEnd()) ? 'background' : 'replied'
}

/** One piece of a turn, in arrival order, before it is split into work and answer. */
type Segment =
  | { kind: 'text'; id: string; text: string }
  | { kind: 'thought'; id: string; text: string; from: number; to: number }
  | { kind: 'tools'; id: string; calls: ToolCall[] }
  | { kind: 'subagent'; id: string; title: string; status: ToolStatus; calls: ToolCall[] }
  /** An ask answered or a file shown here: it shows nothing in the work, but words before it are no longer the turn's answer. */
  | { kind: 'answered' }

interface Turn {
  id: string
  startedAt: number
  segments: Segment[]
  /** Subagents by id, for routing their calls. A steered message's split keeps them: they run on across it. */
  subagents: Map<string, Extract<Segment, { kind: 'subagent' }>>
  /** Every call by id, wherever it sits, for updates. A split keeps them too. */
  calls: Map<string, ToolCall>
  model?: string
  /** Opened by a `turn_started`; one opened by output alone is no turn anything is known to be running. */
  started: boolean
}

const BLANK_CALL: Omit<ToolCall, 'id'> = { kind: 'other', title: '', status: 'pending' }

/**
 * Runcastle's tools that only talk to the human: calling one is no work, so it
 * does not end a turn's answer. Matched on the name after a runtime's prefix
 * (`mcp__runcastle__wait_for_you`, `runcastle.wait_for_you`).
 */
export const TALK_ONLY_TOOLS = ['wait_for_you', 'declare_ready', 'notify_human', 'show_file'] as const

const TALK_ONLY_TITLE = new RegExp(`(?:__|\\.)(?:${TALK_ONLY_TOOLS.join('|')})$`)

/** A run of calls that are all talk-only. */
const talksOnly = (seg: Segment): boolean => seg.kind === 'tools' && seg.calls.every((c) => TALK_ONLY_TITLE.test(c.title.trim()))

const joinWords = (segs: Array<Extract<Segment, { kind: 'text' }>>): string => (segs.length === 1 ? segs[0].text : segs.map((s) => s.text.trim()).join('\n\n'))

/**
 * The model (and effort, fast mode) the human last picked on the thread; null
 * when they never picked one. A model logged directly after its process came
 * up is the one that start ran on, never a pick, though an earlier host marked
 * some `picked` there.
 */
export function lastPickedModel(log: readonly ThreadEvent[]): Extract<ThreadEventBody, { type: 'model' }> | null {
  for (let n = log.length - 1; n >= 0; n--) {
    const e = log[n]
    const before = log[n - 1]
    if (e.type === 'model' && e.picked && !(before?.type === 'process' && before.state === 'running')) return e
  }
  return null
}

/**
 * Mark every plan card a later plan card follows, and every design a later card
 * for the same design follows (decision 19): walked newest first, so the newest
 * card for each stays unmarked.
 */
function markOlderCards(items: ThreadItem[]): void {
  let planSeen = false
  const designsSeen = new Set<string>()
  for (let n = items.length - 1; n >= 0; n--) {
    const item = items[n]
    if (item.kind === 'plan_card') {
      if (planSeen) item.older = true
      planSeen = true
    } else if (item.kind === 'design_cards') {
      const older = new Set<string>()
      for (let d = item.designIds.length - 1; d >= 0; d--) {
        const id = item.designIds[d]
        if (designsSeen.has(id)) older.add(id)
        designsSeen.add(id)
      }
      item.older = item.designIds.filter((id) => older.has(id))
    }
  }
}

/**
 * Fold a thread's log into what the web renders. Pure, total and deterministic:
 * unknown orderings (an update before its call, a turn end with no start) are
 * absorbed, never thrown on, because a log written by a crashed process still
 * has to open.
 *
 * The rules, each decided here and nowhere else:
 * - A turn's segments arrive in order (text, thinking, tool calls, subagents).
 *   Its answer (`agent`) is every word after its last piece of real work:
 *   calls that only talk to the human ({@link TALK_ONLY_TOOLS}) do not end it,
 *   show nothing there, and the words around them read as one answer.
 *   Everything before goes into one `work` item, live while the turn runs and
 *   folded to "Worked for …" once it ends. Live or settled, the split is the
 *   same, so streaming words show as the answer until real work turns them
 *   into narration.
 * - No question folds away: words in the work that end asking something leave
 *   it, and show as one `agent` item after the work and ahead of the answer,
 *   in the order written.
 * - One subagent, one card: a subagent an earlier turn showed makes no card
 *   here unless it says it is running again, and one never seen makes none
 *   from an untitled "finished". A relaunched adapter re-announces every past
 *   subagent that way as its first turn starts.
 * - A late update belongs to its row: a call or subagent from before a steered
 *   message updates where it sits, and adds nothing after the agent's words,
 *   so it cannot turn them from the answer into narration. An untitled update
 *   for a call of an earlier turn shows nothing.
 * - An ask mid-turn stays in its turn: an approval's call is the same row as
 *   the tool call it asks about (matched by id, the first title kept), and its
 *   answer's lines follow the turn's one work item, ahead of the answer.
 * - A prompt sent before the process ran shows `starting` until the process
 *   runs or a turn starts. A `hidden` prompt (a command) shows nothing.
 * - A thread is `working` only inside a turn a `turn_started` opened: words
 *   logged after a turn's end (with no turn around them) fold as settled.
 * - A turn's `feature_acted` events are one `features_card`, placed as a shown
 *   file is: a feature acted on twice is one row; a prompt or a new turn starts
 *   a new card. A prompt's `display` rides on its `user` item.
 * - A shown file sits after the turn's work and ahead of its final words, from
 *   the moment it is shown. Words before it are no longer the answer, as with
 *   an answered ask. A turn's files are one `shown` item, and a steered message
 *   starts another. Work that starts after a file still lands above it.
 * - A model divider appears only when the model changes after one was set; a
 *   compaction shows once however many times it is reported before the next
 *   prompt; a usage report without a cost keeps the last one, and a restarted
 *   process's cost adds to what the processes before it spent.
 * - The plan shows only while the thread is not idle; a suggestion clears on
 *   the next prompt.
 */
export function foldThread(log: readonly ThreadEvent[]): ThreadView {
  const events = liveEvents(log)
  const items: ThreadItem[] = []
  const view: ThreadView = { ...EMPTY_THREAD_VIEW, items, plan: [], tasks: [], commands: [] }
  view.cursor = log.length ? log[log.length - 1].i : -1

  let turn: Turn | null = null
  /** Every subagent and call the thread has shown, in any turn. */
  const shownSubagents = new Set<string>()
  const shownCalls = new Set<string>()
  let workIndex = -1
  let answerIndex = -1
  /** Where the open turn's questions asked mid-work sit; -1 until one shows. */
  let askedIndex = -1
  /** Where the open turn's `shown` item sits; -1 until it shows a file. */
  let shownIndex = -1
  let ask: Ask | undefined
  let startingPrompt: Extract<ThreadItem, { kind: 'user' }> | null = null
  /** A compaction was shown since the last prompt: the next one is the same compaction told twice. */
  let compactedSincePrompt = false
  /** The model in force before the divider now last in the items, so a quick run of picks folds into one. */
  let modelBeforeDivider: ThreadView['model'] = undefined
  /** The adapter reports cost per process: what earlier processes spent, and the current one's last report. */
  let carriedCost = 0
  let processCost: number | undefined
  let restartedSinceCost = false

  /** Re-render the open turn's work and answer items in place. */
  const render = (live: boolean, endedAt?: number) => {
    if (!turn) return
    const segs = turn.segments
    // The answer is the words after the last real work; talk-only calls among them show nothing.
    const boundary = segs.findLastIndex((s) => s.kind !== 'text' && !talksOnly(s))
    const isWords = (s: Segment): s is Extract<Segment, { kind: 'text' }> => s.kind === 'text' && !!s.text.trim()
    const answerWords = segs.slice(boundary + 1).filter(isWords)
    const work = segs.slice(0, boundary + 1)
    const asked = work.filter((s): s is Extract<Segment, { kind: 'text' }> => isWords(s) && ENDS_ASKING.test(s.text.trimEnd()))
    const steps: WorkStep[] = work
      .map((s): WorkStep | null => {
        switch (s.kind) {
          case 'text':
            return s.text.trim() && !asked.includes(s) ? { kind: 'narration', id: s.id, text: s.text } : null
          case 'thought':
            return { kind: 'thought', id: s.id, text: s.text, seconds: Math.max(1, Math.round((s.to - s.from) / 1000)) }
          // The segment itself, so a late update reaches a part a split settled.
          case 'tools':
          case 'subagent':
            return s
          case 'answered':
            return null
        }
      })
      .filter((s): s is WorkStep => s !== null)
    const seconds = Math.max(0, Math.round(((endedAt ?? turn.startedAt) - turn.startedAt) / 1000))
    const workItem: ThreadItem | null = steps.length ? { kind: 'work', id: `work:${turn.id}`, steps, seconds, ...(live ? { live } : {}) } : null
    const model = turn.model ? { model: turn.model } : {}
    const askedItem: ThreadItem | null = asked.length ? { kind: 'agent', id: `asked:${turn.id}`, text: joinWords(asked), ...model } : null
    const answerItem: ThreadItem | null = answerWords.length ? { kind: 'agent', id: answerWords[0].id, text: joinWords(answerWords), ...model } : null
    // Work, then the questions asked along the way, then the answer; each keeps its first-seen slot.
    const firstAfterWork = [askedIndex, shownIndex, answerIndex].filter((n) => n >= 0)
    workIndex = place(workIndex, workItem, firstAfterWork.length ? Math.min(...firstAfterWork) : items.length)
    askedIndex = place(askedIndex, askedItem, answerIndex >= 0 ? answerIndex : items.length)
    answerIndex = place(answerIndex, answerItem, items.length)
  }

  /** Put the open turn's item in its slot (inserting at `at` when it has none) or take it out; returns its new slot. */
  const place = (slot: number, item: ThreadItem | null, at: number): number => {
    if (item && slot >= 0) {
      items[slot] = item
      return slot
    }
    if (item) {
      items.splice(at, 0, item)
      shiftSlots(at, 1)
      return at
    }
    if (slot >= 0) {
      items.splice(slot, 1)
      shiftSlots(slot + 1, -1)
    }
    return -1
  }

  /** Move every open slot at or past `from` by `by`, after an item went in or out ahead of it. */
  const shiftSlots = (from: number, by: number) => {
    if (workIndex >= from) workIndex += by
    if (askedIndex >= from) askedIndex += by
    if (answerIndex >= from) answerIndex += by
    if (shownIndex >= from) shownIndex += by
  }

  const openTurn = (e: ThreadEvent): Turn => {
    if (!turn) {
      turn = { id: String(e.i), startedAt: e.at, segments: [], subagents: new Map(), calls: new Map(), model: view.model?.label, started: e.type === 'turn_started' }
      workIndex = -1
      answerIndex = -1
      askedIndex = -1
      shownIndex = -1
      view.turnStartedAt = e.at
    }
    return turn
  }

  const closeTurn = (e: ThreadEvent, reason: TurnEnd | 'restarted', files?: FileChange[], error?: string) => {
    if (turn) {
      for (const c of turn.calls.values()) if (c.status === 'in_progress' || c.status === 'pending') c.status = reason === 'end_turn' ? 'completed' : 'failed'
      for (const s of turn.subagents.values()) if (s.status === 'in_progress' || s.status === 'pending') s.status = reason === 'end_turn' ? 'completed' : 'failed'
      render(false, e.at)
    }
    if (files?.length) items.push({ kind: 'changes', id: `changes:${e.i}`, files })
    if (reason === 'cancelled') items.push({ kind: 'stopped', id: `stopped:${e.i}` })
    if (reason === 'restarted') items.push({ kind: 'notice', id: `notice:${e.i}`, text: RESTART_INTERRUPTED })
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
    shownIndex = -1
    ask = undefined
    view.turnStartedAt = undefined
  }

  /**
   * Something the human did mid-turn (a steered message, a command) sits
   * between what the agent did before it and what it does after: settle the
   * part before, and start a fresh work/answer pair after it in the same turn.
   */
  const splitTurn = (e: ThreadEvent) => {
    if (!turn) return
    render(false, e.at)
    turn.id = String(e.i)
    turn.startedAt = e.at
    turn.segments = []
    workIndex = -1
    answerIndex = -1
    askedIndex = -1
    shownIndex = -1
  }

  /** A call first seen: under its subagent, else in the turn's run of tool calls. */
  const addCall = (t: Turn, e: ThreadEvent, call: ToolCall, parentId?: string) => {
    t.calls.set(call.id, call)
    shownCalls.add(call.id)
    const parent = parentId ? t.subagents.get(parentId) : undefined
    if (parent) parent.calls.push(call)
    else {
      const lastSeg = t.segments[t.segments.length - 1]
      if (lastSeg?.kind === 'tools') lastSeg.calls.push(call)
      else t.segments.push({ kind: 'tools', id: `tools:${e.i}`, calls: [call] })
    }
  }

  /** A card a turn posts (a review package, the plan, designs): placed as a shown file is, the turn's work above it, its final words below. */
  const placeCard = (item: ThreadItem) => {
    const open = turn as Turn | null
    if (open) {
      open.segments.push({ kind: 'answered' })
      render(true)
    }
    items.push(item)
    if (open) shownIndex = items.length - 1
  }

  const featureRow = (e: Extract<ThreadEvent, { type: 'feature_acted' }>) => ({
    featureId: e.featureId,
    title: e.title,
    actions: [e.action],
    ...(e.quote ? { quote: e.quote } : {}),
    ...(e.into ? { into: e.into } : {}),
  })

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
          ...(e.display ? { display: e.display, at: e.at } : {}),
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
          askedIndex = -1
        }
        items.push(item)
        view.suggestion = undefined
        break
      }
      case 'process':
        view.process = e.state
        if (e.state !== 'running') restartedSinceCost = true
        if (e.state !== 'starting' && startingPrompt) {
          delete startingPrompt.starting
          startingPrompt = null
        }
        if (e.state === 'stopped') {
          if (turn) closeTurn(e, e.error ? 'error' : e.restarted ? 'restarted' : 'cancelled', undefined, e.error)
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
        if (!e.call.title && shownCalls.has(e.call.id) && !(turn as Turn | null)?.calls.has(e.call.id)) break
        const t = openTurn(e)
        const known = t.calls.get(e.call.id)
        if (known) {
          Object.assign(known, Object.fromEntries(Object.entries(e.call).filter(([, v]) => v !== undefined && v !== '')))
        } else addCall(t, e, { ...BLANK_CALL, ...(e.call as Partial<ToolCall>), id: e.call.id }, e.parentId)
        if (e.outputAppend) {
          const call = t.calls.get(e.call.id)!
          call.output = (call.output ?? '') + e.outputAppend
        }
        render(true)
        break
      }
      case 'subagent': {
        const known = (turn as Turn | null)?.subagents.get(e.id)
        if (known) {
          if (e.title !== undefined) known.title = e.title
          if (e.status !== undefined) known.status = e.status
        } else {
          const running = e.status === 'in_progress' || e.status === 'pending'
          if (!running && (shownSubagents.has(e.id) || !e.title)) break
          const t = openTurn(e)
          const seg: Extract<Segment, { kind: 'subagent' }> = { kind: 'subagent', id: e.id, title: e.title ?? 'Subagent', status: e.status ?? 'in_progress', calls: [] }
          shownSubagents.add(e.id)
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
      case 'ask': {
        ask = e.ask
        if (e.ask.kind !== 'approval') break
        // The call an approval asks about is the turn's row for it, whichever arrived first.
        const t = openTurn(e)
        const known = t.calls.get(e.ask.call.id)
        if (!known) addCall(t, e, { ...e.ask.call })
        else if (!known.title) known.title = e.ask.call.title
        render(true)
        break
      }
      case 'ask_resolved': {
        const answered = ask?.id === e.id ? ask : undefined
        if (answered) ask = undefined
        // An answer is part of its turn: the work stays one fold, the answer's lines follow it.
        if (turn) {
          const t: Turn = turn
          if (answered?.kind === 'approval' && e.lines.some((l) => l.denied)) {
            const call = t.calls.get(answered.call.id)
            if (call && (call.status === 'pending' || call.status === 'in_progress')) call.status = 'failed'
          }
          t.segments.push({ kind: 'answered' })
          render(true)
        }
        e.lines.forEach((l, n) =>
          items.push({ kind: 'answered', id: `answered:${e.i}:${n}`, what: l.what, answer: l.answer, ...(l.denied ? { denied: true } : {}) }),
        )
        break
      }
      case 'usage': {
        // The thread's cost so far only grows: a report without it (one after a compaction) keeps the last,
        // and a restarted process counting from zero again adds to what the one before it spent.
        if (e.context.costUsd !== undefined) {
          if (restartedSinceCost && processCost !== undefined && e.context.costUsd < processCost) carriedCost += processCost
          processCost = e.context.costUsd
          restartedSinceCost = false
        }
        const costUsd = processCost !== undefined ? carriedCost + processCost : undefined
        view.context = { ...e.context, ...(costUsd !== undefined ? { costUsd } : {}) }
        break
      }
      case 'model': {
        // Picks made with nothing said between them are one change: the divider
        // compares against the model before the first of them.
        const stacked = items.at(-1)?.kind === 'model'
        if (stacked) items.pop()
        const before = stacked ? modelBeforeDivider : view.model
        if (!stacked) modelBeforeDivider = view.model
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
      case 'file_shown': {
        const open = turn as Turn | null
        if (open) {
          open.segments.push({ kind: 'answered' })
          render(true)
        }
        const group = shownIndex >= 0 ? items[shownIndex] : undefined
        if (group?.kind === 'shown') group.files.push(e.file)
        else {
          items.push({ kind: 'shown', id: `shown:${e.i}`, files: [e.file] })
          if (open) shownIndex = items.length - 1
        }
        break
      }
      case 'review_package':
        placeCard({ kind: 'review_package', id: `review_package:${e.i}`, ticketId: e.ticketId })
        break
      case 'plan_shown':
        placeCard({ kind: 'plan_card', id: `plan_card:${e.i}` })
        break
      case 'design_shown': {
        // Designs shown one after another in a turn are one group of cards, as shown files are.
        const group = turn && shownIndex >= 0 ? items[shownIndex] : undefined
        if (group?.kind === 'design_cards') {
          const open = turn as Turn | null
          open?.segments.push({ kind: 'answered' })
          render(true)
          group.designIds.push(e.designId)
        } else placeCard({ kind: 'design_cards', id: `design_cards:${e.i}`, designIds: [e.designId], older: [] })
        break
      }
      case 'feature_acted': {
        // Actions one after another in a turn are one card; a feature acted on twice is one row.
        const card = turn && shownIndex >= 0 ? items[shownIndex] : undefined
        if (card?.kind === 'features_card') {
          const open = turn as Turn | null
          open?.segments.push({ kind: 'answered' })
          render(true)
          const row = card.rows.find((r) => r.featureId === e.featureId)
          if (row) {
            row.actions.push(e.action)
            if (e.quote) row.quote = e.quote
            if (e.into) row.into = e.into
          } else card.rows.push(featureRow(e))
        } else placeCard({ kind: 'features_card', id: `features_card:${e.i}`, rows: [featureRow(e)] })
        break
      }
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
      case 'branched':
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
  markOlderCards(items)
  view.ask = ask
  view.state = ask ? 'waiting' : turn ? 'working' : 'idle'
  if (view.state === 'idle') view.plan = []
  return view
}
