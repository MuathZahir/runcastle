import {
  EPIC_ICON_IDS,
  type EpicIconId,
  type Feature,
  type FeatureAction,
  isEpicIconId,
  type SessionRow,
  startPurposeFor,
} from '@runcastle/core'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { and, eq } from 'drizzle-orm'
import * as z from 'zod'
import { features } from '../db/schema'
import type { AppCtx } from '../db/types'
import { GateError, InvalidInputError } from '../errors'
import type { LaunchSessionOptions } from '../launcher/launcher'
import { activeSessionsForFeature, landProjectBranchNow } from '../launcher/sessions'
import { type EpicAction, requireMayAct } from '../services/epic-acts'
import { type EpicSibling, epicSiblingsInProgress } from '../services/epic-siblings'
import { emit, runAsActor } from '../services/events'
import { startDraft } from '../services/features'
import { launchLeadByLevel } from '../services/lead-start'
import { type MergeFlowResult, mergeFeatureFlow } from '../services/merge'
import { getFeatureRow, projectForFeature, rowToFeature } from '../services/repo'
import { writeEpicIcon } from '../threads/epic-look'
import { EPIC_NAME_MAX, writeEpicName } from '../threads/epic-name'
import { appendThreadEvent } from '../threads/log'
import { reviveIfRunning } from '../threads/revive'
import { seedFromTranscript } from '../threads/read'
import type { HeaderCarrier } from './server'

/**
 * The orchestrator's tools (`one-orchestrator-no-mode`): every orchestrator
 * is the orchestrator. What it may act on is drawn by its instructions (decision
 * 2), and by one server rule (`autopilot-retires` decision 12): every acting
 * tool goes through {@link requireActableFeature}, so an epic starts, messages,
 * sets dependencies of and merges only its own features, and edits a brief only
 * while it is a draft. Beyond that each tool refuses what its service already
 * refuses, with a sentence saying why, as the human's buttons do.
 */

/** The caller of a session tool, or null when the request names no session. */
export type ResolveSession = (
  extra: HeaderCarrier,
) => Promise<{ ctx: AppCtx; session: SessionRow } | null>

/** What a process the host does not run hears when it calls an orchestrator tool (the-orchestrator-is-never-locked-out decision 4). */
export const NOT_THE_RUNNING_CHAT =
  'this process is not the orchestrator chat runcastle is running (it was stopped or replaced), so it cannot act. ' +
  'End your turn here: the open orchestrator chat carries on.'

/**
 * Refuse unless `session` is an orchestrator chat that is open; its project's
 * id. A row that says ended while the agent host runs its process is alive and
 * goes back to live (the-orchestrator-is-never-locked-out decision 2): only a
 * process the host does not run is refused.
 */
