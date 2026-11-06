import type { SessionRow } from '@runcastle/core'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import * as z from 'zod'
import type { AppCtx } from '../db/types'
import { deliverToLead } from '../services/lead-delivery'
import { capTurns, capTurnsCounted, mainChatTurns } from '../services/main-chat-excerpt'
import { shownCopies, type ShownCopy } from '../threads/shown'
import { reviewShots, type ReviewShots } from '../services/review-package'
import {
  noSession,
  ok,
  orchestratorTool,
  recordFeatureAction,
  requireHeldFeature,
  requireProjectFeature,
  type ResolveSession,
} from './orchestrator-tools'
import { chatReadPosition, recordChatRead } from './sent-memory'

/**
 * The orchestrator's tool that talks to a feature (`whole-cuts-plan-themselves`,
 * `the-feature-lead-runs-rounds` decision 11): a message to its lead.
 */

const FROM_ORCHESTRATOR_LINE = "From the project's orchestrator, not the human:"
const RELAYED_HUMAN_LINE = "The human's own answer, relayed by the project's orchestrator:"

/** What `send_to_feature` did with the message. */
export type SendToFeatureResult = { deliveredToLead: true }

/**
 * Send a message to a feature of the project. Every chat on a feature is its lead, so
 * the message reaches it as the human's would — drive notes, an answer — and
 * counts as a human message, which clears a Stop.
 */
export async function toolSendToFeature(
  ctx: AppCtx,
  session: SessionRow,
  input: { slug: string; message: string; relaysHuman?: boolean },
): Promise<SendToFeatureResult> {
  const feature = requireHeldFeature(ctx, session, input.slug)
  const from = input.relaysHuman ? RELAYED_HUMAN_LINE : FROM_ORCHESTRATOR_LINE
  const relayed = input.relaysHuman === true
  await deliverToLead(ctx, feature, {
    text: `${from}\n\n${input.message}`,
    source: 'human',
    orchestrator: { text: input.message, relayed },
  })
  recordFeatureAction(ctx, session, feature.id, relayed ? 'relayed' : 'messaged', { quote: firstLine(input.message) })
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

  if (!input.full && last && transcriptPath === last.transcriptPath) {
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
          "Send a message to a feature's agent, marked as from the orchestrator. Set relaysHuman " +
          "only for the human's own answer passed on as they gave it.",
        inputSchema: {
          slug: z.string().describe('The slug of the feature.'),
          message: z.string().min(1).describe('What to change and why, or what you found.'),
          relaysHuman: z
            .boolean()
            .optional()
            .describe("True when the message is the human's own answer, relayed."),
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
