import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { type Feature, type FeatureAction, type SessionRow, isStoppableHeadlessRun } from '@runcastle/core'
import { worktreeDir } from '@runcastle/core/paths'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { and, eq } from 'drizzle-orm'
import * as z from 'zod'
import { features } from '../db/schema'
import type { AppCtx } from '../db/types'
import { GateError, InvalidInputError } from '../errors'
import {
  type EndSessionResult,
  type LaunchSessionOptions,
  endSession,
  launchSession,
} from '../launcher/launcher'
import { activeSessionsForFeature, landProjectBranchNow } from '../launcher/sessions'
import { landChatCommits } from '../services/chat-branch'
import { emit, runAsActor } from '../services/events'
import { featureDocPath } from '../services/feature-docs'
import { requireNotDraft, startDraft } from '../services/features'
import * as git from '../services/git'
import type { TestDriveResult } from '../services/git'
import { holderName, requireHold, takeHold } from '../services/holding'
import { clearHandback } from '../services/lead-status'
import { type MergeFlowResult, mergeFeatureFlow } from '../services/merge'
import {
  getFeatureRow,
  projectForFeature,
  requireProjectById,
  rowToFeature,
} from '../services/repo'
import { appendThreadEvent } from '../threads/log'
import { seedFromTranscript } from '../threads/read'
import type { HeaderCarrier } from './server'

/**
 * The orchestrator's tools (`one-orchestrator-no-mode`): every orchestrator
 * is the orchestrator. What it may act on is drawn by its instructions (decision
 * 2), and by one server rule (`threads-hold-features`): every acting tool goes
 * through {@link requireHeldFeature}, so a thread cannot act on a feature another
 * thread holds. Beyond that each tool refuses what its service already refuses,
 * with a sentence saying why, as the human's buttons do.
 */

/** The caller of a session tool, or null when the request names no session. */
export type ResolveSession = (
  extra: HeaderCarrier,
) => Promise<{ ctx: AppCtx; session: SessionRow } | null>

