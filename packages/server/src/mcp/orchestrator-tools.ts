import type { Feature, SessionRow } from '@runcastle/core'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { and, eq } from 'drizzle-orm'
import * as z from 'zod'
import { features } from '../db/schema'
import type { AppCtx } from '../db/types'
import { GateError } from '../errors'
import { runAsActor } from '../services/events'
import { markOrchestrated, rowToFeature } from '../services/repo'
import { orchestratorOn } from '../services/settings'
import type { HeaderCarrier } from './server'

/**
 * The orchestrator's tools (`whole-cuts-plan-themselves`): the project session,
 * launched with the project's Orchestrator setting on, acting on the features
 * it owns. Every acting tool refuses through one gate — {@link
 * requireOrchestratedFeature} — with a sentence saying why, as the human's
 * buttons do, and adds no rule of its own (decision 6).
 */

/** The caller of a session tool, or null when the request names no session. */
export type ResolveSession = (
  extra: HeaderCarrier,
) => Promise<{ ctx: AppCtx; session: SessionRow } | null>

/**
 * Refuse unless `session` is a still-open `orchestrate` project session and its
 * project's Orchestrator setting is still on. Turning the setting off is the
 * one-move stop (decision 6): from that moment the tools start nothing.
 */
export function requireOrchestratorSession(ctx: AppCtx, session: SessionRow): string {
  if (session.kind !== 'project' || session.purpose !== 'orchestrate' || !session.projectId) {
    throw new GateError(
      'only the orchestrator may do this: the project session launched with the ' +
        "project's Orchestrator setting on.",
    )
  }
  if (session.status === 'ended') {
    throw new GateError('this orchestrator session has ended; a new one must be opened to act.')
  }
  if (!orchestratorOn(ctx, session.projectId)) {
    throw new GateError(
      "the project's Orchestrator setting is off, so the orchestrator starts nothing new. " +
        'Runs already going finish on their own.',
    )
  }
  return session.projectId
}

/** The feature `slug` names in `projectId`, or a refusal naming it. */
function featureBySlug(ctx: AppCtx, projectId: string, slug: string): Feature {
  const row = ctx.db
    .select()
    .from(features)
    .where(and(eq(features.projectId, projectId), eq(features.slug, slug)))
    .get()
  if (!row) throw new GateError(`there is no feature \`${slug}\` in this project.`)
  return rowToFeature(row)
}

/**
 * {@link requireOrchestratorSession}, and the feature `slug` must be one the
 * orchestrator owns (decision 9): one it created, or one the human handed it.
 */
export function requireOrchestratedFeature(
  ctx: AppCtx,
  session: SessionRow,
  slug: string,
): Feature {
  const projectId = requireOrchestratorSession(ctx, session)
  const feature = featureBySlug(ctx, projectId, slug)
  if (!feature.orchestrated) {
    throw new GateError(
      `\`${slug}\` is the human's feature, not yours: you act only on the features you created ` +
        'and the ones the human hands you. Tell the human if it bears on your work.',
    )
  }
  return feature
}

/**
 * Run a tool handler as the orchestrator: every event it emits carries
 * `data.actor: 'orchestrator'`, so the notifier does not repeat back what the
 * orchestrator's own call just caused and answered.
 */
export function orchestratorTool<A extends unknown[], R>(
  handler: (...args: A) => R,
): (...args: A) => R {
  return (...args) => runAsActor('orchestrator', () => handler(...args))
}

/**
 * Take over a feature the human handed the orchestrator by name (decision 13:
 * handing one over is a sentence in its terminal, not a button).
 */
export function toolTakeOverFeature(
  ctx: AppCtx,
  session: SessionRow,
  input: { slug: string },
): { slug: string; orchestrated: true } {
  const projectId = requireOrchestratorSession(ctx, session)
  const feature = featureBySlug(ctx, projectId, input.slug)
  if (!feature.orchestrated) markOrchestrated(ctx, feature.id, 'taken over')
  return { slug: feature.slug, orchestrated: true }
}

export function ok(result: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(result) }] }
}

export function noSession(): CallToolResult {
  return {
    content: [
      { type: 'text', text: 'No active runcastle session. Launch a session from the runcastle UI first.' },
    ],
    isError: true,
  }
}

/** Register the orchestrator's tools that are not headless runs on a feature. */
export function registerOrchestratorTools(
  server: McpServer,
  wants: (tool: string) => boolean,
  resolve: ResolveSession,
): void {
  if (wants('take_over_feature')) {
    server.registerTool(
      'take_over_feature',
      {
        title: 'Take over a feature',
        description:
          'Make a feature the human handed you yours, so your tools act on it and you hear when ' +
          'something ends on it. Only when the human has handed it to you by name. Orchestrator only.',
        inputSchema: {
          slug: z.string().describe('The slug of the feature the human handed you.'),
        },
      },
      orchestratorTool(async (args, extra) => {
        const rs = await resolve(extra)
        if (!rs) return noSession()
        return ok(toolTakeOverFeature(rs.ctx, rs.session, args))
      }),
    )
  }
}
