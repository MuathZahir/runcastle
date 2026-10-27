import type { AskAnswer, Effort, ThreadModels, UsageReport } from '@runcastle/core'
import type { AppCtx } from '../db/types'
import { processAgentHost } from './host'

/**
 * The agent host and the thread log (chat-as-web-components; ADR-0015) — the
 * contract the round's tickets build against. A thread is a session row of a
 * conversation kind; its id IS the session row id. The host owns every running
 * agent connection (one ACP adapter child process per running thread); the log
 * is the thread's append-only record, folded by core's `foldThread`.
 */

/** An image sent with a prompt, as the web uploads it. */
export interface PromptImage {
  name: string
  mimeType: string
  /** Base64, no `data:` prefix. */
  data: string
}

export interface PromptInput {
  text: string
  images?: PromptImage[]
}

export interface PromptOptions {
  /**
   * `human`: sent now — into the running turn when one runs (steering).
   * `runcastle`: queued to the end of a running turn (a kickoff, a lead wake,
   * an orchestrator line, a kickoff override), sent at once otherwise.
   */
  source: 'human' | 'runcastle'
  /** The model, effort and fast mode for this message, when they differ from the thread's. */
  model?: string
  effort?: Effort
  fast?: boolean
}

/** Why a thread's process stops. None of them is shown to the human as "ended". */
export type StopReason = 'idle' | 'shutdown' | 'archived' | 'crashed'

export interface AgentHost {
  /**
   * Send a prompt, starting the thread's agent first when none runs
   * (`session/load` when the row has an agent conversation id, `session/new`
   * otherwise). Resolves once the prompt is logged and sent or queued — never
   * when the turn ends. The returned id is the logged `prompt` event's id.
   */
  prompt(threadId: string, input: PromptInput, opts: PromptOptions): Promise<{ promptId: string }>
  /** Stop the running turn (`session/cancel`). A no-op on an idle thread. */
  cancel(threadId: string): Promise<void>
  /** Answer the thread's open ask. Refuses an ask id that is not the open one. */
  answer(threadId: string, askId: string, answer: AskAnswer): Promise<void>
  /** Stop the thread's process, if one runs. Its log and row stay. */
  stop(threadId: string, reason: StopReason): Promise<void>
  /** Stop every process (server shutdown). */
  stopAll(reason: StopReason): Promise<void>
  isRunning(threadId: string): boolean

  // ---- controls (ticket 5) ----

  /** Set the model, effort and fast mode the next turns run on (ACP session config options). */
  setConfig(threadId: string, config: { model?: string; effort?: Effort; fast?: boolean }): Promise<void>
  /**
   * Go back to just before the prompt `atPromptId`. `into: 'same'` rewinds this
   * thread (logs `rewound`; with `undoFiles` on Claude, restores the files from
   * Claude Code's checkpoints first). `into: 'new'` branches a new side thread
   * carrying the conversation up to there, and returns its id.
   */
  fork(threadId: string, atPromptId: string, opts: { into: 'same' | 'new'; undoFiles?: boolean }): Promise<{ threadId: string }>
  /** The account's usage limits and plan, from the runtime's adapter. */
  usage(threadId: string): Promise<UsageReport>
  /** The models the thread's runtime offers, the same list whether or not its agent runs, and the one it is on; starts nothing. */
  models(threadId: string): ThreadModels
  /**
   * Compact the conversation: the runtime's compaction command, sent as a
   * hidden runcastle prompt (starting the agent when none runs); the adapter's
   * compaction update is the thread's divider. Refused while the agent works.
   */
  compact(threadId: string): Promise<void>
}

/** The process-wide host (see `host.ts`). */
export function agentHost(ctx: AppCtx): AgentHost {
  return processAgentHost(ctx)
}

/**
 * Append one event to a thread's log and publish `{ kind: 'thread', threadId }`
 * on the live bus. Assigns the next index and the timestamp; streaming chunks
 * of one message are coalesced (see `log.ts`).
 */
export { appendThreadEvent } from './log'

/** A thread's log, every event with an index greater than `after` (all when omitted). */
export { readThreadEvents } from './log'
