import { AskAnswer, Effort, type ModelChoice, type ThreadEntry, type ThreadEvent, type ThreadView, type UsageReport } from '@runcastle/core'
import * as z from 'zod'
import { createProjectThread, createSideThread, kickoffFor } from '../../launcher/launcher'
import { setSessionTitle } from '../../launcher/sessions'
import { getFeatureRow, requireProjectById } from '../../services/repo'
import { threadMarkdown } from '../../threads/controls'
import { matchWorktreeFiles } from '../../threads/files'
import { hasThreadLog } from '../../threads/log'
import { listThreads, threadEvents, threadRow, threadView } from '../../threads/read'
import { agentHost, appendThreadEvent } from '../../threads/types'
import { publicProcedure, router } from '../context'

/**
 * Threads (chat-as-web-components; ADR-0015): every agent conversation, read
 * from runcastle's own log and driven through the agent host. A thread id is
 * its session row id.
 */

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
  list: publicProcedure.input(scope).query(({ ctx, input }): ThreadEntry[] => listThreads(ctx, input)),

  /** A thread folded to what the column renders: the first paint, before `events` catches up. */
  view: publicProcedure.input(threadId).query(({ ctx, input }): ThreadView => threadView(ctx, input.threadId)),

  /**
   * The thread's log after `after` (all of it when omitted). The web folds it
   * with core's `foldThread`; a `{ kind: 'thread', threadId }` live signal says
   * when to read again. A terminal-era thread with no log answers with its
   * transcript's turns as `prompt` and `agent_text` events.
   */
  events: publicProcedure
    .input(threadId.extend({ after: z.number().int().optional() }))
    .query(({ ctx, input }): { events: ThreadEvent[] } => ({ events: threadEvents(ctx, input.threadId, input.after) })),

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
    .mutation(async ({ ctx, input }): Promise<{ promptId: string }> => {
      const { threadId: id, text, images, model, effort, fast } = input
      const row = threadRow(ctx, id)
      // A thread opened empty (New thread) is briefed ahead of the human's first
      // words, in the same prompt, so the agent answers once (decision 12).
      if (!row.ccSessionId && !hasThreadLog(id)) {
        await agentHost(ctx).prompt(id, { text: kickoffFor(ctx, row) }, { source: 'runcastle', hold: true })
      }
      return agentHost(ctx).prompt(
        id,
        { text, ...(images ? { images } : {}) },
        { source: 'human', ...(model ? { model } : {}), ...(effort ? { effort } : {}), ...(fast !== undefined ? { fast } : {}) },
      )
    }),

  /** Stop the running turn (Stop, Esc). */
  stop: publicProcedure.input(threadId).mutation(async ({ ctx, input }): Promise<{ ok: true }> => {
    threadRow(ctx, input.threadId)
    await agentHost(ctx).cancel(input.threadId)
    return { ok: true }
  }),

  /** Answer the open approval or question. */
  answer: publicProcedure
    .input(threadId.extend({ askId: z.string(), answer: AskAnswer }))
    .mutation(async ({ ctx, input }): Promise<{ ok: true }> => {
      threadRow(ctx, input.threadId)
      await agentHost(ctx).answer(input.threadId, input.askId, input.answer)
      return { ok: true }
    }),

  /** New thread: a side thread on a feature, a fresh chat on a project. Nothing starts until its first message. */
  new: publicProcedure.input(scope).mutation(async ({ ctx, input }): Promise<{ threadId: string }> => {
    const row =
      'featureId' in input
        ? await createSideThread(ctx, getFeatureRow(ctx, input.featureId))
        : await createProjectThread(ctx, requireProjectById(ctx, input.projectId))
    return { threadId: row.id }
  }),

  // ---- controls (ticket 5) ----

  /** The models this thread's runtime offers, for the composer's picker. */
  models: publicProcedure.input(threadId).query(({ ctx, input }): ModelChoice[] => {
    threadRow(ctx, input.threadId)
    return agentHost(ctx).models(input.threadId)
  }),

  /** Change the model, effort and fast mode the next message runs on. */
  setModel: publicProcedure
    .input(threadId.extend({ model: z.string(), effort: Effort.optional(), fast: z.boolean().optional() }))
    .mutation(async ({ ctx, input }): Promise<{ ok: true }> => {
      const { threadId: id, model, effort, fast } = input
      threadRow(ctx, id)
      await agentHost(ctx).setConfig(id, { model, ...(effort ? { effort } : {}), ...(fast !== undefined ? { fast } : {}) })
      return { ok: true }
    }),

  /** Rewind to just before `promptId` and send `text` in its place. `undoFiles` is honoured on Claude only. */
  edit: publicProcedure
    .input(threadId.extend({ promptId: z.string(), text: z.string().min(1), undoFiles: z.boolean().default(false) }))
    .mutation(async ({ ctx, input }): Promise<{ promptId: string }> => {
      threadRow(ctx, input.threadId)
      const host = agentHost(ctx)
      await host.fork(input.threadId, input.promptId, { into: 'same', undoFiles: input.undoFiles })
      return host.prompt(input.threadId, { text: input.text }, { source: 'human' })
    }),

  /** A new side thread carrying the conversation up to (and including) the turn of `promptId`. */
  branch: publicProcedure.input(threadId.extend({ promptId: z.string() })).mutation(({ ctx, input }): Promise<{ threadId: string }> => {
    threadRow(ctx, input.threadId)
    return agentHost(ctx).fork(input.threadId, input.promptId, { into: 'new' })
  }),

  /** Compact the conversation (the context meter's Compact now). Refused while a turn runs. */
  compact: publicProcedure.input(threadId).mutation(async ({ ctx, input }): Promise<{ ok: true }> => {
    threadRow(ctx, input.threadId)
    await agentHost(ctx).compact(input.threadId)
    return { ok: true }
  }),

  /** The account's usage limits and plan (the context meter's popover). */
  usage: publicProcedure.input(threadId).query(({ ctx, input }): Promise<UsageReport> => {
    threadRow(ctx, input.threadId)
    return agentHost(ctx).usage(input.threadId)
  }),

  /** The worktree's files for `@`, matching `query` (fuzzy), at most `limit`. */
  files: publicProcedure
    .input(threadId.extend({ query: z.string().default(''), limit: z.number().int().min(1).max(50).default(8) }))
    .query(({ ctx, input }): Promise<string[]> => matchWorktreeFiles(threadRow(ctx, input.threadId).worktreePath, input.query, input.limit)),

  rename: publicProcedure.input(threadId.extend({ title: z.string().min(1).max(200) })).mutation(({ ctx, input }): { ok: true } => {
    threadRow(ctx, input.threadId)
    setSessionTitle(ctx, input.threadId, input.title)
    appendThreadEvent(input.threadId, { type: 'title', title: input.title })
    return { ok: true }
  }),

  /** The thread as Markdown, for Copy / Save. */
  export: publicProcedure.input(threadId).query(({ ctx, input }): { markdown: string } => {
    const row = threadRow(ctx, input.threadId)
    const view = threadView(ctx, input.threadId)
    return { markdown: threadMarkdown(view, row.title ?? view.title ?? 'Thread') }
  }),
})
