import type { SessionRow } from '@runcastle/core'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import * as z from 'zod'
import type { AppCtx } from '../db/types'
import {
  launchSession,
  type LaunchSessionOptions,
  type LaunchSessionResult,
} from '../launcher/launcher'
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
 * `the-feature-lead-runs-rounds` decision 11): a message to its planning
 * conversation before Go, and to its lead after.
 *
 * A relay goes through the very launch the human's door uses, so it is refused
 * exactly where that door is and nowhere else (decision 6).
 */

/** What `send_to_feature` did with the message. */
export type SendToFeatureResult = LaunchSessionResult | { deliveredToLead: true }

/**
 * Send a message to an owned feature. Before Go it is a `relay` run, headless,
 * resuming the planning conversation (decision 16). From Go on the feature's
 * chat is its lead, and the message reaches it as the human's would — drive
 * notes, an answer — so it counts as a human message, and clears a Stop.
 */
export async function toolSendToFeature(
  ctx: AppCtx,
  session: SessionRow,
  input: { slug: string; message: string },
  opts: LaunchSessionOptions = {},
): Promise<SendToFeatureResult> {
  const feature = requireOrchestratedFeature(ctx, session, input.slug)
  if (feature.phase !== 'planning') {
    await deliverToLead(ctx, feature, { text: input.message, source: 'human' })
    return { deliveredToLead: true }
  }
  return launchSession(
    ctx,
    { featureId: feature.id, kind: 'chat', purpose: 'relay', message: input.message },
    opts,
  )
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
          "Send a message to one of your features. Before Go it reaches the planning conversation " +
          "— a plan sent back with the change you want and why, or the human's answer relayed as " +
          'theirs — as a headless run you are told the end of, refused while another session is ' +
          "live on the feature. From Go on it reaches the feature's agent as the human's message " +
          '(drive notes, an answer), which lets it dispatch again after a Stop. Orchestrator only.',
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
