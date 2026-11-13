import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import {
  EPIC_ICON_IDS,
  type EpicIconId,
  type Feature,
  type FeatureAction,
  isEpicIconId,
  isStoppableHeadlessRun,
  type SessionRow,
} from '@runcastle/core'
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
import * as autopilot from '../services/autopilot'
import { type AutopilotAction, type AutopilotResult, requireMayAct } from '../services/autopilot'
import { type EpicSibling, epicSiblingsInProgress } from '../services/epic-siblings'
import { type MergeFlowResult, mergeFeatureFlow } from '../services/merge'
import {
  getFeatureRow,
  projectForFeature,
  requireProjectById,
  rowToFeature,
} from '../services/repo'
import { writeEpicIcon } from '../threads/epic-look'
import { EPIC_NAME_MAX, writeEpicName } from '../threads/epic-name'
import { appendThreadEvent } from '../threads/log'
import { seedFromTranscript } from '../threads/read'
import type { HeaderCarrier } from './server'

/**
 * The orchestrator's tools (`one-orchestrator-no-mode`): every orchestrator
 * is the orchestrator. What it may act on is drawn by its instructions (decision
 * 2), and by one server rule (`epics-on-autopilot`): every acting tool goes
 * through {@link requireActableFeature}, so an epic creates, starts and plans
 * its own features, and talks to, stops, drives and merges only the ones on
 * autopilot in it. Beyond that each tool refuses what its service already
 * refuses, with a sentence saying why, as the human's buttons do.
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

/**
 * {@link requireProjectFeature}, for a tool that does `action` to it: the
 * calling epic must be allowed to ({@link mayAct}). Creating, starting,
 * planning and a draft's brief pass on the epic's own features; messaging,
 * stopping, driving and merging only when the feature is on autopilot in it.
 */
export function requireActableFeature(ctx: AppCtx, session: SessionRow, slug: string, action: AutopilotAction): Feature {
  return requireMayAct(ctx, session.id, requireProjectFeature(ctx, session, slug), action)
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
}

/** What `set_autopilot` takes. */
export interface SetAutopilotInput {
  action: 'on' | 'add' | 'off'
  /** `add` only: the features to move into this epic. */
  features?: string[]
}

/**
 * Turn this epic's autopilot on (every open feature of it locks), move
 * features into it ("also run X"), or turn it off (`epics-on-autopilot`
 * decisions 1, 8, 13, 14). Only ever on the human's own words.
 */
export const toolSetAutopilot = orchestratorTool(
  async (ctx: AppCtx, session: SessionRow, input: SetAutopilotInput): Promise<AutopilotResult> => {
    requireOrchestratorSession(session)
    const slugs = input.features ?? []
    if (input.action === 'add' && slugs.length === 0) {
      throw new InvalidInputError('set_autopilot add needs `features`: the slugs to move into this epic.')
    }
    // Only these three: there is no taking one feature back (decision 14).
    if (input.action !== 'on' && input.action !== 'add' && input.action !== 'off') {
      throw new InvalidInputError(`set_autopilot takes \`on\`, \`add\` or \`off\`, not \`${String(input.action)}\`: to work on one feature, the human ends autopilot.`)
    }
    const done =
      input.action === 'on'
        ? await autopilot.turnOn(ctx, session.id)
        : input.action === 'add'
          ? await autopilot.add(ctx, session.id, slugs)
          : await autopilot.turnOff(ctx, session.id)
    for (const slug of done.changed) {
      const feature = requireProjectFeature(ctx, session, slug)
      recordFeatureAction(ctx, session, feature.id, input.action === 'on' || input.action === 'add' ? 'autopilotOn' : 'autopilotOff')
    }
    return done
  },
)

/** What `name_epic` applied: each of the name and the icon, or the human's own that it kept. */
export interface EpicNameResult {
  name: string
  /** False when the human renamed the chat: `name` is theirs, kept. */
  nameApplied: boolean
  icon: EpicIconId | null
  /** False when the human picked the icon: `icon` is theirs, kept. */
  iconApplied: boolean
  /** In words, what was applied and what was kept. */
  note: string
}

/**
 * Name this chat's epic and pick its icon (orchestrator-chats-become-epics
 * decision 12; epics-that-look-alive decision 1): the name trimmed, non-empty,
 * at most {@link EPIC_NAME_MAX} characters; the icon one of the curated ids.
 * Each applies unless the human set its own — the name after a rename, the
 * icon after a pick — and the other still applies. Refused, with nothing
 * changed, only when the human set both.
 */
