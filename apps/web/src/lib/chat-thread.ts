/**
 * What a chat thread shows, as the web reads it (chat-as-web-components
 * decisions 2, 4, 7): the server turns the agent's ACP session updates into
 * these items and keeps them in its own log, so a thread renders the same from
 * the log as it does live.
 *
 * Tool calls carry ACP's own `kind` and `status` words, so the mapping from the
 * protocol is a rename, not a translation.
 */

/** ACP's `ToolKind`: what a tool call does, which picks its glyph and verb. */
export type ToolKind = 'read' | 'edit' | 'delete' | 'move' | 'search' | 'execute' | 'think' | 'fetch' | 'other'

/** ACP's `ToolCallStatus`. */
export type ToolStatus = 'pending' | 'in_progress' | 'completed' | 'failed'

/** One line of a file change, as the tool call's diff carries it. */
export interface DiffLine {
  op: ' ' | '+' | '-'
  text: string
}

export interface ToolCall {
  id: string
  kind: ToolKind
  /** What the call did, short: a path, a command, a query. */
  title: string
  status: ToolStatus
  /** What it printed, for an `execute` or a failure. */
  output?: string
  diff?: { path: string; lines: DiffLine[] }
}

/** One file a turn changed, for the turn's changes card. */
export interface FileChange {
  path: string
  added: number
  removed: number
  lines: DiffLine[]
}

/** An image the human attached: a Select area crop, a paste or a drop. */
export interface Attachment {
  id: string
  /** Something an `<img>` can show. */
  src: string
  name: string
}

/** One option of the agent's multiple-choice question. */
export interface QuestionOption {
  label: string
  description?: string
}

export interface Question {
  header: string
  question: string
  options: QuestionOption[]
  multiSelect?: boolean
}

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
  /** The model changed between two messages. */
  | { kind: 'model'; id: string; model: string }

/** Where a thread is, which is all the human is told about its process. */
export type ThreadState = 'working' | 'waiting' | 'idle'

/** What the agent waits on the human for, docked where the composer is. */
export type Ask =
  | { kind: 'approval'; id: string; call: ToolCall }
  | { kind: 'question'; id: string; questions: Question[] }

/** A slash command the agent offers, from the adapter's command list. */
export interface SlashCommand {
  name: string
  description: string
}

/** The agent's own task list for the turn (ACP plan updates). */
export interface PlanEntry {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
}

/** A command the agent left running in the background. */
export interface BackgroundTask {
  id: string
  title: string
  seconds: number
}

/** A model the thread's runtime offers, from the adapter's config options. */
export interface ModelChoice {
  id: string
  label: string
  note?: string
}

/** How hard the model thinks; the runtime's own levels. */
export type Effort = 'low' | 'medium' | 'high' | 'max'

/** How full the context window is, from ACP's usage updates. */
export interface ContextUsage {
  used: number
  size: number
  /** Cost of this thread so far, when the runtime reports it. */
  costUsd?: number
}

/** One subscription limit (Claude's 5-hour and weekly windows, Codex's rate limits). */
export interface UsageLimit {
  label: string
  /** 0–100. */
  percent: number
  resets: string
}

/** A row of the thread list in the header's switcher. */
export interface ThreadEntry {
  id: string
  title: string
  /** What kind of thread: the feature's main chat, a side thread, a scenario chat. */
  role: 'main' | 'side' | 'scenario'
  state: ThreadState
  /** When it last moved, for "4m", "2d". */
  updatedAt: number
}
