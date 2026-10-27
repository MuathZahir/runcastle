import { AskAnswer, Effort, type ModelChoice, type ThreadEntry, type ThreadEvent, type ThreadView, type UsageReport } from '@runcastle/core'
import * as z from 'zod'
import { NotImplementedError } from '../../errors'
import { publicProcedure, router } from '../context'

/**
 * Threads (chat-as-web-components; ADR-0015): every agent conversation, read
 * from runcastle's own log and driven through the agent host. A thread id is
 * its session row id.
 *
 * This is the contract the round builds against: the inputs and outputs are
 * final, the bodies are sockets. Ticket 1 fills the reads, `send`, `stop`,
 * `answer` and `new` for a feature; ticket 4 fills `new` for a project; ticket
 * 5 fills the controls. Replace a body, never its shape — the web is built
 * against it in the same round.
 */

const todo = (ticket: string): never => {
  throw new NotImplementedError(`chat-as-web-components ticket ${ticket}`)
}

const threadId = z.object({ threadId: z.string() })

/** The feature's or the project's threads — exactly one of the two. */
const scope = z.union([z.object({ featureId: z.string() }), z.object({ projectId: z.string() })])

const image = z.object({
  name: z.string(),
  mimeType: z.string().regex(/^image\//),
  /** Base64, no `data:` prefix. */
  data: z.string().min(1),
})

export const threadRouter = router({
  /**
   * The header's thread list: every conversation thread of the feature (its
   * main chat, side threads, scenario and Fix-it chats) or of the project (its
   * chats, the preparation chat), finished ones included, newest first.
   * Terminal-era conversations are listed once per agent conversation, with
   * `readOnlyTranscript` until they are continued.
   */
  list: publicProcedure.input(scope).query((): ThreadEntry[] => todo('1')),

  /** A thread folded to what the column renders: the first paint, before `events` catches up. */
  view: publicProcedure.input(threadId).query((): ThreadView => todo('1')),

  /**
   * The thread's log after `after` (all of it when omitted). The web folds it
   * with core's `foldThread`; a `{ kind: 'thread', threadId }` live signal says
   * when to read again. A terminal-era thread with no log answers with its
   * transcript's turns as `prompt` and `agent_text` events.
   */
  events: publicProcedure
    .input(threadId.extend({ after: z.number().int().optional() }))
    .query((): { events: ThreadEvent[] } => todo('1')),

  /** Send the human's message. Starts the agent when none runs; joins a running turn. */
  send: publicProcedure
    .input(
      threadId.extend({
        text: z.string(),
        images: z.array(image).max(20).optional(),
        model: z.string().optional(),
        effort: Effort.optional(),
        fast: z.boolean().optional(),
      }),
    )
    .mutation((): { promptId: string } => todo('1')),

  /** Stop the running turn (Stop, Esc). */
  stop: publicProcedure.input(threadId).mutation((): { ok: true } => todo('1')),

  /** Answer the open approval or question. */
  answer: publicProcedure
    .input(threadId.extend({ askId: z.string(), answer: AskAnswer }))
    .mutation((): { ok: true } => todo('1')),

  /** New thread: a side thread on a feature (ticket 1), a fresh chat on a project (ticket 4). Nothing starts until its first message. */
  new: publicProcedure.input(scope).mutation((): { threadId: string } => todo('1')),

  // ---- controls (ticket 5) ----

  /** The models this thread's runtime offers, for the composer's picker. */
  models: publicProcedure.input(threadId).query((): ModelChoice[] => todo('5')),

  /** Change the model, effort and fast mode the next message runs on. */
  setModel: publicProcedure
    .input(threadId.extend({ model: z.string(), effort: Effort.optional(), fast: z.boolean().optional() }))
    .mutation((): { ok: true } => todo('5')),

  /** Rewind to just before `promptId` and send `text` in its place. `undoFiles` is honoured on Claude only. */
  edit: publicProcedure
    .input(threadId.extend({ promptId: z.string(), text: z.string().min(1), undoFiles: z.boolean().default(false) }))
    .mutation((): { promptId: string } => todo('5')),

  /** A new side thread carrying the conversation up to (and including) the turn of `promptId`. */
  branch: publicProcedure.input(threadId.extend({ promptId: z.string() })).mutation((): { threadId: string } => todo('5')),

  /** The account's usage limits and plan (the context meter's popover). */
  usage: publicProcedure.input(threadId).query((): UsageReport => todo('5')),

  /** The worktree's files for `@`, matching `query` (fuzzy), at most `limit`. */
  files: publicProcedure
    .input(threadId.extend({ query: z.string().default(''), limit: z.number().int().min(1).max(50).default(8) }))
    .query((): string[] => todo('5')),

  rename: publicProcedure.input(threadId.extend({ title: z.string().min(1).max(200) })).mutation((): { ok: true } => todo('5')),

  /** The thread as Markdown, for Copy / Save. */
  export: publicProcedure.input(threadId).query((): { markdown: string } => todo('5')),
})
