import type { SessionRow } from '@runcastle/core'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import * as z from 'zod'
import type { AppCtx } from '../db/types'
import { InvalidInputError } from '../errors'
import { deliverToLead } from '../services/lead-delivery'
import { chatName } from '../threads/chat-name'
import { capTurns, capTurnsCounted, mainChatTurns } from '../services/main-chat-excerpt'
import { shownCopies, type ShownCopy } from '../threads/shown'
import { reviewShots, type ReviewShots } from '../services/review-package'
import {
  noSession,
  ok,
  orchestratorTool,
  recordFeatureAction,
  requireActableFeature,
  requireProjectFeature,
  type ResolveSession,
} from './orchestrator-tools'
import { chatReadPosition, recordChatRead } from './sent-memory'

/**
 * The orchestrator's tool that talks to a feature (`whole-cuts-plan-themselves`,
 * `the-feature-lead-runs-rounds` decision 11): a message to its lead.
 */

/** The line a message from the epic opens with (`epics-on-autopilot` decision 22). */
export function fromEpicLine(epicName: string): string {
  return `From ${epicName}, the project's orchestrator, not the human:`
}

/** The line a relay of the human's own answer opens with (decision 25): the lead takes it as the human's. */
export function relayLine(epicName: string): string {
  return `From ${epicName}, the project's orchestrator, relaying the human's own words (take them as the human's):`
}

/** What `send_to_feature` did with the message. */
export type SendToFeatureResult = { deliveredToLead: true }

/**
 * Send a message to a feature on autopilot in this epic. Every chat on a
 * feature is its lead, so the message reaches it as the human's would — drive
 * notes, an answer — and counts as a human message, which clears a Stop. It
 * opens with the epic's name. `humanWords` relays the human's own answer,
 * quoted as they wrote it and marked as theirs (decision 25), ahead of any
 * message of the epic's own.
 */
export async function toolSendToFeature(
  ctx: AppCtx,
  session: SessionRow,
  input: { slug: string; message?: string; humanWords?: string },
): Promise<SendToFeatureResult> {
  const feature = requireActableFeature(ctx, session, input.slug, 'message')
  const message = input.message?.trim() ?? ''
  const human = input.humanWords?.trim() ?? ''
  if (!message && !human) throw new InvalidInputError('send_to_feature needs a `message`, or the human’s own words in `humanWords`.')
  const epic = chatName(session)
  const parts = [
    ...(human ? [`${relayLine(epic)}\n\n${human.split(/\r?\n/).map((l) => `> ${l}`).join('\n')}`] : []),
    ...(message ? [`${fromEpicLine(epic)}\n\n${message}`] : []),
  ]
  const shown = [human ? `The human: ${human}` : '', message].filter(Boolean).join('\n\n')
  await deliverToLead(ctx, feature, {
    text: parts.join('\n\n'),
    source: 'human',
    orchestrator: { text: shown },
  })
  recordFeatureAction(ctx, session, feature.id, 'messaged', { quote: firstLine(message || human) })
  return { deliveredToLead: true }
}

/** The first non-empty line of `message`, clipped for a card row. */
function firstLine(message: string): string {
  const line = message.split(/\r?\n/).find((l) => l.trim() !== '')?.trim() ?? ''
  return line.length > QUOTE_MAX ? `${line.slice(0, QUOTE_MAX - 1)}…` : line
}

const QUOTE_MAX = 120

/** What `read_feature_chat` returns: the chat's recent turns, or why there are none. */
export type ReadFeatureChatResult = {
  slug: string
  quote: string | null
  transcriptPath: string | null
  reason?: string
  /**
   * On a read that continues this thread's last one: how many of the turns new
   * since then the quote left out to fit, oldest first.
   */
  earlierNewTurnsOmitted?: number
  /** The files the chat showed, newest last; each `path` is a copy `show_file` can show again. */
  shown: ShownCopy[]
  /** The pictures this feature's reviews kept, newest pass first; each `path` works with show_file. */
  reviewShots: ReviewShots[]
}

const NOTHING_NEW = 'nothing new since your last read'

/** Every shot of `passes`, oldest pass first, so later shots always land at the end. */
function shotCount(passes: ReviewShots[]): number {
  return passes.reduce((sum, pass) => sum + pass.shots.length, 0)
}