export function toolNameEpic(ctx: AppCtx, session: SessionRow, input: { name: string; icon: string }): EpicNameResult {
  requireOrchestratorSession(session)
  const name = input.name.replace(/\s+/g, ' ').trim()
  if (!name) throw new InvalidInputError('name the epic: the name is empty.')
  if (name.length > EPIC_NAME_MAX) {
    throw new InvalidInputError(`an epic's name is at most ${EPIC_NAME_MAX} characters; "${name}" has ${name.length}. Use 1–3 words.`)
  }
  if (!isEpicIconId(input.icon)) {
    throw new InvalidInputError(`"${input.icon}" is not an epic icon; pick one of: ${EPIC_ICON_IDS.join(', ')}.`)
  }
  seedFromTranscript(ctx, session.id)
  const named = writeEpicName(session.id, name)
  const iconed = writeEpicIcon(ctx, session.id, input.icon)
  if (!named.named && !iconed.applied) {
    throw new GateError(`The human named this chat "${named.humanName}" and picked its icon; keep both.`)
  }
  const icon = iconed.applied ? input.icon : iconed.humanIcon
  const note = !named.named
    ? `Icon set. The human named this chat "${named.humanName}"; keep it.`
    : !iconed.applied
      ? 'Named. The human picked this epic’s icon; keep it.'
      : 'Named, and the icon set.'
  return { name: named.named ? named.name : named.humanName, nameApplied: named.named, icon, iconApplied: iconed.applied, note }
}

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
    const feature = requireActableFeature(ctx, session, input.slug, 'start')
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

/** Plan a feature automatically: its unattended automatic planning run, as Plan automatically launches it. */
export const toolPlanFeature = orchestratorTool(
  async (
    ctx: AppCtx,
    session: SessionRow,
    input: { slug: string },
    launch: LaunchSessionOptions = {},
  ): Promise<{ slug: string; sessionId: string }> => {
    const feature = requireActableFeature(ctx, session, input.slug, 'plan')
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
    const feature = requireActableFeature(ctx, session, input.slug, 'stop')
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
    const feature = requireActableFeature(ctx, session, input.slug, 'drive')
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
 *
 * A clean merge answers with the feature's epic's other features in progress
 * (`the-epic-hears-when-its-features-merge` decision 9), the list its merge line
 * carries: an epic that merges its own feature checks fit in this turn, and the
 * line it hears of this merge is held, not woken.
 */
export const toolMergeFeature = orchestratorTool(
  async (
    ctx: AppCtx,
    session: SessionRow,
    input: { slug: string },
  ): Promise<MergeFlowResult & { inProgress?: EpicSibling[] }> => {
    const feature = requireActableFeature(ctx, session, input.slug, 'merge')
    const merged = await mergeFeatureFlow(ctx, feature.id, { by: session.id })
    if (!merged.ok || merged.conflict) return merged
    recordFeatureAction(ctx, session, feature.id, 'merged', { into: merged.base })
    // Only a feature locked to this epic merges here, so the epic checks fit with its own list.
    return { ...merged, inProgress: epicSiblingsInProgress(ctx, getFeatureRow(ctx, feature.id)) }
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
    const feature = requireActableFeature(ctx, session, input.slug, 'brief')
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
    'name_epic',
    {
      title: 'Name your epic',
      description:
        'Name this chat, your epic: 1–3 words, Title Case, a noun phrase ("Payment System"), and pick its icon ' +
        'for the kind of work it is. The human’s rename or icon pick is kept; the other still applies.',
      inputSchema: {
        name: z.string().describe(`The epic's name, at most ${EPIC_NAME_MAX} characters.`),
        // The ids themselves reach the model as the schema's enum; the skill lists what each one shows.
        icon: z.enum(EPIC_ICON_IDS).describe("The epic's icon, by id: the one closest to the kind of work."),
      },
    },
    toolNameEpic,
  )

  acting(
    'set_autopilot',
    {
      title: 'Turn autopilot on or off',
      description:
        'Only on the human’s own words, after they agreed your run plan. ' +
        '`on` locks every open feature of this epic: their leads report to you, and you run them as far as the run plan goes. ' +
        '`add` ("also run X") moves features into this epic, refused while one is locked to another epic. ' +
        '`off` gives every feature back to the human. Nothing running stops.',
      inputSchema: {
        action: z.enum(['on', 'add', 'off']).describe('`on`, `add` or `off`.'),
        features: z
          .array(z.string().min(1))
          .optional()
          .describe('`add` only: the slugs to move into this epic. Omit for `on` and `off`.'),
      },
    },
    toolSetAutopilot,
  )

  acting(
    'start_feature',
    {
      title: 'Start a draft',
      description:
        'Start a draft, as Start does: cut its branch and scaffold its brief. Refused while it ' +
        'waits on an unmerged dependency, or once started. Launches nothing — call plan_feature ' +
        'or send_to_feature when it is ready to work. Also allowed on a human\'s "Plan automatically" feature you cut, ' +
        'before its planning run.',
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
      title: 'Plan a feature automatically',
      description:
        'Launch a feature’s automatic planning run, as Plan automatically does: its chat, unattended. ' +
        'Refused on a draft or a shipped feature. You are told in this chat when it ends. On a human\'s ' +
        '"Plan automatically" feature you cut, allowed once; it stays theirs.',
      inputSchema: { slug: SlugInput },
    },
    toolPlanFeature,
  )

  acting(
    'stop_feature_run',
    {
      title: 'Stop a feature’s automatic planning run',
      description: 'End the automatic planning run going on a feature, as its Stop button does.',
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
        '`files` to resolve in the worktree. A clean merge of a feature you cut returns `inProgress`: ' +
        'the other features you cut still in progress (slug, title, who runs it), to check the merge fits with.',
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
