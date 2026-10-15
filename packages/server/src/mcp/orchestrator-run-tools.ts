import type { SessionRow } from '@runcastle/core'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import * as z from 'zod'
import type { AppCtx } from '../db/types'
import {
  launchSession,
  type LaunchSessionOptions,
  type LaunchSessionResult,
} from '../launcher/launcher'
import {
  noSession,
  ok,
  orchestratorTool,
  requireOrchestratedFeature,
  type ResolveSession,
} from './orchestrator-tools'

/**
 * The orchestrator's tools that launch or end a headless run on a feature
 * (`whole-cuts-plan-themselves`): planning it, relaying a message to its
 * planning conversation, stopping its run, and planning its next lap.
 *
 * Each goes through the shared gate and then the very launch the human's door
 * uses, so it is refused exactly where that door is and nowhere else
 * (decision 6).
 */

/**
 * Send a message to an owned feature's planning conversation: a `relay` run,
 * headless, resuming that conversation (decision 16).
 */
export async function toolSendToFeature(
  ctx: AppCtx,
  session: SessionRow,
  input: { slug: string; message: string },
  opts: LaunchSessionOptions = {},
): Promise<LaunchSessionResult> {
  const feature = requireOrchestratedFeature(ctx, session, input.slug)
  return launchSession(
    ctx,
    { featureId: feature.id, kind: 'chat', purpose: 'relay', message: input.message },
    opts,
  )
}

/**
 * Start an owned feature's next lap, planned by a headless run from the review,
 * the notes and the orchestrator's message — the Start-lap door, headless.
 */
export async function toolStartFeatureLap(
  ctx: AppCtx,
  session: SessionRow,
  input: { slug: string; message?: string },
  opts: LaunchSessionOptions = {},
): Promise<LaunchSessionResult> {
  const feature = requireOrchestratedFeature(ctx, session, input.slug)
  return launchSession(
    ctx,
    {
      featureId: feature.id,
      kind: 'chat',
      purpose: 'start-lap',
      headless: true,
      ...(input.message ? { message: input.message } : {}),
    },
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
        title: 'Send a feature a change',
        description:
          "Send a message to one of your features' planning conversation — a plan sent back with " +
          'the change you want and why, or the human\'s answer relayed as theirs. It runs headless ' +
          'and you are told when it ends. Refused while another session is live on the feature. ' +
          'Orchestrator only.',
        inputSchema: {
          slug: z.string().describe('The slug of the feature.'),
          message: z
            .string()
            .min(1)
            .describe(
              "What to change and why. Say so plainly when it relays the human's own answer.",
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

  if (wants('start_feature_lap')) {
    server.registerTool(
      'start_feature_lap',
      {
        title: 'Start a feature’s next lap',
        description:
          "Start the next lap of one of your features at review. It plans itself headless from the " +
          'review, the test notes and your message, through to tickets, and you are told when it ' +
          'ends. Refused where the human’s Start lap is. Orchestrator only.',
        inputSchema: {
          slug: z.string().describe('The slug of the feature.'),
          message: z
            .string()
            .min(1)
            .optional()
            .describe('What you want the lap to take on, beside the carried notes and findings.'),
        },
      },
      orchestratorTool(async (args, extra) => {
        const rs = await resolve(extra)
        if (!rs) return noSession()
        return ok(await toolStartFeatureLap(rs.ctx, rs.session, args))
      }),
    )
  }
}
