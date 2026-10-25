import type { SessionRow } from '@runcastle/core'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import * as z from 'zod'
import type { AppCtx } from '../db/types'
import { deliverToLead } from '../services/lead-delivery'
import { mainChatExcerpt } from '../services/main-chat-excerpt'
import {
  noSession,
  ok,
  orchestratorTool,
  requireProjectFeature,
  type ResolveSession,
} from './orchestrator-tools'

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
  const feature = requireProjectFeature(ctx, session, input.slug)
  const from = input.relaysHuman ? RELAYED_HUMAN_LINE : FROM_ORCHESTRATOR_LINE
  await deliverToLead(ctx, feature, { text: `${from}\n\n${input.message}`, source: 'human' })
  return { deliveredToLead: true }
}

/** What `read_feature_chat` returns: the chat's recent turns, or why there are none. */
export type ReadFeatureChatResult = {
  slug: string
  quote: string | null
  transcriptPath: string | null
  reason?: string
}

/** The last turns of a feature's main chat, for reading what its agent said or asked. */
export function toolReadFeatureChat(
  ctx: AppCtx,
  session: SessionRow,
  input: { slug: string },
): ReadFeatureChatResult {
  const feature = requireProjectFeature(ctx, session, input.slug)
  const { quote, transcriptPath } = mainChatExcerpt(ctx, feature)
  return {
    slug: feature.slug,
    quote,
    transcriptPath,
    ...(quote === null ? { reason: 'no chat on disk yet' } : {}),
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
          "Send a message to a feature's agent. It arrives marked as from the project's " +
          'orchestrator, not the human, and still counts as a human message: it lets the agent ' +
          'start a round again after a Stop. Set relaysHuman only when the message is the ' +
          "human's own answer, passed on as they gave it; then it arrives marked as theirs, relayed.",
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
          "The last turns of a feature's chat, for reading what its agent said or asked. " +
          'Returns the quote and the transcript path; the quote is null, with a reason, when ' +
          'the feature has no chat on disk yet.',
        inputSchema: { slug: z.string().describe('The slug of the feature.') },
      },
      orchestratorTool(async (args, extra) => {
        const rs = await resolve(extra)
        if (!rs) return noSession()
        return ok(toolReadFeatureChat(rs.ctx, rs.session, args))
      }),
    )
  }
}