export function requireOrchestratorSession(ctx: AppCtx, session: SessionRow): string {
  if (session.kind !== 'project' || !session.projectId) {
    throw new GateError('only the orchestrator may do this: the orchestrator.')
  }
  if (session.status === 'ended' && !reviveIfRunning(ctx, session, 'tool call')) {
    throw new GateError(NOT_THE_RUNNING_CHAT)
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
  return featureBySlug(ctx, requireOrchestratorSession(ctx, session), slug)
}

/**
 * {@link requireProjectFeature}, for a tool that does `action` to it: the
 * calling epic must be allowed to (`mayAct`): only its own features, and a
 * brief only while the feature is a draft.
 */
export function requireActableFeature(ctx: AppCtx, session: SessionRow, slug: string, action: EpicAction): Feature {
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
  requireOrchestratorSession(ctx, session)
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

/** What `start_feature` did: the feature as it is now, and its lead's chat. */
export interface StartFeatureResult extends Pick<Feature, 'slug' | 'status' | 'baseBranch'> {
  /** The lead's chat thread the start launched. */
  sessionId: string
  /** How the lead started: `asksFirst` at "Everything", `plansAlone` below it. */
  lead: 'asksFirst' | 'plansAlone'
}

/**
 * Start a feature and launch its lead as its level says (`autopilot-retires`
 * decision 4): a draft is cut first, as Start does, after the orchestrator's
 * own commits (prepared `.runcastle/` scripts, charter edits, the draft's
 * brief) land on the base branch so the feature is cut from a base that has
 * them; a refused landing refuses the start, with its reason. A started
 * feature whose lead is not running just launches; one whose lead runs is
 * refused, pointing at `send_to_feature`.
 */
export const toolStartFeature = orchestratorTool(
  async (
    ctx: AppCtx,
    session: SessionRow,
    input: { slug: string; baseBranch?: string },
    launch: LaunchSessionOptions = {},
  ): Promise<StartFeatureResult> => {
    const feature = requireActableFeature(ctx, session, input.slug, 'start')
    if (feature.status === 'shipped') {
      throw new GateError(`\`${feature.slug}\` has shipped, so there is nothing to start.`)
    }
    if (feature.status === 'draft') {
      const landing = await landProjectBranchNow(ctx, projectForFeature(ctx, feature), session.id)
      if (!landing.ok) {
        throw new GateError(
          `the orchestrator's commits could not land first, so \`${input.slug}\` was not started: ${landing.reason}`,
        )
      }
      await startDraft(ctx, feature.id, { baseBranch: input.baseBranch })
    } else if (activeSessionsForFeature(ctx, feature.id).some((s) => s.kind === 'chat')) {
      throw new GateError(
        `\`${feature.slug}\` has started and its lead is running, so there is nothing to start: ` +
          'tell it what you need with send_to_feature.',
      )
    }
    const started = getFeatureRow(ctx, feature.id)
    const { sessionId } = await launchLeadByLevel(ctx, started, launch)
    recordFeatureAction(ctx, session, feature.id, 'started')
    return {
      slug: started.slug,
      status: started.status,
      baseBranch: started.baseBranch,
      sessionId,
      lead: startPurposeFor(started.involvement) ? 'plansAlone' : 'asksFirst',
    }
  },
)

/**
 * Merge through runcastle, as Merge does: the outcome doc, the shipped state
 * and the worktree clean-up all happen. A conflict comes back with its files so
 * the orchestrator can resolve it in the worktree and merge again (decision 8).
 *
 * A clean merge answers with the feature's epic's other features in progress
 * (`the-epic-hears-when-its-features-merge` decision 9), so the epic checks fit
 * in this turn. The merge still wakes it with the merge line, as every merge of
 * one of its features does (`autopilot-retires` decision 2).
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
    // Only the epic's own feature merges here, so the epic checks fit with its own list.
    return { ...merged, inProgress: epicSiblingsInProgress(ctx, getFeatureRow(ctx, feature.id)) }
  },
)

/**
 * The parts a lead and runcastle grow below the human's words in a one-file
 * feature's brief (one-file-per-feature decision 6). What the orchestrator adds
 * belongs to the human's words, so it goes above the first of them.
 */
const LATER_BRIEF_PART = /^## (?:Decisions|Build notes|Review summary)[ \t]*$/m

/**
 * `prior` with `text` added as a dated orchestrator section: just above the
 * first `## Decisions`, `## Build notes` or `## Review summary` line when the
 * brief has one, appended at the end otherwise.
 */
export function withBriefSection(prior: string, text: string): string {
  const date = new Date().toISOString().slice(0, 10)
  const section = `## Added by the orchestrator, ${date}\n\n${text}\n`
  const later = LATER_BRIEF_PART.exec(prior)
  if (later) {
    const before = prior.slice(0, later.index).trimEnd()
    return `${before === '' ? '' : `${before}\n\n`}${section}\n${prior.slice(later.index)}`
  }
  const separator = prior === '' ? '' : prior.endsWith('\n') ? '\n' : '\n\n'
  return `${prior}${separator}${section}`
}

/**
 * Append what the human told the orchestrator later about a draft to its
 * brief, where the human's intent lives (decision 16). A draft has no branch
 * and keeps its brief on its row, so the section is appended there and Start
 * scaffolds it into `brief.md`. A started feature's brief is its lead's and
 * the human's (`autopilot-retires` decision 12), so it is refused.
 */
export const toolAddToBrief = orchestratorTool(
  (ctx: AppCtx, session: SessionRow, input: { slug: string; text: string }): { slug: string; relPath: string } => {
    const feature = requireActableFeature(ctx, session, input.slug, 'brief')
    const text = input.text.trim()
    if (!text) throw new InvalidInputError('there is nothing to add: the text is empty.')
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
    'start_feature',
    {
      title: 'Start a feature',
      description:
        'Start one of your features and launch its lead, as Start does: a draft is cut after your commits land. ' +
        'At Everything the lead asks the human first; below it, it plans and builds alone. A started feature whose ' +
        'lead is not running just launches. Refused if your commits cannot land, on an unmerged dependency, once ' +
        'shipped, or while its lead runs (use send_to_feature).',
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
    'merge_feature',
    {
      title: 'Merge a feature',
      description:
        'Merge a feature into its base, as Merge does: it writes the outcome doc, marks it shipped and cleans up, ' +
        'which a hand merge would not. Only when the human asks. On a conflict it returns `conflict` and the ' +
        '`files`: resolve them in the worktree, commit, and call again. A clean merge returns `inProgress`, your ' +
        'other features still in progress, to check the merge fits with.',
      inputSchema: { slug: SlugInput },
    },
    toolMergeFeature,
  )

  acting(
    'add_to_brief',
    {
      title: 'Add to a feature’s brief',
      description:
        'Add what the human told you later about a draft to its brief, as a dated section. Refused once it has ' +
        'started: its brief is then its lead’s and the human’s, so tell its lead with send_to_feature.',
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
