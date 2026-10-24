import type { SessionRow } from '@runcastle/core'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import * as z from 'zod'
import type { AppCtx } from '../db/types'
import { deliverToLead } from '../services/lead-delivery'
import {
  noSession,
  ok,
  orchestratorTool,
  requireOrchestratedFeature,
  type ResolveSession,
} from './orchestrator-tools'

/**
 * The orchestrator's tool that talks to a feature (`whole-cuts-plan-themselves`,
 * `the-feature-lead-runs-rounds` decision 11): a message to its lead.
 */

/** What `send_to_feature` did with the message. */
export type SendToFeatureResult = { deliveredToLead: true }

/**
 * Send a message to an owned feature. Every chat on a feature is its lead, so
 * the message reaches it as the human's would — drive notes, an answer — and
 * counts as a human message, which clears a Stop.
 */
export async function toolSendToFeature(
  ctx: AppCtx,
  session: SessionRow,
  input: { slug: string; message: string },
): Promise<SendToFeatureResult> {
  const feature = requireOrchestratedFeature(ctx, session, input.slug)
  await deliverToLead(ctx, feature, { text: input.message, source: 'human' })
  return { deliveredToLead: true }
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
          "Send a message to one of your features. It reaches the feature's agent as the human's " +
          "message — a plan sent back with the change you want and why, drive notes, the human's " +
          'answer relayed as theirs — which lets it dispatch again after a Stop. Orchestrator only.',
        inputSchema: {
          slug: z.string().describe('The slug of the feature.'),
          message: z
            .string()
            .min(1)
            .describe(
              "What to change and why, or what you found. Say so plainly when it relays the human's own answer.",
            ),
        },
      },
      orchestratorTool(async (args, extra) => {
        const rs = await resolve(extra)
        if (!rs) return noSession()
        return ok(await toolSendToFeature(rs.ctx, rs.session, args))
      }),
    )
  }
}