/** Refuse unless `session` is a still-open orchestrator chat; its project's id. */
export function requireOrchestratorSession(session: SessionRow): string {
  if (session.kind !== 'project' || !session.projectId) {
    throw new GateError('only the orchestrator may do this: the orchestrator.')
  }
  if (session.status === 'ended') {
    throw new GateError('this orchestrator session has ended; a new one must be opened to act.')
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

/** {@link requireOrchestratorSession}, and the feature `slug` names in its project. */
export function requireProjectFeature(ctx: AppCtx, session: SessionRow, slug: string): Feature {
  return featureBySlug(ctx, requireOrchestratorSession(session), slug)
}

/** {@link requireProjectFeature}, for a tool that changes it: this thread must hold it. */
export function requireHeldFeature(ctx: AppCtx, session: SessionRow, slug: string): Feature {
  return requireHold(ctx, session, requireProjectFeature(ctx, session, slug))
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
 * Record in the calling chat's log that a tool changed a feature, so the chat
 * shows it as a row of the turn's features card. Called once the change landed:
 * a refused or failed call never reaches it. The title is the feature's now.
 * Only tools that change something call it, so it is also where the
 * orchestrator answers the lead's outstanding handback (the-status-tells-the-
 * truth decision 7); a tool that only reads leaves the handback standing.
 */
export function recordFeatureAction(
  ctx: AppCtx,
  session: SessionRow,
  featureId: string,
  action: FeatureAction,
  extra: { quote?: string; into?: string } = {},
): void {
  seedFromTranscript(ctx, session.id)
  appendThreadEvent(session.id, {
    type: 'feature_acted',
    featureId,
    title: getFeatureRow(ctx, featureId).title,
    action,
    ...extra,
  })
  clearHandback(ctx, featureId, 'orchestrator')
}

/** Make this thread the holder of a feature, held or not, waking nothing on it. */
export const toolTakeFeature = orchestratorTool(
  (
    ctx: AppCtx,
    session: SessionRow,
    input: { slug: string },
  ): { slug: string; heldBy: string; takenFrom: string | null } => {
    const feature = requireProjectFeature(ctx, session, input.slug)
    const { from } = takeHold(ctx, session, feature)
    recordFeatureAction(ctx, session, feature.id, 'taken')
    return { slug: input.slug, heldBy: holderName(session), takenFrom: from }
  },
)

/**
 * Start a draft, as Start does: refused where Start is. The orchestrator's own
 * commits (prepared `.runcastle/` scripts, charter edits, the draft's brief)
 * land on the base branch first, so the feature is cut from a base that has
 * them (decision 4); a refused landing refuses the start, with its reason.
 */
export const toolStartFeature = orchestratorTool(
  async (
    ctx: AppCtx,
    session: SessionRow,
    input: { slug: string; baseBranch?: string },
  ): Promise<Pick<Feature, 'slug' | 'status' | 'baseBranch'>> => {
    const feature = requireHeldFeature(ctx, session, input.slug)
    const landing = await landProjectBranchNow(ctx, projectForFeature(ctx, feature), session.id)
    if (!landing.ok) {
      throw new GateError(
        `the orchestrator's commits could not land first, so \`${input.slug}\` was not started: ${landing.reason}`,
      )
    }
    const started = await startDraft(ctx, feature.id, { baseBranch: input.baseBranch })
    recordFeatureAction(ctx, session, feature.id, 'started')
    return { slug: started.slug, status: started.status, baseBranch: started.baseBranch }
  },
)

/** Have a feature plan itself: its unattended self-planning run, as Plan it yourself launches it. */
export const toolPlanFeature = orchestratorTool(
  async (
    ctx: AppCtx,
    session: SessionRow,
    input: { slug: string },
    launch: LaunchSessionOptions = {},
  ): Promise<{ slug: string; sessionId: string }> => {
    const feature = requireHeldFeature(ctx, session, input.slug)
    const { sessionId } = await launchSession(
      ctx,
      { featureId: feature.id, kind: 'chat', purpose: 'self-plan' },
      launch,
    )
    recordFeatureAction(ctx, session, feature.id, 'planning')
    return { slug: feature.slug, sessionId }
  },
)

/** End the feature's running self-planning run, as its Stop button does. */
export const toolStopFeatureRun = orchestratorTool(
  (ctx: AppCtx, session: SessionRow, input: { slug: string }): EndSessionResult => {
    const feature = requireHeldFeature(ctx, session, input.slug)
    // The run plan_feature starts is always one this can stop; the feature's
    // lead never is — ending it would drop the conversation it is having.
    const run = activeSessionsForFeature(ctx, feature.id).find(isStoppableHeadlessRun)
    if (!run) throw new GateError(`\`${feature.slug}\` has no headless run going, so there is nothing to stop.`)
    const ended = endSession(ctx, run.id)
    recordFeatureAction(ctx, session, feature.id, 'planningStopped')
    return ended
  },
)

/**
 * Start or stop a test drive: of a feature branch when `slug` names one, of the
 * project's base checkout when it names none. One drive runs on the machine;
 * a second is answered with the drive's own `deniedReason`, as the button is.
 */
export const toolDrive = orchestratorTool(
  async (
    ctx: AppCtx,
    session: SessionRow,
    input: { slug?: string; action: 'start' | 'stop'; scenario?: string },
  ): Promise<TestDriveResult> => {
    const opts = input.scenario ? { scenario: input.scenario } : {}
    if (input.slug === undefined) {
      const project = requireProjectById(ctx, requireOrchestratorSession(session))
      return git.projectDrive(ctx, project, input.action, opts)
    }
    const feature = requireHeldFeature(ctx, session, input.slug)
    requireNotDraft(feature)
    const result = await git.testDrive(
      ctx,
      projectForFeature(ctx, feature),
      feature,
      input.action,
      'human',
      opts,
    )
    if (!result.deniedReason) {
      recordFeatureAction(ctx, session, feature.id, input.action === 'start' ? 'driveStarted' : 'driveStopped')
    }
    return result
  },
)

/**
 * Merge through runcastle, as Merge does: the outcome doc, the shipped state
 * and the worktree clean-up all happen. A conflict comes back with its files so
 * the orchestrator can resolve it in the worktree and merge again (decision 8).
 */
export const toolMergeFeature = orchestratorTool(
  async (ctx: AppCtx, session: SessionRow, input: { slug: string }): Promise<MergeFlowResult> => {
    const feature = requireHeldFeature(ctx, session, input.slug)
    const merged = await mergeFeatureFlow(ctx, feature.id)
    if (merged.ok && !merged.conflict) recordFeatureAction(ctx, session, feature.id, 'merged', { into: merged.base })
    return merged
  },
)

/** `prior` with `text` appended as a dated orchestrator section. */
function withBriefSection(prior: string, text: string): string {
  const date = new Date().toISOString().slice(0, 10)
  const section = `## Added by the orchestrator, ${date}\n\n${text}\n`
  const separator = prior === '' ? '' : prior.endsWith('\n') ? '\n' : '\n\n'
  return `${prior}${separator}${section}`
}

/**
 * Append what the human told the orchestrator later about a feature to its
 * brief, where the human's intent lives (decision 16), and commit it as
 * runcastle commits feature docs — landed through the feature's queue when a
 * burn holds the branch. A draft has no branch and keeps its brief on its row,
 * so the section is appended there and Start scaffolds it into `brief.md`.
 */
export const toolAddToBrief = orchestratorTool(
  async (
    ctx: AppCtx,
    session: SessionRow,
    input: { slug: string; text: string },
  ): Promise<{ slug: string; relPath: string }> => {
    const feature = requireHeldFeature(ctx, session, input.slug)
    const text = input.text.trim()
    if (!text) throw new InvalidInputError('there is nothing to add: the text is empty.')
    if (feature.status === 'draft') {
      ctx.db
        .update(features)
        .set({ brief: withBriefSection(feature.brief ?? '', text) })
        .where(eq(features.id, feature.id))
        .run()
      emit(ctx, feature.id, {
        type: 'brief.added',
        message: `the orchestrator added to ${feature.slug}'s brief`,
      })
      recordFeatureAction(ctx, session, feature.id, 'brief')
      return { slug: feature.slug, relPath: 'brief.md' }
    }
    const project = projectForFeature(ctx, feature)
    const worktree = worktreeDir(project.id, feature.slug)
    if (!existsSync(worktree)) {
      throw new GateError(`\`${feature.slug}\` has no worktree to write its brief in.`)
    }
    const briefPath = featureDocPath(project, feature, 'brief.md')
    const prior = existsSync(briefPath) ? readFileSync(briefPath, 'utf8') : ''
    mkdirSync(dirname(briefPath), { recursive: true })
    writeFileSync(briefPath, withBriefSection(prior, text), 'utf8')
    await git.commitDocs(
      worktree,
      git.docsCommitMessage(`add to ${feature.slug} brief`, project.docsCommitPrefix),
    )
    await landChatCommits(ctx, project, feature)
    emit(ctx, feature.id, {
      type: 'brief.added',
      message: `the orchestrator added to ${feature.slug}'s brief`,
    })
    recordFeatureAction(ctx, session, feature.id, 'brief')
    return { slug: feature.slug, relPath: 'brief.md' }
  },
)

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
  /** Register one acting tool whose handler is a `tool*` function above. */
  function acting<S extends z.ZodRawShape>(
    name: string,
    config: { title: string; description: string; inputSchema: S },
    tool: (ctx: AppCtx, session: SessionRow, input: z.infer<z.ZodObject<S>>) => unknown,
  ): void {
    if (!wants(name)) return
    // The SDK's callback type is a conditional over the shape, which TypeScript
    // cannot resolve for a generic `S`; the handler's own signature is the check.
    server.registerTool(name, config, (async (args: z.infer<z.ZodObject<S>>, extra: HeaderCarrier) => {
      const rs = await resolve(extra)
      if (!rs) return noSession()
      return ok(await tool(rs.ctx, rs.session, args))
    }) as never)
  }

  acting(
    'take_feature',
    {
      title: 'Take a feature',
      description:
        'Make this thread the holder of a feature: you hear its news and may act on it. Use it only ' +
        'when the human asked you to act on this feature here.',
      inputSchema: { slug: SlugInput },
    },
    toolTakeFeature,
  )

  acting(
    'start_feature',
    {
      title: 'Start a draft',
      description:
        'Start a draft, as Start does: cut its branch and scaffold its brief. Refused while it ' +
        'waits on an unmerged dependency, or once started. Launches nothing — call plan_feature ' +
        'or send_to_feature when it is ready to work.',
      inputSchema: {
        slug: SlugInput,
        baseBranch: z
          .string()
          .min(1)
          .optional()
          .describe('The branch to cut it from. Omit for the checkout’s current branch.'),
      },
    },
    toolStartFeature,
  )

  acting(
    'plan_feature',
    {
      title: 'Have a feature plan itself',
      description:
        'Launch a feature’s self-planning run, as Plan it yourself does: its chat, unattended. ' +
        'Refused on a draft or a shipped feature. You are told in this chat when it ends.',
      inputSchema: { slug: SlugInput },
    },
    toolPlanFeature,
  )

  acting(
    'stop_feature_run',
    {
      title: 'Stop a feature’s self-planning run',
      description: 'End the self-planning run going on a feature, as its Stop button does.',
      inputSchema: { slug: SlugInput },
    },
    toolStopFeatureRun,
  )

  acting(
    'drive',
    {
      title: 'Start or stop a test drive',
      description:
        'Start or stop a test drive of a feature’s branch (`slug`) or the base checkout. A refusal ' +
        'comes back as `deniedReason`.',
      inputSchema: {
        scenario: z
          .string()
          .min(1)
          .optional()
          .describe('A scenario file to land on; ignored on stop.'),
        slug: SlugInput.optional().describe(
          'The feature whose branch to drive. Omit to drive the base branch.',
        ),
        action: z.enum(['start', 'stop']).describe('Start the drive, or stop it.'),
      },
    },
    toolDrive,
  )

  acting(
    'merge_feature',
    {
      title: 'Merge a feature',
      description:
        'Merge a feature into its base, as Merge does. On a conflict it returns `conflict` and the ' +
        '`files` to resolve in the worktree.',
      inputSchema: { slug: SlugInput },
    },
    toolMergeFeature,
  )

  acting(
    'add_to_brief',
    {
      title: 'Add to a feature’s brief',
      description:
        'Append what the human told you later about a feature to its brief, as a dated section.',
      inputSchema: {
        slug: SlugInput,
        text: z.string().min(1).describe('What the human said, in your words, as markdown.'),
      },
    },
    toolAddToBrief,
  )
}

/** The `slug` of the feature an orchestrator tool acts on. */
const SlugInput = z.string().min(1).describe('The slug of the feature.')