/** The shots past the first `seen` (counted oldest pass first), regrouped newest pass first. */
function shotsAfter(passes: ReviewShots[], seen: number): ReviewShots[] {
  if (seen > shotCount(passes)) return passes
  let skip = seen
  const fresh: ReviewShots[] = []
  for (const pass of [...passes].reverse()) {
    const shots = pass.shots.slice(skip)
    skip = Math.max(0, skip - pass.shots.length)
    if (shots.length > 0) fresh.unshift({ ...pass, shots })
  }
  return fresh
}

/**
 * The last turns of a feature's main chat, for reading what its agent said or
 * asked. A repeat read by the same thread of the same transcript returns only
 * what was added since (`tools-and-skills-say-less` decision 6); `full` or a
 * different transcript reads as the first time did.
 */
export function toolReadFeatureChat(
  ctx: AppCtx,
  session: SessionRow,
  input: { slug: string; full?: boolean },
): ReadFeatureChatResult {
  const feature = requireProjectFeature(ctx, session, input.slug)
  const { turns, transcriptPath } = mainChatTurns(ctx, feature)
  const shown = shownCopies(ctx, feature.id)
  const shots = reviewShots(ctx, feature.id)
  const last = chatReadPosition(session.id, feature.id)
  if (transcriptPath) {
    recordChatRead(session.id, feature.id, {
      transcriptPath,
      turnCount: turns.length,
      shownCount: shown.length,
      reviewShotCount: shotCount(shots),
    })
  }

  // A transcript that shrank under the same path (rewritten, or its turns
  // reparsed fewer) has no "since" to count from: read it as the first time.
  const sameChat = last !== undefined && transcriptPath === last.transcriptPath && turns.length >= last.turnCount
  if (!input.full && last && sameChat) {
    const { quote, omitted } = capTurnsCounted(turns.slice(last.turnCount))
    const newShown = shown.slice(last.shownCount)
    const newShots = shotsAfter(shots, last.reviewShotCount)
    const nothingNew = quote === null && newShown.length === 0 && newShots.length === 0
    return {
      slug: feature.slug,
      quote,
      transcriptPath,
      ...(nothingNew ? { reason: NOTHING_NEW } : {}),
      earlierNewTurnsOmitted: omitted,
      shown: newShown,
      reviewShots: newShots,
    }
  }

  const quote = capTurns(turns)
  return {
    slug: feature.slug,
    quote,
    transcriptPath: quote ? transcriptPath : null,
    ...(quote === null ? { reason: 'no chat on disk yet' } : {}),
    shown,
    reviewShots: shots,
  }
}

export function registerOrchestratorRunTools(
  server: McpServer,
  wants: (tool: string) => boolean,
  resolve: ResolveSession,
): void {
  if (wants('send_to_feature')) {
    server.registerTool(
      'send_to_feature',
      {
        title: 'Send a feature a message',
        description:
          "Send a message to the agent of a feature on autopilot in this epic, marked as from this epic, not the human. " +
          'To pass on the human’s own answer, put their words verbatim in `humanWords`: it is marked as theirs. ' +
          'Refused on a feature that is the human’s: link them to its chat instead.',
        inputSchema: {
          slug: z.string().describe('The slug of the feature.'),
          message: z.string().optional().describe('Your own words: what to change and why, or what you found.'),
          humanWords: z
            .string()
            .optional()
            .describe('The human’s own answer, exactly as they wrote it here. Never your paraphrase.'),
        },
      },
      orchestratorTool(async (args, extra) => {
        const rs = await resolve(extra)
        if (!rs) return noSession()
        return ok(await toolSendToFeature(rs.ctx, rs.session, args))
      }),
    )
  }

  if (wants('read_feature_chat')) {
    server.registerTool(
      'read_feature_chat',
      {
        title: 'Read a feature’s chat',
        description:
          "The last turns of a feature's chat, plus the files it `shown` and its `reviewShots`. " +
          'A repeat read returns only what is new; `full: true` returns the last turns again.',
        inputSchema: {
          slug: z.string().describe('The slug of the feature.'),
          full: z.boolean().optional().describe('Return the last turns, not only what is new.'),
        },
      },
      orchestratorTool(async (args, extra) => {
        const rs = await resolve(extra)
        if (!rs) return noSession()
        return ok(toolReadFeatureChat(rs.ctx, rs.session, args))
      }),
    )
  }
}
