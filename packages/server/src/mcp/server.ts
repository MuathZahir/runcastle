import { existsSync, readFileSync } from 'node:fs'
import {
  type LandWorkerResult,
  type LeadWorker,
  type StartedReview,
  type StartedWorker,
  dropWorker,
  getWorker,
  landWorker,
  leadWorkers,
  listWorkers,
  messageWorker,
  requireFeatureWorker,
  sendBackWorker,
  startReviewWorker,
  startWorker,
} from '../workers/service'
import { isHostReview, reportReviewFinding, writeHostHandback } from '../workers/review'
import { provideWorkerFeatureRead } from '../workers/tools'
import { driveWorkerOf } from '../workers/drive'
import { join, relative, resolve, sep } from 'node:path'
import { StreamableHTTPTransport } from '@hono/mcp'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type {
  DependencyRef,
  DesignState,
  DriveCallResult,
  FeatureFinish,
  FeatureStatus as FeatureStatusT,
  FindingSource as FindingSourceT,
  PreparedKey as PreparedKeyT,
  Project,
  ReadyDeclaration,
  ReviewFinding,
  ReviewFindingInput as ReviewFindingInputT,
  RunStatus as RunStatusT,
  ScenarioEntry,
  ScenarioFailure,
  SessionKind as SessionKindT,
  SessionRow,
  TicketStatus as TicketStatusT,
  WorkerStatus as WorkerStatusT,
  WorkerRow,
} from '@runcastle/core'
import {
  PreparedKey,
  ReviewFindingInput,
  WaitingKind,
  WITHHELD_FEATURE_DOCS,
  agentDigestFillRank,
  isAgentDigestDoc,
  isProjectSessionKind,
  unstartedState,
  SAW_MAX_SHOTS,
  maskedCall,
  workerFeatureId,
} from '@runcastle/core'
import { attachmentRelPath, featureDocsRel, projectNotePath, reviewDir, reviewShotPath } from '@runcastle/core/paths'
import { type Context, Hono } from 'hono'
import * as z from 'zod'
import type { AppCtx } from '../db/types'
import { GateError, InvalidInputError, NotFoundError } from '../errors'
import { appendThreadEvent } from '../threads/log'
import { seedFromTranscript } from '../threads/read'
import { showFile, showableFile } from '../threads/shown'
import { showReviewPackage } from '../threads/review-package'
import { reviewShots, type ReviewShots } from '../services/review-package'
import { appendSaw, readSaw } from '../services/review-saw'
import { captureReviewShot } from '../services/review-capture'
import { getRuntimeCtx } from '../launcher/runtime'
import { getSessionRow, landProjectBranchNow, mostRecentLiveSession } from '../launcher/sessions'
import {
  createFeature,
  declareReady,
  type FeatureListItem,
  list as listFeatures,
  listReadyDeclarations,
  requireNotStopped,
  setWaiting,
} from '../services/features'
import { humanTypedAt } from '../services/lead-status'
import {
  blocksOf,
  dependsOnOf,
  setDependencies,
  setUpNext,
  validateDependencies,
} from '../services/dependencies'
import { type DesignServerInfo, designServerStatus, rememberDesignPath, startDesignServer } from '../services/design'
import {
  type LeadDesign,
  copyDesignPicture,
  leadDesigns,
  listDesigns,
  markPlanShown,
  recordDesign,
  setDesignState,
} from '../services/designs'
import { emit, emitForSession, emitProject, latestEventTs, runAsActor } from '../services/events'
import { featureDocsDir } from '../services/feature-docs'
import { type ChatFinish, chatNameOf, giveToChat, holderName, holderOf, releasedFrom, requireHold } from '../services/holding'
import { handBackToOrchestrator } from '../services/lead-handback'
import { isOverwritable, recordFinding } from '../services/findings'
import {
  closeAsAddressed,
  dismissAsAgent,
  listByFeature as listReviewFindings,
  openDefects as openDefectsOf,
} from '../services/review-findings'
import * as git from '../services/git'
import type { AdrDoc } from '../services/knowledge'
import { ADR_DIR_REL, listDocs, listLiveAdrs, readCharter, readDoc } from '../services/knowledge'
import {
  editNote as editProjectNote,
  listNotes as listProjectNotes,
  triageNotes as triageProjectNotes,
} from '../services/project-notes'
import {
  getFeatureRow,
  getProjectById,
  listRunsByFeature,
  projectForFeature,
} from '../services/repo'
import { type AnnotatedModel, annotatedModels, listByFeature } from '../services/tickets'
import { sendDriveCall } from '../services/drive-call'
import {
  SCENARIO_FILE_PLACEHOLDER,
  listFeatureScenarios,
  listScenarioPaths,
  type ScenarioRunResult,
} from '../services/scenarios'
import { updateSettings } from '../services/settings'
import { NOTIFY_MAX_CHARS, toolNotifyHuman } from './notify-tool'
import { registerOrchestratorRunTools } from './orchestrator-run-tools'
import { recordFeatureAction, registerOrchestratorTools, requireProjectFeature } from './orchestrator-tools'
import { MCP_READ_CEILING_CHARS, serializedLength } from './read-ceiling'
import { CHARTER_DOC_KEY, contentSha, featureDocKey, recordSent, sentSha, tellOnce } from './sent-memory'

/**
 * runcastle MCP server (SPEC §6) — zod-validated tools over Streamable HTTP
 * (`@hono/mcp` + `@modelcontextprotocol/sdk` 1.29, per docs/research/STACK-NOTES §5).
 *
 * Session identity: the `X-Runcastle-Session` header set in each session's
 * `mcp.json` (forwarded by `@hono/mcp` as `requestInfo.headers`). A caller with
 * no session header falls back to the most recently created live session — a
 * convenience for a hand-run client. Every agent runcastle launches on the host
 * carries its session header; a sandboxed worker never reaches this server at
 * all (its tools are relayed, `workers/tools.ts`).
 *
 * A fresh `McpServer` + transport is built per request (stateless mode,
 * `enableJsonResponse`) so there is no cross-request shared transport state.
 */

// --- session resolution -----------------------------------------------------

export interface HeaderCarrier {
  requestInfo?: { headers?: Record<string, string | string[] | undefined> }
}

/**
 * One identity header off a request. Both spellings are read because
 * `@hono/mcp` forwards whatever the client sent, and a header map is not
 * guaranteed to be case-folded.
 */
function identityHeader(extra: HeaderCarrier, name: string): string | undefined {
  const headers = extra.requestInfo?.headers
  if (!headers) return undefined
  const raw = headers[name.toLowerCase()] ?? headers[name]
  const value = Array.isArray(raw) ? raw[0] : raw
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function headerSessionId(extra: HeaderCarrier): string | undefined {
  return identityHeader(extra, 'X-Runcastle-Session')
}

/** Resolve the session for a tool call: header first, else the live singleton. */
export function resolveSession(ctx: AppCtx, sessionId: string | undefined): SessionRow | null {
  if (sessionId) {
    const byId = getSessionRow(ctx, sessionId)
    if (byId) return byId
  }
  return mostRecentLiveSession(ctx)
}

/**
 * The feature a tool call belongs to, or a refusal that says why.
 *
 * Every tool below this line is feature-shaped — each one advances a feature
 * through a gate — and a project-scoped session has no feature. Guarding once
 * here rather than making each tool null-check means the failure is a legible
 * message the agent can act on instead of a crash inside `getFeatureRow` — and
 * it keeps the null impossible to forget when a tool is added later, because
 * the featureId simply isn't reachable without this call.
 *
 * The refusal names the session's OWN project-scoped tools, so an agent that
 * reached for the wrong half of the surface is pointed at the right half rather
 * than just told no (the kinds are few, and each has exactly one entry point).
 */
function requireFeatureId(session: SessionRow): string {
  if (!session.featureId) {
    const instead =
      session.kind === 'project'
        ? 'Your tools are create_feature, set_feature_dependencies, get_project_context, ' +
          'get_work_record, list_project_notes, triage_project_note, update_project_note and ' +
          'record_event — ' +
          'to work an existing feature, tell the human to open its terminal.'
        : 'Use record_finding to store what you establish about the project.'
    throw new GateError(
      `this tool belongs to a feature, and a ${session.kind} session is project-scoped. ${instead}`,
    )
  }
  return session.featureId
}

// --- tool implementations (pure over AppCtx + session — unit-tested) ---------

/** Who a feature READ is for: the feature to read. */
export interface FeatureReader {
  featureId: string
  /** The conversation reading, when the caller is one — what its sent-memory is keyed by. A worker's relayed read has none and reads in full. */
  sessionId?: string
}

/** The feature a session's read tool serves: its own, through the guard that refuses project-scoped kinds. */
export function resolveFeatureReader(session: SessionRow): FeatureReader {
  return { featureId: requireFeatureId(session), sessionId: session.id }
}

/**
 * The feature a PROJECT session reads: any feature of its own project, named by
 * slug. The orchestrator sees the whole portfolio, and as the orchestrator
 * it reads features through these tools (`one-orchestrator-no-mode`).
 */
export function projectFeatureReader(
  ctx: AppCtx,
  session: SessionRow,
  slug: string,
): FeatureReader {
  const project = requireProject(ctx, session)
  const [featureId] = featureIdsBySlug(ctx, project.id, [slug])
  return { featureId: featureId as string, sessionId: session.id }
}

/** A merge-order dependency as an agent sees it: the slug it holds, and whether it shipped. */
export interface DependencyMark {
  slug: string
  satisfied: boolean
}

function dependencyMark(d: DependencyRef): DependencyMark {
  return { slug: d.slug, satisfied: d.satisfied }
}

/** One doc this payload did NOT inline, addressed well enough to go and get. */
export interface FeatureDocRef {
  relPath: string
  title: string
  /** Size of the file on disk, so the agent can budget before fetching it. */
  bytes: number
  /**
   * Why it was left out, for the docs the contract withholds by name
   * (`WITHHELD_FEATURE_DOCS`). Absent for an ordinary uncanonical doc — those
   * are simply not part of the digest, which is not the same as discouraged.
   */
  withheld?: string
}

/**
 * A defect in the fields a session needs to act on it: what the review found
 * and how to reproduce it, plus the id `resolve_finding` names it by.
 */
export interface OpenDefect {
  /** What `resolve_finding`'s `findingId` takes. */
  id: string
  title: string
  location: string
  detail: string
  reproStep: string
}

/** Where a Review worker's pass left its evidence (burns-become-workers decision 4); its account is its handback. */
export interface WorkerReviewEvidence {
  workerId: string
  label: string
  status: WorkerStatusT
  reviewMode: 'drive' | 'gates' | null
  /** Its hand-back account; null when it failed before handing back. */
  account: string | null
  /** `~/.runcastle/reviews/<workerId>/`: `walkthrough.webm` and the pictures in `saw/`. */
  dir: string
}

/** A canonical doc that did not fit under the never-hidden ceiling, and how to get it. */
export interface NotInlinedDoc {
  relPath: string
  /** The file on disk, in the reader's checkout when there is one. */
  absPath: string
  bytes: number
  /** Why it is missing, and the instruction to read it before acting. */
  reason: string
}

/** A canonical doc sent whole. */
export interface FeatureDocBody {
  relPath: string
  content: string
}

/** Said in every stub, so a subagent sharing its parent's session can still recover the doc. */
export const UNCHANGED_DOC_NOTE =
  'unchanged since this session last received it; read it at absPath or with read_feature_doc if it is not in view'

/**
 * A canonical doc this conversation was already sent and that has not changed
 * since (`tools-and-skills-say-less` decisions 1, 16). It carries enough to
 * read the doc again on its own: a subagent shares its parent's session, so it
 * may get a stub for a doc it never saw.
 */
export interface UnchangedDoc {
  relPath: string
  absPath: string
  sha: string
  unchanged: true
  note: typeof UNCHANGED_DOC_NOTE
}

/** How a conversation's read of the feature context is deduplicated. */
export interface FeatureContextReadOptions {
  /** Stub the docs this reader's session already holds, and remember what is sent. */
  dedupe?: boolean
  /** Resend every doc whole (still remembering what was sent). */
  full?: boolean
}

/**
 * Key order is part of the contract: `JSON.stringify` keeps insertion order,
 * and `featureContext` builds this header first so the decision-critical fields
 * reach the agent in the first few hundred characters, never at the tail.
 */
export interface FeatureContext {
  feature: ReturnType<typeof getFeatureRow>
  /**
   * The merge-order edges (ADR-0013): what this feature waits on — or, once
   * started, waited on — each with whether it has shipped, and the drafts still
   * waiting on THIS feature. A feature session must know it is holding something
   * up before it suggests an archive or a scope widening (decision 8).
   */
  dependsOn: DependencyMark[]
  blocks: { slug: string; upNext: boolean }[]
  /** This feature's own up-next mark: it starts by itself when its dependencies ship. */
  upNext: boolean
  /** The name of the project thread holding it (`threads-hold-features`); null when none does. */
  heldBy: string | null
  /**
   * The canonical docs (`AGENT_DIGEST_DOCS`) that fit under the never-hidden
   * ceiling, whole, in fill order: brief → decisions → spec. On a repeat read
   * by the same conversation, a doc it already holds comes as an
   * {@link UnchangedDoc} stub instead.
   */
  docs: (FeatureDocBody | UnchangedDoc)[]
  /**
   * The canonical docs that did NOT fit — never truncated, moved out whole with
   * a path to read them by. Empty when every one fit.
   */
  notInlined: NotInlinedDoc[]
  /** Every other doc that exists, as an index — fetch one with `read_feature_doc`. */
  moreDocs: FeatureDocRef[]
  /** Says, in the payload itself, that `moreDocs` and `notInlined` are fetchable rather than gone. */
  docsNote: string
  /**
   * The defects the feature's reviews reported that nothing has resolved yet,
   * each with the fields a session needs to act on it. They live only in the
   * `review_findings` table — no doc renders them — and each stays open until
   * its fix ticket lands or the agent marks it addressed or dismissed.
   */
  openDefects: OpenDefect[]
  /**
   * Where the latest review pass left its evidence on disk — its account (the
   * Review worker's handback), the walkthrough beside it, and how that pass
   * ended. Null until a pass has finished: the newest Review worker that
   * handed back or failed.
   */
  reviewEvidence: WorkerReviewEvidence | null
  /** The pictures reviews kept, newest pass first. Empty when none took any. */
  reviewShots: ReviewShots[]
  /**
   * The feature's recorded designs (`show_design`), each with its state, who
   * approved it, and whether the human opened it since it was last shown: where
   * the lead reads the human's quiet approvals (designs decisions 10, 25).
   */
  designs: LeadDesign[]
  /**
   * The feature's workers (interactive-workers), oldest first: each one's
   * status, its latest handback and what the lead did with it. Message, land,
   * send back or drop one by its `id`.
   */
  workers: LeadWorker[]
  /**
   * Every finding the latest review pass reported, resolved ones included — the
   * record of the pass, where `openDefects` is the work left. A defect already
   * stated there is not repeated here: stating each one twice would push the
   * lead's to-do past the ceiling. Empty when that pass reported nothing.
   */
  findings: ReviewFinding[]
  /**
   * The models the operator annotated with a use-case note, and the only ones a
   * worker may be assigned. Notes ARE the opt-in: an operator who annotated
   * nothing gets an empty array here, and the lead then never assigns a model.
   */
  annotatedModels: AnnotatedModel[]
  /**
   * The lead's loop: the newest ready declaration; whether a drive of this
   * feature holds the drive slot; whether the human pressed Stop and has not
   * replied since (nothing starts either); and why the feature waits on the
   * human, if it does.
   */
  latestReady: ReadyDeclaration | null
  driveActive: boolean
  stopped: boolean
  waitingReason: string | null
  /** Which kind of wait `waitingReason` is (answer, plan, design, stuck); null when nothing is waited on. */
  waitingKind: WaitingKind | null
  /** When the human last typed in this feature's chat; null if they never have. */
  humanTypedAt: number | null
  /**
   * Whether this feature can ship a scenario, and what it would build on
   * (drive-scenarios decision 13): the planner cards one only when `setUp`.
   * Present on every MCP reply; a direct caller that read no git leaves it out.
   */
  scenarios?: FeatureScenarios
}

/** The project's scenario state as a planning session sees it. */
export interface FeatureScenarios {
  /** The base branch has `.runcastle/scenarios/` AND a scenario runner is recorded. */
  setUp: boolean
  runnerConfigured: boolean
  /** The scenarios at the feature branch, this feature's own first. */
  scenarios: ScenarioEntry[]
  /** The `_` shared-code paths at the feature branch, to reuse rather than rewrite. */
  fixtures: string[]
}

/** {@link FeatureScenarios}, read from git at the feature branch and its base. */
export async function featureScenarios(ctx: AppCtx, featureId: string): Promise<FeatureScenarios> {
  const feature = getFeatureRow(ctx, featureId)
  const project = projectForFeature(ctx, feature)
  // No recorded base (a draft) means no base to be set up on — never a guessed `main`.
  const [basePaths, branchPaths, { runnerConfigured, scenarios }] = await Promise.all([
    feature.baseBranch ? listScenarioPaths(project.repoPath, feature.baseBranch) : [],
    listScenarioPaths(project.repoPath, feature.branch),
    listFeatureScenarios(project, feature),
  ])
  return {
    setUp: basePaths.length > 0 && runnerConfigured,
    runnerConfigured,
    scenarios,
    fixtures: branchPaths.filter((path) => path.split('/').some((segment) => segment.startsWith('_'))),
  }
}

const DOCS_NOTE =
  'docs[] holds this feature’s canonical docs in full. notInlined[] lists any canonical doc ' +
  'too large to fit this reply without hiding it — never truncated, just moved out: read each ' +
  'one before acting, with read_feature_doc({ relPath }) or the file at its absPath. ' +
  'moreDocs[] is everything else that exists in docs/features/<slug>/ — not inlined, not ' +
  'gone: read any of them with read_feature_doc({ relPath }). A `withheld` reason means it ' +
  'was left out on purpose; fetch it anyway if a ticket points at it.'

function notInlinedReason(relPath: string): string {
  return (
    'Not inlined: too large to fit this reply without hiding it. Read it before acting: ' +
    `read_feature_doc({ relPath: '${relPath}' }) or the file at absPath.`
  )
}

/**
 * Everything true of the feature right now, sized to be READ rather than
 * skimmed.
 *
 * The rule is `packages/core/src/docs.ts`: inline the four canonical docs, index
 * the rest. Before that rule this tool inlined every `.md` in the directory in
 * full, which on this repo's own `ux-issues` feature came to ~189 KB in a single
 * reply — most of it the previous lap's `outcome.md` and its already-triaged
 * `test-notes.md`, i.e. the postmortem of work the session was being asked to
 * continue past. An allowlist plus an index costs one extra call for the rare
 * doc that is actually wanted, and nothing at all for the common case.
 *
 * The whole reply stays under {@link MCP_READ_CEILING_CHARS}, past which Claude
 * Code hides it from the agent. Nothing is ever truncated: a canonical doc that
 * does not fit moves out whole to `notInlined`, a half-shown doc being worse
 * than a plainly missing one.
 */
export function featureContext(
  ctx: AppCtx,
  reader: FeatureReader,
  scenarios?: FeatureScenarios,
  options: FeatureContextReadOptions = {},
): FeatureContext {
  const feature = getFeatureRow(ctx, reader.featureId)
  const openDefects = openDefectsOf(ctx, feature.id).map(toOpenDefect)
  const latestReviewWorker = listWorkers(ctx, feature.id)
    .filter((w) => w.kind === 'review' && (w.handbackSummary !== null || w.status === 'failed'))
    .at(-1)
  const stated = new Set(openDefects.map((defect) => defect.id))
  const findings = listReviewFindings(ctx, feature.id).filter(
    (finding) => !!latestReviewWorker && finding.reviewWorkerId === latestReviewWorker.id && !stated.has(finding.id),
  )
  const withheldDocs = WITHHELD_FEATURE_DOCS

  const project = projectForFeature(ctx, feature)
  const docsDir = featureDocsDir(project, feature)
  const canonical: { doc: { relPath: string; content: string }; ref: NotInlinedDoc }[] = []
  const moreDocs: FeatureDocRef[] = []
  for (const summary of listDocs(ctx, feature)) {
    const content = docContentOrEmpty(ctx, feature, summary.relPath)
    if (isAgentDigestDoc(summary.relPath)) {
      canonical.push({
        doc: { relPath: summary.relPath, content },
        ref: {
          relPath: summary.relPath,
          absPath: join(docsDir, summary.relPath),
          bytes: Buffer.byteLength(content, 'utf8'),
          reason: notInlinedReason(summary.relPath),
        },
      })
      continue
    }
    const withheld = withheldDocs[summary.relPath.toLowerCase()]
    moreDocs.push({
      relPath: summary.relPath,
      title: summary.title,
      bytes: Buffer.byteLength(content, 'utf8'),
      ...(withheld ? { withheld } : {}),
    })
  }
  // Fill order (decisions.md #5), not the reading order `agentDigestDocOrder` gives.
  canonical.sort((a, b) => agentDigestFillRank(a.doc.relPath) - agentDigestFillRank(b.doc.relPath))

  const holder = holderOf(ctx, feature)
  const header = {
    feature,
    latestReady: listReadyDeclarations(ctx, feature.id).at(-1) ?? null,
    driveActive: git.activeTestDriveFeatureId(project.id) === feature.id,
    stopped: feature.stoppedAt !== null,
    waitingReason: feature.waitingReason,
    waitingKind: feature.waitingKind,
    humanTypedAt: humanTypedAt(ctx, feature.id),
    dependsOn: dependsOnOf(ctx, feature.id).map(dependencyMark),
    blocks: blocksOf(ctx, feature.id).map((b) => ({ slug: b.slug, upNext: b.upNext })),
    upNext: feature.upNext,
    heldBy: holder ? holderName(holder) : null,
    annotatedModels: annotatedModels(ctx),
    ...(scenarios ? { scenarios } : {}),
    reviewEvidence: latestReviewWorker ? workerReviewEvidenceOf(latestReviewWorker) : null,
    reviewShots: reviewShots(ctx, feature.id),
    designs: leadDesigns(ctx, feature.id),
    workers: leadWorkers(ctx, feature.id),
  }
  const toDo = { openDefects, findings }
  // Built in priority order, and JSON keeps that order: the header the incident
  // hid at the tail of an 80K reply now opens it (decisions.md #6).
  const assemble = (docs: FeatureContext['docs'], notInlined: NotInlinedDoc[]): FeatureContext => ({
    ...header,
    ...toDo,
    docs,
    notInlined,
    moreDocs,
    docsNote: DOCS_NOTE,
  })
  const allDocsOut = canonical.map((c) => c.ref)
  const fits = (context: FeatureContext) => serializedLength(context) <= MCP_READ_CEILING_CHARS

  // Docs are moved out first, because they are the one part with a cheap,
  // well-known fetch — so they only claim room the rest leaves. The header and
  // the to-do never move.

  // A conversation re-reading gets a stub for each doc it already holds
  // unchanged (decision 1); a run caller has no session and always reads whole.
  const sessionId = options.dedupe ? reader.sessionId : undefined
  const stubFor = (doc: FeatureDocBody, ref: NotInlinedDoc): UnchangedDoc | null => {
    if (!sessionId || options.full) return null
    const sha = contentSha(doc.content)
    if (sentSha(sessionId, featureDocKey(feature.id, doc.relPath)) !== sha) return null
    return { relPath: doc.relPath, absPath: ref.absPath, sha, unchanged: true, note: UNCHANGED_DOC_NOTE }
  }

  // Every canonical doc starts in `notInlined`, and each is inlined in fill
  // order only if the WHOLE reply still fits — measured with the later docs'
  // index entries still counted, so the final shape is the one checked. A stub
  // is measured as a stub, so the room it frees can take a later doc whole.
  let context = assemble([], allDocsOut)
  for (const { doc, ref } of canonical) {
    const candidate = assemble(
      [...context.docs, stubFor(doc, ref) ?? doc],
      context.notInlined.filter((r) => r !== ref),
    )
    if (fits(candidate)) context = candidate
  }
  if (sessionId) {
    for (const sent of context.docs) {
      if ('content' in sent) recordSent(sessionId, featureDocKey(feature.id, sent.relPath), contentSha(sent.content))
    }
  }
  return context
}

/** {@link featureContext} with its git-read scenarios block — what every MCP reply carries. */
export async function featureContextWithGit(
  ctx: AppCtx,
  reader: FeatureReader,
  options: FeatureContextReadOptions = {},
): Promise<FeatureContext> {
  return featureContext(ctx, reader, await featureScenarios(ctx, reader.featureId), options)
}

// A worker's `read_feature` reads the lead's same bundle (interactive-workers decision 9).
provideWorkerFeatureRead((ctx, featureId) => featureContextWithGit(ctx, { featureId }))

/**
 * A feature as the orchestrator reads it by default (`tools-and-skills-say-less`
 * decision 2): where it is and whether it needs the orchestrator, with worker
 * counts rather than rows and a docs index rather than bodies. `full: true`
 * gets the lead's whole bundle instead.
 */
export interface FeatureStatusView {
  slug: string
  title: string
  status: FeatureStatusT
  waitingReason: string | null
  waitingKind: WaitingKind | null
  heldBy: string | null
  humanTypedAt: number | null
  /** How many of the feature's workers are in each status; a status with none is absent. */
  workerCounts: Partial<Record<WorkerStatusT, number>>
  latestReady: ReadyDeclaration | null
  /** Defects the feature's reviews reported that nothing has resolved yet. */
  openFindings: number
  designs: { title: string; state: DesignState }[]
  baseBranch: string | null
  dependsOn: DependencyMark[]
  /** Every doc in the feature's docs dir, by size; read one with read_feature_doc. */
  docs: { relPath: string; bytes: number }[]
}

export function featureStatusView(ctx: AppCtx, reader: FeatureReader): FeatureStatusView {
  const feature = getFeatureRow(ctx, reader.featureId)
  const workerCounts: Partial<Record<WorkerStatusT, number>> = {}
  for (const w of listWorkers(ctx, feature.id)) workerCounts[w.status] = (workerCounts[w.status] ?? 0) + 1
  const holder = holderOf(ctx, feature)
  return {
    slug: feature.slug,
    title: feature.title,
    status: feature.status,
    waitingReason: feature.waitingReason,
    waitingKind: feature.waitingKind,
    heldBy: holder ? holderName(holder) : null,
    humanTypedAt: humanTypedAt(ctx, feature.id),
    workerCounts,
    latestReady: listReadyDeclarations(ctx, feature.id).at(-1) ?? null,
    openFindings: openDefectsOf(ctx, feature.id).length,
    designs: leadDesigns(ctx, feature.id).map(({ title, state }) => ({ title, state })),
    baseBranch: feature.baseBranch ?? null,
    dependsOn: dependsOnOf(ctx, feature.id).map(dependencyMark),
    docs: listDocs(ctx, feature).map((summary) => ({
      relPath: summary.relPath,
      bytes: Buffer.byteLength(docContentOrEmpty(ctx, feature, summary.relPath), 'utf8'),
    })),
  }
}

/** A feature doc's text, or empty when it cannot be read — indexed, never fatal. */
function docContentOrEmpty(ctx: AppCtx, feature: ReturnType<typeof getFeatureRow>, relPath: string): string {
  try {
    return readDoc(ctx, feature, relPath).content
  } catch {
    return ''
  }
}

function workerReviewEvidenceOf(w: WorkerRow): WorkerReviewEvidence {
  return {
    workerId: w.id,
    label: w.label,
    status: w.status,
    reviewMode: w.reviewMode,
    account: w.handbackSummary,
    dir: reviewDir(w.id),
  }
}

function toOpenDefect(defect: ReviewFinding): OpenDefect {
  return {
    id: defect.id,
    title: defect.title,
    location: defect.location,
    detail: defect.detail,
    reproStep: defect.reproStep,
  }
}

export function toolGetFeatureContext(ctx: AppCtx, session: SessionRow): FeatureContext {
  return featureContext(ctx, { featureId: requireFeatureId(session) })
}

/**
 * One feature doc, in full — the other half of the digest contract.
 *
 * `get_feature_context` indexes what it does not inline; this is how the index
 * is cashed in. `readDoc` is the traversal-guarded reader the tRPC surface
 * already uses, so a `relPath` that climbs out of the docs dir is refused here
 * exactly as it is there.
 */
export function toolReadFeatureDoc(
  ctx: AppCtx,
  reader: FeatureReader,
  input: { relPath: string },
): { relPath: string; content: string } {
  const feature = getFeatureRow(ctx, reader.featureId)
  return { relPath: input.relPath, content: readDoc(ctx, feature, input.relPath).content }
}

// --- the lead's tools -------------------------------------------------------

/**
 * The feature a LEAD tool acts on: the feature's own chat is its lead, and no
 * other kind dispatches, stops or declares — a drive-fix session repairs one
 * failed drive and is not the feature's owner.
 */
function requireLeadFeatureId(session: SessionRow): string {
  const featureId = requireFeatureId(session)
  if (session.kind === 'side') {
    throw new GateError(
      "only the feature's main chat leads its rounds — a side session cannot dispatch, stop or " +
        'declare ready. Tell the human to ask the main chat.',
    )
  }
  if (session.kind === 'worker') {
    throw new GateError("a worker cannot use its lead's tools: its only way to change the feature is its handback (hand_back)")
  }
  if (session.kind !== 'chat') {
    throw new GateError(`only the feature's chat leads its rounds — a ${session.kind} session cannot`)
  }
  return featureId
}

// --- the lead's workers (interactive-workers) ---------------------------------

export async function toolStartWorker(
  ctx: AppCtx,
  session: SessionRow,
  input: { label: string; purpose: string; kind: 'with-you' | 'on-its-own'; goal: string; doneWhen: string; model?: string },
): Promise<StartedWorker> {
  const feature = getFeatureRow(ctx, requireLeadFeatureId(session))
  requireNotStopped(feature)
  return startWorker(ctx, feature, { ...input, startedBy: 'lead' })
}

/** The lead starts the feature's Review worker (burns-become-workers decisions 3, 4): a first review, or a verify review of the given fixes. */
export async function toolStartReview(
  ctx: AppCtx,
  session: SessionRow,
  input: { mode?: 'drive' | 'gates'; verify?: { findingIds: string[]; commits: string[] }; model?: string },
): Promise<StartedReview> {
  const feature = getFeatureRow(ctx, requireLeadFeatureId(session))
  requireNotStopped(feature)
  return startReviewWorker(ctx, feature, { ...input, startedBy: 'lead' })
}

/** The Review worker this session is, on the host: its own `hand_back`, `review_drive` and `report_finding` act on it alone. */
function hostReviewOf(ctx: AppCtx, session: SessionRow | undefined): WorkerRow | undefined {
  if (session?.kind !== 'worker') return undefined
  const w = getWorker(ctx, session.id)
  return w && isHostReview(w) ? w : undefined
}

/**
 * A drive review's hand-back (burns-become-workers decision 4): its account,
 * read when its turn ends, when runcastle gives the drive back and posts its
 * Review Package to the lead.
 */
export function toolReviewHandBack(ctx: AppCtx, session: SessionRow, input: { summary: string }): { handedBack: true } {
  const w = hostReviewOf(ctx, session)
  if (!w) throw new GateError(`hand_back here belongs to a Review worker, and this is a ${session.kind} session.`)
  return handBackOnHost(w, input.summary)
}

/**
 * A drive worker's hand-back (drive-chats-become-workers): its summary, written
 * where a host worker's handback is read when its turn ends.
 */
export function toolDriveWorkerHandBack(ctx: AppCtx, session: SessionRow, input: { summary: string }): { handedBack: true } {
  const w = driveWorkerOf(ctx, session)
  if (!w) throw new GateError(`hand_back here belongs to a drive worker, and this is a ${session.kind} session.`)
  return handBackOnHost(w, input.summary)
}

function handBackOnHost(w: WorkerRow, summary: string): { handedBack: true } {
  const trimmed = summary.trim()
  if (!trimmed) throw new InvalidInputError('a handback needs a summary')
  writeHostHandback(w.id, trimmed)
  return { handedBack: true }
}

export async function toolMessageWorker(ctx: AppCtx, session: SessionRow, input: { workerId: string; text: string }): Promise<{ ok: true }> {
  const worker = requireFeatureWorker(ctx, requireLeadFeatureId(session), input.workerId)
  requireNotStopped(getFeatureRow(ctx, workerFeatureId(worker)))
  return messageWorker(ctx, worker.id, input.text)
}

export async function toolLandWorker(ctx: AppCtx, session: SessionRow, input: { workerId: string }): Promise<LandWorkerResult> {
  const worker = requireFeatureWorker(ctx, requireLeadFeatureId(session), input.workerId)
  return landWorker(ctx, worker.id)
}

export async function toolSendBackWorker(ctx: AppCtx, session: SessionRow, input: { workerId: string; note: string }): Promise<{ ok: true }> {
  const worker = requireFeatureWorker(ctx, requireLeadFeatureId(session), input.workerId)
  requireNotStopped(getFeatureRow(ctx, workerFeatureId(worker)))
  return sendBackWorker(ctx, worker.id, input.note)
}

export async function toolDropWorker(ctx: AppCtx, session: SessionRow, input: { workerId: string }): Promise<{ ok: true }> {
  const worker = requireFeatureWorker(ctx, requireLeadFeatureId(session), input.workerId)
  return dropWorker(ctx, worker.id)
}

export function toolDeclareReady(
  ctx: AppCtx,
  session: SessionRow,
  input: { scenario: string },
): { ok: true; waitingReason: string | null } {
  const featureId = requireLeadFeatureId(session)
  declareReady(ctx, featureId, input)
  return { ok: true, waitingReason: getFeatureRow(ctx, featureId).waitingReason }
}

/**
 * A lead hands back to its owner chat, or on a human-owned feature to its chat
 * (agents-are-woken-only-when-it-matters decisions 20–22; every-feature-has-one-owner
 * decisions 14, 20). `planAgreed` at the human's plan yes passes a feature its
 * chat finishes to that chat first.
 */
export async function toolHandBack(
  ctx: AppCtx,
  session: SessionRow,
  input: { summary: string; planAgreed?: boolean },
): Promise<{ deliveredTo: string; state: string; passed?: true }> {
  return handBackToOrchestrator(ctx, getFeatureRow(ctx, requireLeadFeatureId(session)), input.summary, {
    planAgreed: input.planAgreed === true,
  })
}

/**
 * The lead waits on the human. Refused under a chat owner (every-feature-has-one-owner
 * decision 18): that lead talks to its chat with `hand_back`.
 */
export function toolWaitForYou(
  ctx: AppCtx,
  session: SessionRow,
  input: { why: string; kind?: WaitingKind },
): { ok: true; waitingReason: string | null; waitingKind: WaitingKind | null } {
  const featureId = requireLeadFeatureId(session)
  const feature = getFeatureRow(ctx, featureId)
  if (feature.heldBy && feature.status !== 'shipped') {
    throw new GateError(`"${chatNameOf(ctx, feature.heldBy)}" owns this feature: bring it to them with hand_back.`)
  }
  setWaiting(ctx, featureId, input.why, input.kind)
  const { waitingReason, waitingKind } = getFeatureRow(ctx, featureId)
  return { ok: true, waitingReason, waitingKind }
}

/** The feature a DESIGN tool acts on: design mode belongs to the feature's own chat. */
function requireChatFeatureId(session: SessionRow): string {
  const featureId = requireFeatureId(session)
  if (session.kind !== 'chat') {
    throw new GateError(`design mode belongs to the feature's chat — a ${session.kind} session cannot use it`)
  }
  return featureId
}

export function toolStartDesignServer(
  ctx: AppCtx,
  session: SessionRow,
  input: { command?: string },
): Promise<DesignServerInfo> {
  const featureId = requireChatFeatureId(session)
  // An unattended run owns the server it starts, so its end stops it (designs-wait-for-you decision 3).
  return startDesignServer(ctx, featureId, input.command, unattended(session) ? { sessionId: session.id } : {})
}

/** A run with no human watching: a headless run, or a self-planning one. */
function unattended(session: SessionRow): boolean {
  return session.headless || session.purpose === 'self-plan'
}

/**
 * The views `show_panel` opens (decision 8). The plan and a design are not among
 * them: `show_plan` and `show_design` show those, leaving a card in the chat
 * (designs-and-the-plan-get-their-own-place decision 3).
 */
const PanelView = z.enum(['work', 'review', 'details', 'drive'], {
  error: 'show_panel opens work, review, details or drive. Show the plan with show_plan and a design with show_design',
})
type PanelViewT = z.infer<typeof PanelView>

/** Every view a `panel.show` event can open: `show_panel`'s, and the plan and the design view the card tools open. */
type PanelOpenView = PanelViewT | 'plan' | 'design'

/**
 * The `panel.show` event the web opens a view on — always the agent's own act,
 * whether it asked by name (`show_panel`), showed the plan or a design, or
 * emitted tickets.
 */
function emitPanelShow(
  ctx: AppCtx,
  featureId: string,
  input: { view: PanelOpenView; path?: string; width?: number },
): void {
  const width = input.view === 'design' ? input.width : undefined
  const where = `${input.path ? ` at ${input.path}` : ''}${width !== undefined ? `, ${width}px wide` : ''}`
  emit(ctx, featureId, {
    type: 'panel.show',
    message: `opened the ${input.view} panel${where}`,
    data: {
      view: input.view,
      ...(input.path ? { path: input.path } : {}),
      ...(width !== undefined ? { width } : {}),
    },
  })
}

/** Open the human's panel on a view. */
export function toolShowPanel(ctx: AppCtx, session: SessionRow, input: { view: PanelViewT }): { ok: true } {
  emitPanelShow(ctx, requireChatFeatureId(session), input)
  return { ok: true }
}

/**
 * Show a design (designs-and-the-plan-get-their-own-place decisions 1, 15, 18):
 * record it for the feature, post its card in this chat, and, with a human
 * watching, open the Design view on it. `picture` is copied into runcastle's own
 * store with `show_file`'s reach.
 */
export function toolShowDesign(
  ctx: AppCtx,
  session: SessionRow,
  input: { path: string; title?: string; width?: number; picture?: string; slug?: string },
): { recorded: true; state: DesignState } {
  if (!session.featureId) return showRecordedDesign(ctx, session, { slug: input.slug ?? '', path: input.path })
  const featureId = requireChatFeatureId(session)
  const title = input.title?.trim()
  if (!title) throw new InvalidInputError('show_design needs a `title`: the screen the design is, in a few words.')
  // A design nobody can serve later is a dead card: as the skill says, it needs
  // a running server or a recorded command to open from.
  const server = designServerStatus(ctx, featureId)
  if (!server.running && !server.hasRecordedCommand) {
    throw new GateError('no design server runs and none is recorded — call start_design_server with a command first')
  }
  const picture = input.picture
    ? copyDesignPicture(featureId, showableFile(ctx, session, input.picture, 'show_design').real)
    : undefined
  const design = recordDesign(ctx, featureId, { path: input.path, title, width: input.width, picture })
  seedFromTranscript(ctx, session.id)
  appendThreadEvent(session.id, { type: 'design_shown', designId: design.id, featureId })
  if (!unattended(session)) {
    rememberDesignPath(featureId, design.path)
    emitPanelShow(ctx, featureId, { view: 'design', path: design.path, ...(input.width ? { width: input.width } : {}) })
  }
  return { recorded: true, state: design.state }
}

/** The docs that make a feature's plan: one of them must exist before the plan can be shown. */
const PLAN_DOCS = ['preview.html', 'decisions.md', 'spec.md']

/**
 * Show the feature's plan (decisions 2, 15): post a plan card in this chat, make
 * the plan new to the human, and, with a human watching, open the Plan view.
 */
export function toolShowPlan(ctx: AppCtx, session: SessionRow, input: { slug?: string } = {}): { shown: true } {
  // An orchestrator chat posts a feature's plan card in its own chat (every-feature-has-one-owner
  // decision 3): the same card, opening the feature's Plan tab. It reads, so it needs no hold,
  // and it leaves the plan's "new to the human" mark to the lead.
  const fromChat = !session.featureId
  const feature = fromChat
    ? requireProjectFeature(ctx, session, input.slug ?? '')
    : getFeatureRow(ctx, requireChatFeatureId(session))
  const featureId = feature.id
  const docsDir = featureDocsDir(projectForFeature(ctx, feature), feature)
  if (!PLAN_DOCS.some((doc) => existsSync(join(docsDir, doc)))) {
    throw new GateError(
      `${feature.slug} has no plan yet: write its plan page (preview.html), decisions.md or spec.md in ${docsDir} first`,
    )
  }
  if (!fromChat) markPlanShown(ctx, featureId)
  seedFromTranscript(ctx, session.id)
  appendThreadEvent(session.id, { type: 'plan_shown', featureId })
  if (!fromChat && !unattended(session)) emitPanelShow(ctx, featureId, { view: 'plan' })
  return { shown: true }
}

/**
 * `show_design` from an orchestrator chat (decisions 3, 27): post the card of a
 * design the feature's lead already recorded, found by its path, in this chat.
 * It records nothing and never approves: a design waits for the human's own yes.
 */
function showRecordedDesign(
  ctx: AppCtx,
  session: SessionRow,
  input: { slug: string; path: string },
): { recorded: true; state: DesignState } {
  const feature = requireProjectFeature(ctx, session, input.slug)
  const path = input.path.trim().startsWith('/') ? input.path.trim() : `/${input.path.trim()}`
  const design = listDesigns(ctx, feature.id).find((d) => d.path === path)
  if (!design) {
    const known = listDesigns(ctx, feature.id).map((d) => d.path)
    throw new GateError(
      `${feature.slug}'s lead has recorded no design at ${path}` +
        (known.length ? `; its designs: ${known.join(', ')}` : '; it has recorded none yet'),
    )
  }
  seedFromTranscript(ctx, session.id)
  appendThreadEvent(session.id, { type: 'design_shown', designId: design.id, featureId: feature.id })
  return { recorded: true, state: design.state }
}

/** Record a yes or a rejection the human gave in words for a design (decisions 8, 20). */
export function toolSetDesignState(
  ctx: AppCtx,
  session: SessionRow,
  input: { path: string; state: 'approved' | 'dropped' },
): { ok: true; state: DesignState } {
  return { ok: true, state: setDesignState(ctx, requireChatFeatureId(session), input).state }
}

/**
 * The two dispositions a session spends on a defect without carding work for it.
 * The third — LINK — needs no verb here: it rides `emit_tickets`, because a
 * ticket carrying `originFindingId` already says everything a link means.
 */
const ResolveFindingShape = {
  findingId: z.string().min(1).describe('The finding id, from `openDefects`.'),
  disposition: z
    .enum(['addressed', 'dismissed'])
    .describe('`addressed`: work already answers it. `dismissed`: not worth fixing.'),
  note: z.string().optional().describe('REQUIRED: what addressed it, or why it was dismissed.'),
}

/**
 * Cross-field, so it cannot live in the raw shape MCP publishes: a closure
 * with no note is a closure with no evidence, which is the state this whole
 * feature exists to stop a finding drifting into.
 */
const ResolveFindingInput = z.object(ResolveFindingShape).superRefine((input, refinement) => {
  if (!input.note?.trim()) {
    refinement.addIssue({
      code: 'custom',
      path: ['note'],
      message:
        input.disposition === 'addressed'
          ? 'closing a defect as addressed requires a note saying what addressed it'
          : 'dismissing a defect requires a note saying why',
    })
  }
})

export type ResolveFindingInputT = z.input<typeof ResolveFindingInput>

/**
 * Resolve one open defect: close it as addressed because work already answers
 * it, or dismiss it. A finding stays open until one of these, or until its fix
 * ticket lands.
 *
 * The refinement is applied HERE rather than at the registration, so this
 * function is the one place a closure with no note is refused — whether the
 * caller is the MCP handler or a test at this seam.
 */
export function toolResolveFinding(
  ctx: AppCtx,
  session: SessionRow,
  input: ResolveFindingInputT,
): FindingReceipt {
  const featureId = requireFeatureId(session)
  const { findingId, disposition, note } = ResolveFindingInput.parse(input)
  // A finding of this feature that already closed itself (its fix ticket
  // landed) met the caller's intent: answer with its state rather than the
  // service's refusal (`tools-and-skills-say-less` decision 4). A foreign or
  // unknown finding falls through to the service, which still refuses it.
  const current = listReviewFindings(ctx, featureId).find((finding) => finding.id === findingId)
  if (current && (current.status === 'fixed' || current.status === 'dismissed')) {
    return { ok: true, findingId, status: current.status, alreadyClosed: true }
  }
  const finding =
    disposition === 'addressed'
      ? closeAsAddressed(ctx, featureId, findingId, note ?? '')
      : dismissAsAgent(ctx, featureId, findingId, note ?? '')
  return { ok: true, findingId, status: finding.status }
}

/** What `resolve_finding` answers with: the finding's status now, never the row. */
export interface FindingReceipt {
  ok: true
  findingId: string
  status: ReviewFinding['status']
  /** It had already closed before this call, which changed nothing. */
  alreadyClosed?: true
}

/**
 * The one tool both halves of the surface share, so it emits at whatever scope
 * the calling session has: a feature's timeline for every pipeline kind, the
 * project's for a project-scoped session (`feature_id` null, which the events
 * table already supports). An orchestrator has milestones worth recording —
 * features created, a charter drafted — and refusing them a note would leave
 * the project stream blind to the one session that works at its scope.
 */
export function toolRecordEvent(
  ctx: AppCtx,
  session: SessionRow,
  input: { type: string; message: string },
): { ok: true } {
  const event = emitForSession(ctx, session, {
    type: input.type,
    message: input.message,
    data: { source: 'mcp' },
  })
  if (!event) {
    throw new GateError(
      `session ${session.id} belongs to neither a feature nor a project — nothing to record against`,
    )
  }
  return { ok: true }
}

// --- project-scoped tools (`project` sessions) ------------------------------

/**
 * The project a project-scoped tool call belongs to, or a refusal that says why.
 *
 * The mirror of {@link requireFeatureId}: exactly one of the two ids is set on
 * a session row, so a feature session lands here with nothing to resolve. The
 * message stays tool-agnostic — several tools sit behind this guard now — and
 * points back at the surface the caller does have.
 */
function requireProject(ctx: AppCtx, session: SessionRow): Project {
  if (!session.projectId) {
    throw new GateError(
      `this tool belongs to a project-scoped session; this is a ${session.kind} session on a ` +
        'feature. Use get_feature_context and the pipeline tools for feature work.',
    )
  }
  const project = getProjectById(ctx, session.projectId)
  if (!project) throw new GateError(`project ${session.projectId} not found`)
  return project
}

function requireNotesProject(ctx: AppCtx, session: SessionRow): Project {
  const project = requireProject(ctx, session)
  if (session.kind !== 'project') {
    throw new GateError(
      `project note tools belong to an orchestrator, and this is a ${session.kind} session.`,
    )
  }
  return project
}

export interface ProjectNoteToolItem {
  id: string
  text: string
  createdAt: number
  /** The branch a project drive was driving when the note was taken. */
  driveBranch?: string
  /** That drive's short start commit, `+dirty` on a dirty tree. */
  driveCommit?: string
  screenshotPath?: string
  attachmentSentence?: string
}

export function toolListProjectNotes(ctx: AppCtx, session: SessionRow): ProjectNoteToolItem[] {
  const project = requireNotesProject(ctx, session)
  return listProjectNotes(ctx, project.id)
    .filter((note) => note.status === 'open')
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
    .map((note) => {
      const base = {
        id: note.id,
        text: note.text,
        createdAt: note.createdAt,
        ...(note.driveBranch ? { driveBranch: note.driveBranch } : {}),
        ...(note.driveCommit ? { driveCommit: note.driveCommit } : {}),
      }
      if (!note.screenshotUrl) return base
      return {
        ...base,
        screenshotPath: projectNotePath(note.id),
        attachmentSentence:
          `A screenshot of the problem is at ${attachmentRelPath(note.id)} in your workspace — ` +
          'Read it before starting.',
      }
    })
}

export function toolTriageProjectNote(
  ctx: AppCtx,
  session: SessionRow,
  input: { noteIds: string[]; outcome: string; featureId?: string },
): { notes: ReturnType<typeof triageProjectNotes> } {
  const project = requireNotesProject(ctx, session)
  input.noteIds.forEach((id) => {
    const note = listProjectNotes(ctx, project.id).find((candidate) => candidate.id === id)
    if (!note) throw new NotFoundError(`project note ${id} not found in this project`)
  })
  // Resolve every id to this project before the service mutates the batch.
  return { notes: triageProjectNotes(ctx, input.noteIds, input.outcome, input.featureId) }
}

export function toolUpdateProjectNote(
  ctx: AppCtx,
  session: SessionRow,
  input: { noteId: string; text: string },
): { note: ReturnType<typeof editProjectNote> } {
  const project = requireNotesProject(ctx, session)
  const note = listProjectNotes(ctx, project.id).find((candidate) => candidate.id === input.noteId)
  if (!note) throw new NotFoundError(`project note ${input.noteId} not found in this project`)
  return { note: editProjectNote(ctx, input.noteId, input.text) }
}

export interface RecordFindingResult {
  ok: true
  key: PreparedKeyT
  source: FindingSourceT
  /** Set when the write was refused because a human already owns the key. */
  skipped?: string
}

/**
 * Store one established preparation value from an interactive session.
 *
 * The provenance split is the whole point, and it is NOT "whichever process
 * wrote the row". `userSupplied` means the human gave or confirmed this value
 * verbatim, which makes it `human` — and `human` is the source that permanently
 * locks a key against future auto-overwrite. Everything the agent worked out
 * itself, even with a human watching, is `session`: better attested than a
 * headless finding, but still something a later run may improve on.
 *
 * Recording the agent's own measurement as `human` would be the damaging
 * mistake — it would silently retire the key from every future preparation run,
 * and the only way back is clearing a field the user never typed.
 *
 * The existing human-ownership rule still applies on top: a key a human already
 * set is never overwritten here, and the refusal is reported rather than
 * swallowed, so the agent can say so instead of believing it succeeded.
 */
export async function toolRecordFinding(
  ctx: AppCtx,
  session: SessionRow,
  input: { key: PreparedKeyT; value: string; evidence?: string; userSupplied?: boolean },
): Promise<RecordFindingResult> {
  const project = requireProject(ctx, session)
  const source: FindingSourceT = input.userSupplied ? 'human' : 'session'
  const none = input.value.trim() === ''
  // A "none" is a decision that this key stays empty for good, and only its
  // evidence says why — without it, it is indistinguishable from a slip.
  if (none && !input.evidence?.trim()) {
    throw new InvalidInputError(
      `recording ${input.key} as none needs evidence: say why this project has no value for it`,
    )
  }

  if (!isOverwritable(ctx, project.id, input.key) && !input.userSupplied) {
    return {
      ok: true,
      key: input.key,
      source,
      skipped: `${input.key} was set by a human and is not auto-overwritable — ask them to clear it first if it should change`,
    }
  }

  let establishedSha: string | undefined
  try {
    const mainLine = await git.detectMainBranch(project.repoPath)
    establishedSha = await git.headSha(project.repoPath, mainLine)
  } catch {
    // Preserve the finding when the repo cannot currently be inspected. Its
    // staleness will be unknown, which is safer than losing the value entirely.
  }

  recordFinding(ctx, project.id, {
    key: input.key,
    value: input.value,
    source,
    ...(input.evidence ? { evidence: input.evidence } : {}),
    ...(establishedSha ? { establishedSha } : {}),
  })

  emitProject(ctx, project.id, {
    type: 'prep.finding_recorded',
    message: none
      ? `${input.key} recorded as none (${source})`
      : `established ${input.key} (${source})`,
    data: { key: input.key, source, sessionId: session.id, none },
  })
  return { ok: true, key: input.key, source }
}

/**
 * Drive what preparation recorded (decisions 1, 8): the server runs its real
 * test-drive machinery under a synthetic identity, and the orchestrator watches.
 *
 * Gated to `project` for two reasons that point the same way. It starts
 * services and creates a database on the host, which is exactly the authority
 * the orchestrator has as the one that prepares the project; and the values it
 * proves are the ones the orchestrator established, so anywhere else it would
 * be proving somebody else's homework.
 *
 * Everything it returns is what the machinery SAW — hook output tails, the
 * variable names it rendered, the URL it sniffed and whether that URL answers —
 * because the agent's job
 * between the halves is to check the things the server cannot (is the database
 * fresh, did migrations apply) and decide whether to fix and re-run. The verdict
 * itself is computed server-side and is not open to argument.
 */
export async function toolDryRunDrive(
  ctx: AppCtx,
  session: SessionRow,
  input: { action: 'start' | 'status' | 'stop' },
): Promise<git.DryRunResult> {
  const project = requireProject(ctx, session)
  if (session.kind !== 'project') {
    throw new GateError(
      `the dry-run drive belongs to the orchestrator, and this is a ${session.kind} session. It ` +
        "starts services and creates a database on the human's machine — only the session that " +
        'prepares the project may run them.',
    )
  }
  // The orchestrator writes `.runcastle/` in its own worktree, and the drive runs
  // in the human's checkout: its commits have to be there before they can be
  // proven. A refused landing refuses the start, with the reason to relay. A
  // start the held slot would refuse anyway is refused first, so it lands nothing.
  if (input.action === 'start') {
    const held = git.driveSlotHeldReason(project.id)
    if (held) return { ok: false, action: 'start', deniedReason: held }
    const landing = await landProjectBranchNow(ctx, project, session.id)
    if (!landing.ok) {
      return {
        ok: false,
        action: 'start',
        deniedReason: `the orchestrator's commits could not land first, so nothing was started: ${landing.reason}`,
      }
    }
  }
  return git.dryRunDrive(ctx, project, input.action)
}

// --- the review's wires: a Review worker's drive and findings -----------------

/** Who calls a review tool: whichever session the request resolved to, if any. */
export interface ReviewCaller {
  session?: SessionRow
}

/**
 * The drive review a `review_drive` call is for (burns-become-workers decision
 * 3): the Review worker on the host this session is. Its pictures are kept under
 * its own id. Gated for the same reason `dry_run_drive` is gated to preparation:
 * it boots the app on the human's machine, authority that belongs to the review
 * runcastle started for this feature and to no ordinary talk session.
 */
function requireReviewer(ctx: AppCtx, caller: ReviewCaller, tool: string): WorkerRow {
  const w = hostReviewOf(ctx, caller.session)
  if (w) return w
  const who = caller.session ? `this is a ${caller.session.kind} session` : 'this call carries no session'
  throw new GateError(
    `${tool} belongs to a drive review (a Review worker on the host), and ${who}. It acts on the ` +
      "human's machine — only the Review worker runcastle starts may call it.",
  )
}

/**
 * Boot the integrated feature branch so a drive review can drive it
 * (improve-workflow decisions 3, 4): the server's REAL test-drive machinery,
 * started under the review's identity instead of a human's click.
 *
 * The feature is the review's, never the agent's to name.
 */
export async function toolReviewDrive(
  ctx: AppCtx,
  caller: ReviewCaller,
  input: { action: 'start' | 'status' | 'stop' },
): Promise<git.ReviewDriveResult> {
  const reviewer = requireReviewer(ctx, caller, 'the review drive')
  const feature = getFeatureRow(ctx, workerFeatureId(reviewer))
  return git.reviewDrive(ctx, projectForFeature(ctx, feature), feature, input.action)
}

/** A refused `scenario` / `try_call`: nothing ran and nothing was sent. */
export interface ReviewScenarioDenial {
  ok: false
  action: 'scenario' | 'try_call' | 'capture'
  deniedReason: string
  /** False for a refusal no wait fixes; absent when the drive was merely busy or not ready. */
  retriable?: boolean
}

/** `review_drive({ action: 'scenario' })`: the landing, the scenario's failure, or a refusal. */
export type ReviewScenarioResult =
  | { ok: true; action: 'scenario'; entryUrl: string; token?: string }
  | { ok: false; action: 'scenario'; failure: ScenarioFailure }
  | ReviewScenarioDenial

/** `review_drive({ action: 'try_call' })`: the response (or send error), or a refusal. */
export type ReviewCallResult = ({ action: 'try_call' } & DriveCallResult) | ReviewScenarioDenial

const reviewScenarioDenial = (action: ReviewScenarioDenial['action'], deniedReason: string): ReviewScenarioDenial => ({
  ok: false,
  action,
  deniedReason,
  retriable: false,
})

/** `review_drive({ action: 'capture' })`: the picture kept, or why it was not. */
export type ReviewCaptureResult = { ok: true; action: 'capture'; caption: string; path: string; scenario?: string } | ReviewScenarioDenial

/**
 * Keep a picture of what the review agent's browser shows, with what it shows
 * as the caption. Runcastle takes it and names it, so the agent writes nothing.
 * It belongs to the latest scenario that landed in this pass, unless `outside`.
 */
export async function toolReviewCapture(
  ctx: AppCtx,
  caller: ReviewCaller,
  input: { caption?: string; outside?: boolean },
  capture: typeof captureReviewShot = captureReviewShot,
): Promise<ReviewCaptureResult> {
  const reviewer = requireReviewer(ctx, caller, 'the review drive')
  const featureId = workerFeatureId(reviewer)
  const projectId = projectForFeature(ctx, getFeatureRow(ctx, featureId)).id
  if (!git.reviewDriveFor(projectId, featureId)) {
    return reviewScenarioDenial('capture', "No review drive of this feature is running — review_drive({ action: 'start' }) first.")
  }
  const caption = input.caption?.replace(/\s+/g, ' ').trim()
  if (!caption) return reviewScenarioDenial('capture', '`capture` needs `caption`: one line saying what the picture shows.')
  const passId = reviewer.id
  const entries = readSaw(passId)
  const taken = entries.filter((entry) => entry.kind === 'shot').length
  if (taken >= SAW_MAX_SHOTS) {
    return reviewScenarioDenial('capture', `This pass has its ${SAW_MAX_SHOTS} screenshots, the most one pass keeps. Carry on without more.`)
  }
  const image = `shot-${taken + 1}.png`
  const path = reviewShotPath(passId, image)
  const result = await capture(passId, path)
  if (!result.ok) return reviewScenarioDenial('capture', result.reason)
  const scenario = input.outside
    ? undefined
    : entries.findLast((entry) => entry.kind === 'scenario' && entry.ok)
  const file = scenario?.kind === 'scenario' ? scenario.file : undefined
  appendSaw(passId, { kind: 'shot', at: Date.now(), caption, image, ...(file ? { scenario: file } : {}) })
  // The path goes back so the reviewer can open the picture once before its
  // verdict: a verdict never rests on a picture nobody looked at.
  return { ok: true, action: 'capture', caption, path, ...(file ? { scenario: file } : {}) }
}

/**
 * Replay a scenario on the run's live review drive (drive-scenarios decision
 * 12): `scenario` runs it through the human's runner, with no restart, and
 * `try_call` sends the landed scenario's filled `.http` request through the
 * same path as the human's Try it. Both act only on THIS run's review drive.
 */
export async function toolReviewScenario(
  ctx: AppCtx,
  caller: ReviewCaller,
  input: { action: 'scenario'; file?: string },
): Promise<ReviewScenarioResult>
export async function toolReviewScenario(
  ctx: AppCtx,
  caller: ReviewCaller,
  input: { action: 'try_call'; file?: string },
): Promise<ReviewCallResult>
export async function toolReviewScenario(
  ctx: AppCtx,
  caller: ReviewCaller,
  input: { action: 'scenario' | 'try_call'; file?: string },
): Promise<ReviewScenarioResult | ReviewCallResult>
export async function toolReviewScenario(
  ctx: AppCtx,
  caller: ReviewCaller,
  { action, file }: { action: 'scenario' | 'try_call'; file?: string },
): Promise<ReviewScenarioResult | ReviewCallResult> {
  const reviewer = requireReviewer(ctx, caller, 'the review drive')
  const featureId = workerFeatureId(reviewer)
  const projectId = projectForFeature(ctx, getFeatureRow(ctx, featureId)).id
  if (!git.reviewDriveFor(projectId, featureId)) {
    return reviewScenarioDenial(
      action,
      "No review drive of this feature is running — review_drive({ action: 'start' }) first.",
    )
  }
  if (!file) return reviewScenarioDenial(action, `\`${action}\` needs \`file\`, the scenario's repo-relative path.`)

  if (action === 'scenario') {
    const result = await git.runScenarioOnDrive(ctx, projectId, file, { allowReview: true })
    if ('denied' in result) return { ok: false, action, deniedReason: result.denied }
    const pass = reviewer.id
    const name = git.activeDriveInfo(projectId)?.scenario?.name ?? file
    if (!result.ok) {
      appendSaw(pass, { kind: 'scenario', at: Date.now(), file, name, ok: false, failure: result.failure })
      return { ok: false, action, failure: result.failure }
    }
    appendSaw(pass, { kind: 'scenario', at: Date.now(), file, name, ok: true, entryUrl: result.entryUrl })
    return { ok: true, action, entryUrl: result.entryUrl, ...(result.token ? { token: result.token } : {}) }
  }

  const scenario = git.activeDriveInfo(projectId)?.scenario
  if (scenario?.file !== file || scenario.status !== 'landed') {
    return reviewScenarioDenial(action, `run the scenario first: review_drive({ action: 'scenario', file: '${file}' })`)
  }
  if (!scenario.call) {
    return reviewScenarioDenial(action, scenario.callError ?? 'this scenario has no .http call')
  }
  const result = await sendDriveCall(ctx, projectId, scenario.call, { allowReview: true })
  appendSaw(reviewer.id, { kind: 'call', at: Date.now(), scenario: file, ...maskedCall(scenario.call, result) })
  return { action, ...result }
}

/**
 * `report_finding` from a drive review on the host: recorded against the Review
 * worker itself (burns-become-workers decision 4). A gates review reports the
 * same way over its sandbox's relay (`workers/tools.ts`).
 */
export function toolReportFinding(
  ctx: AppCtx,
  caller: ReviewCaller,
  input: ReviewFindingInputT,
): { findingId: string } {
  const review = requireReviewer(ctx, caller, 'report_finding')
  return { findingId: reportReviewFinding(ctx, review.id, input).finding.id }
}

/** What one `retry_drive` attempt observed, as the Fix-drive worker reads it. */
export interface RetryDriveResult {
  /**
   * Whether the fresh drive STARTED. Its setup may still have failed — that is
   * `drive.hookFailure`, and reading on is the whole point of the loop.
   */
  ok: boolean
  /** Why the start was refused (an uncommitted tree, an active run). */
  deniedReason?: string
  /** Whether a drive was still holding the slot and was stopped first. */
  stopped: boolean
  /** The branch under the wheel, when one started. */
  branch?: string
  /**
   * The fresh drive exactly as the human's panel sees it: the setup failure if
   * it failed again, the NAMES of the variables setup wrote, the dev pane, the
   * sniffed URL and whether it answers yet.
   */
  drive?: git.DriveInfo
}

/**
 * Retry the drive this session was opened to fix (decision 9) — the fix→retry
 * half of the loop, and the only tool the Fix-drive worker has that no other
 * session does.
 *
 * Stopping first is not optional and not the agent's job to remember: the failed
 * drive is still holding the singleton slot with the feature branch checked out,
 * and a start is refused while it does. An already-stopped slot is tolerated
 * (the human may have stopped it from the UI), which is what makes this callable
 * as many times as the fix takes.
 */
export async function toolRetryDrive(
  ctx: AppCtx,
  session: SessionRow,
): Promise<RetryDriveResult> {
  if (driveWorkerOf(ctx, session)?.kind !== 'fix-drive') {
    throw new GateError(
      `retrying a drive belongs to the Fix-drive worker, and this is a ${session.kind} session. ` +
        "It stops and restarts a test drive on the human's machine — only the session opened on " +
        'that failed drive may do that; everyone else asks the human to drive from the review panel.',
    )
  }
  const feature = getFeatureRow(ctx, requireFeatureId(session))
  const project = projectForFeature(ctx, feature)

  const stopped = git.activeTestDriveFeatureId(project.id) === feature.id
  if (stopped) await git.testDrive(ctx, project, feature, 'stop', 'human', { retry: true })

  const start = await git.testDrive(ctx, project, feature, 'start')
  const drive = git.activeDriveInfo(project.id)
  return {
    ok: start.ok,
    stopped,
    ...(start.deniedReason ? { deniedReason: start.deniedReason } : {}),
    ...(start.branch ? { branch: start.branch } : {}),
    ...(drive ? { drive } : {}),
  }
}

// --- the scenario session's tools (drive-scenarios decision 8) ---------------

/** Refuse anything but a `scenario` session or the Scenarios worker, and resolve the project it belongs to. */
function requireScenarioSession(ctx: AppCtx, session: SessionRow, what: string): Project {
  if (driveWorkerOf(ctx, session)?.kind !== 'scenario') {
    throw new GateError(
      `${what} belongs to the Scenarios worker, and this is a ${session.kind} session. Scenarios ` +
        'are written and landed from ＋ New scenario inside a running test drive.',
    )
  }
  // Its scope follows its drive: a feature drive's session has a feature.
  return session.featureId
    ? projectForFeature(ctx, getFeatureRow(ctx, session.featureId))
    : requireProject(ctx, session)
}

/**
 * Land the human on a scenario (drive-scenarios decision 8): run it through the
 * same runner the picker uses, against this session's drive, and point the
 * drive panel at its `ENTRY_URL`. The result is the scenario service's own —
 * the landing, or the failure the human sees (reason plus output tail) — or
 * the drive's refusal. Refused outright when the drive this session is docked
 * to is no longer the live one.
 */
export async function toolRunScenario(
  ctx: AppCtx,
  session: SessionRow,
  file: string,
): Promise<ScenarioRunResult | git.ScenarioDenial> {
  const project = requireScenarioSession(ctx, session, 'Running a scenario')
  const drive = git.activeDriveInfo(project.id)
  if (drive?.scenarioSessionId !== session.id) {
    throw new GateError(
      'the drive this scenario session was opened on is no longer running, so there is nothing ' +
        'to land on. Tell the human; a new drive opens its own scenario chat.',
    )
  }
  return git.runScenarioOnDrive(ctx, project.id, file)
}

/**
 * Record the project's scenario runner (decision 5's setup step) — the one
 * setting a scenario session may write, through the settings service so
 * `settings.updated` reaches the UI. The command must carry `{file}`.
 */
export function toolSetScenarioRunner(
  ctx: AppCtx,
  session: SessionRow,
  command: string,
): { scenarioRunner: string } {
  const project = requireScenarioSession(ctx, session, 'Setting the scenario runner')
  if (!command.includes(SCENARIO_FILE_PLACEHOLDER)) {
    throw new InvalidInputError(
      `the scenario runner must contain ${SCENARIO_FILE_PLACEHOLDER}, where runcastle puts the ` +
        'scenario file — e.g. `bun {file}` or `bin/rails runner {file}`.',
    )
  }
  updateSettings(ctx, { key: 'scenarioRunner', value: command, projectId: project.id })
  return { scenarioRunner: getProjectById(ctx, project.id)?.scenarioRunner ?? command }
}

// --- the orchestrator's three tools (decisions 15, 19, 21) ---------------

export interface CreateFeatureResult {
  id: string
  slug: string
  branch: string
  status: FeatureStatusT
  /** The slugs the new draft waits on — present only when `dependsOn` was passed. */
  dependsOn?: string[]
  /** True when the draft was created up next. */
  upNext?: boolean
}

/** The feature-scoped talk kinds that may park a draft (draft-features decision 6). */
const DRAFTING_KINDS: readonly SessionKindT[] = ['chat', 'side']

/**
 * The project a `create_feature` call belongs to — and, on the way there, how
 * much of the door the calling session may open (draft-features decision 6).
 *
 * A project-scoped session keeps the whole door. A feature-scoped TALK session
 * gets exactly one move: park a draft, so scope creep surfaced mid-grill has
 * somewhere to go instead of swallowing the feature being grilled — its project
 * is the one its own feature belongs to. Anything beyond parking is refused,
 * because a grill that can spawn live features is an orchestrator, and that is
 * the orchestrator's job. Other session kinds cannot create features,
 * because even a parked draft is still a write.
 */
function createFeatureProject(
  ctx: AppCtx,
  session: SessionRow,
  input: { draft?: boolean },
): Project {
  if (isProjectSessionKind(session.kind)) return requireProject(ctx, session)
  if (!DRAFTING_KINDS.includes(session.kind)) {
    throw new GateError(
      `a ${session.kind} session may not create features, drafts included. ` +
        'Tell the human what is worth capturing; the orchestrator is where features are made.',
    )
  }
  if (!input.draft) {
    throw new GateError(
      `a ${session.kind} session may only PARK a feature here: call create_feature with ` +
        '`draft: true` and a `brief` carrying why you deferred it. Cutting a branch belongs to ' +
        'the orchestrator; tell the human to open it.',
    )
  }
  return projectForFeature(ctx, getFeatureRow(ctx, requireFeatureId(session)))
}

/**
 * The point of the orchestrator: intake and decomposition terminating in a
 * feature (decision 19).
 *
 * Two shapes, one call. The ordinary door is a feature whose `brief.md` is the
 * prose the intake conversation just produced, so the reasoning about why this
 * feature exists and what it must not swallow survives the terminal closing.
 * With `draft` it parks that same feature instead of starting it
 * (draft-features decision 5): a row and a stored brief, no branch, until the
 * human clicks Start. Never tickets: the feature's own agent reads the brief and
 * judges the work (decision 10).
 *
 * It launches nothing: the orchestrator sets a feature working with its acting
 * tools when it judges it ready. From an orchestrator — the orchestrator — it
 * runs as the orchestrator, so every event it emits carries `actor:
 * 'orchestrator'`, and the calling thread holds what it created
 * (`threads-hold-features` decision 13).
 */
export async function toolCreateFeature(
  ctx: AppCtx,
  session: SessionRow,
  input: CreateFeatureInput,
): Promise<CreateFeatureResult> {
  const created =
    session.kind !== 'project'
      ? await createFeatureFor(ctx, session, input)
      : await runAsActor('orchestrator', async () => {
          const choice = cutChoice(input)
          const made = await createFeatureFor(
            ctx,
            session,
            { ...input, brief: choice.brief },
            { threadId: session.id, finish: choice.finish },
          )
          if (choice.chatOwns) giveToChat(ctx, made.id, session.id, choice.chatOwns, 'create')
          return made
        })
  recordFeatureAction(ctx, session, created.id, input.draft ? 'parked' : 'created')
  return created
}

/** How a cut feature is planned (decision 13): with the human in its chat, or by itself. */
export type PlanningChoice = 'with-me' | 'self'

const PLANNING_LINE: Record<PlanningChoice, string> = {
  'with-me': 'Planning mode: grill with you',
  self: 'Planning mode: plans itself',
}

/**
 * The two cut-time choices (`every-feature-has-one-owner` decisions 4, 7, 13),
 * read in this one place so they can later fold into one three-step question.
 * Planning is not stored on the feature: it travels as today, in the brief
 * (a "Planning mode:" line, added when the brief has none) and in the
 * self-planning launch the chat starts later. The chat owns the feature from
 * the start only when it plans itself and the chat takes it on; a grilled
 * feature starts as the human's, with its finish recorded for the plan's yes.
 * Omitted, a feature is planned with the human and finished by them.
 */
function cutChoice(input: CreateFeatureInput): { finish: FeatureFinish; chatOwns: ChatFinish | null; brief?: string } {
  const planning = input.planning ?? 'with-me'
  const finish = input.finish ?? 'you'
  const chatOwns = planning === 'self' && finish !== 'you' ? finish : null
  const brief =
    input.planning === undefined || /^Planning mode:/im.test(input.brief ?? '')
      ? input.brief
      : [input.brief?.trimEnd(), PLANNING_LINE[planning]].filter(Boolean).join('\n\n') + '\n'
  return { finish, chatOwns, ...(brief !== undefined ? { brief } : {}) }
}

interface CreateFeatureInput {
  title: string
  oneLiner?: string
  baseBranch?: string
  brief?: string
  draft?: boolean
  dependsOn?: string[]
  upNext?: boolean
  /** From an orchestrator chat: how it is planned. */
  planning?: PlanningChoice
  /** From an orchestrator chat: how far the chat takes it. */
  finish?: FeatureFinish
}

async function createFeatureFor(
  ctx: AppCtx,
  session: SessionRow,
  input: CreateFeatureInput,
  chat?: { threadId: string; finish: FeatureFinish },
): Promise<CreateFeatureResult> {
  const project = createFeatureProject(ctx, session, input)
  const dependsOn = input.dependsOn ?? []
  if (input.upNext) {
    if (!isProjectSessionKind(session.kind)) {
      throw new GateError(
        `a ${session.kind} session cannot make a feature up next: parked scope goes to the ` +
          'backlog, and the human can mark it up next on its page.',
      )
    }
    if (!input.draft || dependsOn.length === 0) {
      throw new InvalidInputError(
        '`upNext` needs `draft: true` and a non-empty `dependsOn` — up next means ' +
          '"start by itself when those ship", so it needs something to wait on.',
      )
    }
  }
  if (dependsOn.length > 0 && !input.draft) {
    throw new InvalidInputError(
      'dependsOn is only for drafts — a started feature cannot wait. Pass `draft: true` to park ' +
        'it waiting on those features.',
    )
  }
  // Validated BEFORE the row exists, so a bad slug, a merged dependency or a
  // foreign feature refuses the whole create instead of leaving a half-made draft.
  const dependencyIds = featureIdsBySlug(ctx, project.id, dependsOn)
  validateDependencies(ctx, project.id, null, dependencyIds)
  const oneLiner = input.oneLiner?.trim()
  if (!oneLiner) {
    throw new InvalidInputError('create_feature needs a oneLiner — one line saying what this feature is.')
  }
  const feature = await createFeature(ctx, {
    projectId: project.id,
    title: input.title,
    oneLiner,
    baseBranch: input.baseBranch,
    brief: input.brief,
    draft: input.draft,
    ...(chat ? { chat } : {}),
  })
  if (dependencyIds.length === 0) {
    return { id: feature.id, slug: feature.slug, branch: feature.branch, status: feature.status }
  }
  const edges = setDependencies(ctx, feature.id, dependencyIds)
  if (input.upNext) setUpNext(ctx, feature.id, true)
  return {
    id: feature.id,
    slug: feature.slug,
    branch: feature.branch,
    status: feature.status,
    dependsOn: edges.map((d) => d.slug),
    ...(input.upNext ? { upNext: true } : {}),
  }
}

/**
 * Feature slugs — what agents hold — to ids within ONE project. A slug that
 * names nothing here (including another project's feature) is refused by name.
 */
function featureIdsBySlug(ctx: AppCtx, projectId: string, slugs: string[]): string[] {
  if (slugs.length === 0) return []
  const bySlug = new Map(listFeatures(ctx, projectId).map((f) => [f.slug, f.id]))
  const unknown = slugs.filter((slug) => !bySlug.has(slug))
  if (unknown.length > 0) {
    throw new InvalidInputError(
      `no feature in this project has the slug ${unknown.map((s) => `\`${s}\``).join(', ')}`,
    )
  }
  return slugs.map((slug) => bySlug.get(slug) as string)
}

/**
 * Replace a draft's merge-order dependencies (decisions 4, 5) through the same
 * service the UI's `feature.setDependencies` uses. Re-ordering the portfolio is
 * project-level curation, so only the orchestrator may call it; a feature
 * session's only power over edges is `dependsOn` at create time.
 */
export function toolSetFeatureDependencies(
  ctx: AppCtx,
  session: SessionRow,
  input: { slug: string; dependsOn: string[]; upNext?: boolean },
): { slug: string; dependsOn: DependencyMark[]; upNext: boolean } {
  const project = requireProject(ctx, session)
  if (session.kind !== 'project') {
    throw new GateError(
      `set_feature_dependencies belongs to the orchestrator, and this is a ${session.kind} session.`,
    )
  }
  const [dependentId] = featureIdsBySlug(ctx, project.id, [input.slug])
  const dependencyIds = featureIdsBySlug(ctx, project.id, input.dependsOn)
  // Only the draft being reordered is acted on; the features it names are read.
  requireHold(ctx, session, getFeatureRow(ctx, dependentId as string))
  const edges = setDependencies(ctx, dependentId as string, dependencyIds)
  // After the new set is written, so one call can both set the edges and mark the draft.
  const feature =
    input.upNext === undefined
      ? getFeatureRow(ctx, dependentId as string)
      : setUpNext(ctx, dependentId as string, input.upNext)
  return { slug: input.slug, dependsOn: edges.map(dependencyMark), upNext: feature.upNext }
}

/** One live ADR as an index row — title and address, not the argument itself. */
export interface AdrRef {
  relPath: string
  title: string
  bytes: number
}

/**
 * Where a new feature would cut from, so intake can STATE its base instead of
 * cutting one silently (decisions 1, 2, 7). The agent assumes `current`, says so
 * in the create proposal, and passes it back as `create_feature`'s `baseBranch`.
 */
export interface BaseBranches {
  /** The human checkout's branch — the base to assume. `''` when HEAD is detached. */
  current: string
  /**
   * Whether `current` is a base a feature may actually fork from. False when the
   * checkout is parked on a `feature/*` branch (mid test drive) or detached —
   * the one case where there is no default and the agent must ask.
   */
  currentIsSelectable: boolean
  /** Every base a feature may fork from: local non-`feature/*` plus remote-only `origin/<name>`. */
  selectable: string[]
  /** The repo's main line — the suggestion to offer when `current` is unselectable. */
  detectedMain: string
}

/**
 * The key order is the reading order: what the project is and where a feature
 * would cut from, then the charter that binds every decision, then the indexes.
 */
export interface ProjectContext {
  /** The whole row with `full: true`; otherwise just what names it ({@link ProjectSummary}). */
  project: Project | ProjectSummary
  /**
   * The base a new feature would cut from; see {@link BaseBranches}. The
   * `selectable` list comes only with `full: true`.
   */
  baseBranches: BaseBranches | Omit<BaseBranches, 'selectable'>
  /**
   * `CONTEXT.md` in full; absent when the project has no charter yet. A stub on
   * a repeat read by a conversation that already holds this version.
   */
  charter?: string | UnchangedCharter
  /**
   * Live ADRs as an INDEX — superseded ones are omitted (decision 13), and the
   * rest are named rather than inlined. Read one with `read_adr({ relPath })`.
   */
  adrs: AdrRef[]
  /** Says, in the payload itself, that `adrs` is fetchable rather than gone. */
  adrsNote: string
  /** One line per listed feature; see {@link featureIndex}. */
  featureIndex: string[]
  /** Says where shipped features' docs live and how to reach an unlisted one. */
  featureIndexNote: string
  /** The features the human took from this chat since it was last told, once each; see {@link takenByHumanNews}. */
  takenByHuman?: string[]
}

/**
 * The features the human took from this chat that it has not been told about
 * yet, one line each (every-feature-has-one-owner decision 23): the chat is not
 * woken for it; it reads this on its next turn, once. Empty when there is none.
 */
export function takenByHumanNews(ctx: AppCtx, sessionId: string): string[] {
  return releasedFrom(ctx, sessionId)
    .filter((r) => tellOnce(sessionId, `released:${r.featureId}:${r.at}`))
    .map(
      (r) =>
        `The human took \`${r.slug}\` (${r.title}) from you on ${new Date(r.at).toISOString().slice(0, 16).replace('T', ' ')}: ` +
        'it is theirs now. You may still send_to_feature and read it; do not act on it otherwise.',
    )
}

/**
 * The project row as a default read carries it (`tools-and-skills-say-less`
 * decision 7): the long prepared settings matter only when preparing.
 */
export type ProjectSummary = Pick<Project, 'id' | 'name' | 'repoPath' | 'sessionBranch'>

/** The charter on a repeat read, when the conversation already holds this version. */
export interface UnchangedCharter {
  unchanged: true
  sha: string
}

const ADRS_NOTE =
  'adrs[] is an index of the project’s LIVE decisions (superseded ones are already omitted), not ' +
  'their text. Read the ones your work touches with read_adr({ relPath }) — they bind you the ' +
  'same either way. They are also plain files in this worktree at docs/adr/.'

const FEATURE_INDEX_NOTE =
  'featureIndex lists every in-flight feature, then every draft, then the most recently shipped, ' +
  'one `slug — title [state]` line each. A trailing `· waits on: a, b ✓` lists the features it ' +
  'must wait to merge (✓ = already shipped). `[draft, up next]` marks a draft that starts by ' +
  'itself once every unmarked one ships; `[draft, up next, stuck]` one that meant to and could ' +
  'not, and waits on the human; `[draft, blocked]` a backlog draft that cannot start until every ' +
  'unmarked one ships, and will not start by itself. A shipped feature’s docs live at docs/features/<slug>/ ' +
  'in this worktree; an in-flight or draft feature’s docs live on an unmerged branch. Any ' +
  'feature’s brief is read_feature_brief({ slug }); what one actually did is ' +
  'get_work_record({ featureSlug }).'

/**
 * How many shipped features the index names, most recently shipped first
 * (decision 8). Counted rather than dated, so a quiet project still lists some.
 */
export const FEATURE_INDEX_SHIPPED_CAP = 50

/**
 * Everything that is true of the project right now: the row, the charter, an
 * index of the live ADRs, a one-line index of every feature, and the base a new
 * feature would cut from.
 *
 * The docs are read from THIS SESSION's worktree, not the human's checkout —
 * the orchestrator works on a runcastle-owned branch (decision 18), so its
 * own tree is the state it is editing and the state it should be told about.
 * The branches are the other way round: the base a feature should fork off is
 * the branch the HUMAN is on, which is the checkout's, never this session's.
 *
 * The ADRs were once inlined in full on decision 16's reasoning: a ceiling would
 * silently turn "this binds you" into "this binds you unless it did not fit".
 * That reasoning was about TRUNCATION, and indexing is not truncation — nothing
 * is dropped, cut short or made unreachable; the read is one `read_adr` away and
 * the index says so. It matters because the pruning decision 13 relies on never
 * fires in practice: across every real project in this repo's data, zero ADRs
 * are marked superseded, so "live ADRs only" was the whole corpus and 73% of an
 * 80 KB payload. The deferral recorded in
 * `docs/features/project-session-open-by-asking-orient-lazily/brief.md:13` is
 * this work.
 */
export async function toolGetProjectContext(
  ctx: AppCtx,
  session: SessionRow,
  input: { full?: boolean } = {},
): Promise<ProjectContext> {
  const project = requireProject(ctx, session)
  const baseBranches = await readBaseBranches(project)
  const charter = projectCharter(session, input.full === true)
  const { selectable: _selectable, ...defaultBranches } = baseBranches
  const taken = session.kind === 'project' ? takenByHumanNews(ctx, session.id) : []
  return {
    project: input.full
      ? project
      : { id: project.id, name: project.name, repoPath: project.repoPath, sessionBranch: project.sessionBranch },
    baseBranches: input.full ? baseBranches : defaultBranches,
    ...(charter !== undefined ? { charter } : {}),
    adrs: listLiveAdrs(session.worktreePath).map(adrRef),
    adrsNote: ADRS_NOTE,
    featureIndex: featureIndex(ctx, project.id, session.id),
    featureIndexNote: FEATURE_INDEX_NOTE,
    ...(taken.length > 0 ? { takenByHuman: taken } : {}),
  }
}

/**
 * The charter as this session should get it: whole the first time, and as an
 * {@link UnchangedCharter} once the session holds this version — unless `full`.
 * Either way the version sent whole is remembered.
 */
function projectCharter(session: SessionRow, full: boolean): string | UnchangedCharter | undefined {
  const charter = readCharter(session.worktreePath)
  if (charter === undefined) return undefined
  const sha = contentSha(charter)
  if (!full && sentSha(session.id, CHARTER_DOC_KEY) === sha) return { unchanged: true, sha }
  recordSent(session.id, CHARTER_DOC_KEY, sha)
  return charter
}

/**
 * The project's features, one line each, sized to stay stable however many
 * features the project eventually ships (decisions 7 and 8).
 *
 * Every in-flight feature and draft is always listed: collision detection needs
 * all of them, and their docs are on no branch this session can read. Shipped
 * features are listed most recently shipped first, up to
 * {@link FEATURE_INDEX_SHIPPED_CAP}; a feature with no ship event sorts last.
 * The older shipped ones and every archived one collapse into one closing line
 * that names how many were left out and how to reach them — their docs are on
 * disk, where a search answers "did we already do X?" better than a title list.
 */
function featureIndex(ctx: AppCtx, projectId: string, callerId: string): string[] {
  const all = listFeatures(ctx, projectId)
  const shipped = all
    .filter((f) => f.status === 'shipped')
    .map((feature) => ({ feature, shippedAt: latestEventTs(ctx, feature.id, 'feature.shipped') }))
    .sort((a, b) => {
      if (a.shippedAt === undefined) return b.shippedAt === undefined ? 0 : 1
      if (b.shippedAt === undefined) return -1
      return b.shippedAt - a.shippedAt
    })
    .map(({ feature }) => feature)
  const listed = [
    ...all.filter((f) => f.status === 'active'),
    ...all.filter((f) => f.status === 'draft'),
    ...shipped.slice(0, FEATURE_INDEX_SHIPPED_CAP),
  ]
  const names = new Map<string, string>()
  const lines = listed.map((feature) => `${featureIndexLine(feature, workerStateOf(ctx, feature))}${holderMark(ctx, feature, callerId, names)}`)

  const olderShipped = shipped.length - Math.min(shipped.length, FEATURE_INDEX_SHIPPED_CAP)
  const archived = all.filter((f) => f.status === 'archived').length
  const left = [
    ...(olderShipped > 0 ? [`${olderShipped} older shipped`] : []),
    ...(archived > 0 ? [`${archived} archived`] : []),
  ]
  if (left.length > 0) {
    lines.push(
      `… ${left.join(' and ')} features not listed: search docs/features/*/brief.md on disk, ` +
        'or read_feature_brief({ slug }) if you know the slug.',
    )
  }
  return lines
}

/**
 * The branch facts intake needs to state a base rather than cut one silently.
 * `listBranches` is the same vocabulary the web base pickers use — `feature/*`
 * excluded, remote-only lines as `origin/<name>` — so a base the agent picks
 * here and a base a human picks in the form are the same set of things.
 */
async function readBaseBranches(project: Project): Promise<BaseBranches> {
  const { current, branches, remoteBranches } = await git.listBranches(project)
  const selectable = [...branches, ...remoteBranches]
  return {
    current,
    currentIsSelectable: selectable.includes(current),
    selectable,
    detectedMain: await git.detectMainBranch(project.repoPath),
  }
}

function adrRef(adr: AdrDoc): AdrRef {
  const firstLine = adr.content.split('\n', 1)[0] ?? ''
  const heading = firstLine.match(/^#\s+(.+)$/)
  return {
    relPath: adr.relPath,
    title: heading ? heading[1].trim() : adr.relPath,
    bytes: Buffer.byteLength(adr.content, 'utf8'),
  }
}

/**
 * One ADR out of this session's own worktree, in full.
 *
 * Guarded here rather than in the knowledge service because the service reads a
 * DIRECTORY and this reads a caller-named path: `relPath` comes from an agent,
 * so it is normalized to a name under `docs/adr/` and then checked to still
 * resolve inside it. Both spellings the index could plausibly be echoed back in
 * (`docs/adr/0001-x.md` and a bare `0001-x.md`) resolve to the same file.
 */
export function toolReadAdr(
  ctx: AppCtx,
  session: SessionRow,
  input: { relPath: string },
): { relPath: string; content: string } {
  requireProject(ctx, session)
  const root = resolve(join(session.worktreePath, ADR_DIR_REL))
  const name = input.relPath.replace(/\\/g, '/').replace(/^\.?\/*docs\/adr\//i, '')
  const target = resolve(root, name)

  const rel = relative(root, target)
  if (rel === '' || rel.startsWith('..') || rel.split(sep).includes('..')) {
    throw new InvalidInputError(`adr path escapes ${ADR_DIR_REL}: ${input.relPath}`)
  }
  if (!existsSync(target)) throw new NotFoundError(`adr not found: ${input.relPath}`)
  return { relPath: `${ADR_DIR_REL}/${name}`, content: readFileSync(target, 'utf8') }
}

/**
 * One feature, one line: `slug — title [state]`, and nothing longer.
 *
 * The one-liner is gone from every line (decision 7): one-liners grew into
 * paragraphs and were most of the payload, and `read_feature_brief` serves one
 * on request. The per-line docs path went with it; the index note says once
 * where shipped docs live. The in-flight state keeps what the portfolio lookup
 * is asked for — how many workers are working, queued or need the human, all true
 * of the feature in SQLite rather than of an unmerged branch — and the SLUG `get_work_record`
 * and `read_feature_brief` match on. A feature's merge-order edges (ADR-0013)
 * trail the line as slugs and marks — edges and state only, so the session can
 * tell what is startable without re-cutting already-ordered work (decision 8).
 * An unstarted feature carries its state: `up next` (starts by itself when its
 * dependencies ship), `up next, stuck` (needs the human) or `blocked` (backlog
 * with an open dependency); otherwise plain `draft`.
 */
function featureIndexLine(feature: FeatureListItem, workerState = ''): string {
  const edges = feature.dependsOn.length
    ? ` · waits on: ${feature.dependsOn.map((d) => (d.satisfied ? `${d.slug} ✓` : d.slug)).join(', ')}`
    : ''
  if (feature.status !== 'active') {
    const mark = {
      upNext: ', up next',
      stuck: ', up next, stuck',
      blocked: ', blocked',
      readyToStart: '',
      backlog: '',
    }[unstartedState(feature, feature.dependsOn) ?? 'backlog']
    return `${feature.slug} — ${feature.title} [${feature.status}${mark}]${edges}`
  }
  return `${feature.slug} — ${feature.title} [${workerState ? `in flight: ${workerState}` : 'in flight'}]${edges}`
}

/** An in-flight feature's workers for its index line: `2 working, 1 needs you`; empty when none is at work or waiting. */
function workerStateOf(ctx: AppCtx, feature: FeatureListItem): string {
  if (feature.status !== 'active') return ''
  const rows = listWorkers(ctx, feature.id)
  const count = (...statuses: WorkerRow['status'][]) => rows.filter((w) => statuses.includes(w.status)).length
  return [
    [count('working'), 'working'],
    [count('queued'), 'queued'],
    [count('needs-you'), 'needs you'],
  ]
    .filter(([n]) => n !== 0)
    .map(([n, label]) => `${n} ${label}`)
    .join(', ')
}

/** ` · held by …` for an index line: a thread needs the holder before it acts, not after a refusal. */
function holderMark(ctx: AppCtx, feature: FeatureListItem, callerId: string, names: Map<string, string>): string {
  if (!feature.heldBy || feature.status === 'shipped') return ''
  if (feature.heldBy === callerId) return ' · held by you'
  if (!names.has(feature.heldBy)) {
    const row = holderOf(ctx, feature)
    names.set(feature.heldBy, row ? holderName(row) : feature.heldBy)
  }
  return ` · held by "${names.get(feature.heldBy)}"`
}

/** One feature's brief on request: the fetch-one behind a slim index line. */
export interface FeatureBrief {
  slug: string
  title: string
  oneLiner: string
  status: FeatureStatusT
  /** Absent when neither the docs on disk nor the database recorded one. */
  brief?: string
  /** Present only when `brief` is absent, saying so. */
  note?: string
}

/**
 * Any feature of the project, by slug: what it is for, from wherever its brief
 * is true (decision 7). A shipped feature's brief is `brief.md` in this
 * session's worktree, where the merge put it, falling back to the database row
 * if the file is gone. An in-flight or draft feature's docs live on an
 * unmerged branch this session cannot read, so its brief is the database's.
 */
export function toolReadFeatureBrief(
  ctx: AppCtx,
  session: SessionRow,
  input: { slug: string },
): FeatureBrief {
  const project = requireProject(ctx, session)
  const feature = listFeatures(ctx, project.id).find((f) => f.slug === input.slug)
  if (!feature) throw new NotFoundError(`feature not found: ${input.slug}`)

  const onDisk = join(session.worktreePath, featureDocsRel(feature.slug), 'brief.md')
  const brief =
    feature.status === 'shipped' && existsSync(onDisk)
      ? readFileSync(onDisk, 'utf8')
      : feature.brief
  return {
    slug: feature.slug,
    title: feature.title,
    oneLiner: feature.oneLiner,
    status: feature.status,
    ...(brief !== undefined
      ? { brief }
      : { note: 'No brief was recorded for this feature, on disk or in the database.' }),
  }
}

/** One ticket as history: what it touched and what came of it, never its intent. */
export interface WorkRecordTicket {
  seq: number
  title: string
  status: TicketStatusT
  seams: string[]
  commits: string[]
  error?: string
  /**
   * The burner's own account of the work, written just before it signalled
   * done. Only the slug and seq forms serve it; the seam form lists.
   */
  digest?: string
  /** The digest exists but was moved out whole to stay under the ceiling. */
  digestNotInlined?: true
}

export interface WorkRecordRun {
  workflow: string
  status: RunStatusT
  startedAt: number
  endedAt?: number
  summary?: string
}

/** One worker as history: what it was asked, how it ended and what it changed. */
export interface WorkRecordWorker {
  label: string
  kind: WorkerRow['kind']
  goal?: string
  doneWhen?: string
  status: WorkerRow['status']
  /** The worker's handback summary. Moved out whole under the ceiling and the seam form. */
  summary?: string
  summaryNotInlined?: true
  filesChanged: string[]
  commits: string[]
  tokens?: number
}

export interface WorkRecordFeature {
  slug: string
  title: string
  status: FeatureStatusT
  /** When the merge landed (`feature.shipped`); absent while unmerged. */
  shippedAt?: number
  /** Frozen history: nothing writes runs any more (burns-become-workers decision 19). */
  runs: WorkRecordRun[]
  /** Frozen history, as the old features left it. */
  tickets: WorkRecordTicket[]
  /** The feature's workers; absent when it has none, and in the seq drill-down, which is a ticket's. */
  workers?: WorkRecordWorker[]
}

function workRecordWorker(w: WorkerRow, withSummary: boolean): WorkRecordWorker {
  return {
    label: w.label,
    kind: w.kind,
    ...(w.goal !== null ? { goal: w.goal } : {}),
    ...(w.doneWhen !== null ? { doneWhen: w.doneWhen } : {}),
    status: w.status,
    ...(withSummary && w.handbackSummary !== null ? { summary: w.handbackSummary } : {}),
    filesChanged: w.handbackFiles ?? [],
    commits: w.handbackCommits ?? [],
    ...(w.tokens !== null ? { tokens: w.tokens } : {}),
  }
}

/** Whether `seam` (lowercased) appears in a file the worker changed or in its assignment. */
function workerMatchesSeam(w: WorkerRow, seam: string): boolean {
  return [...(w.handbackFiles ?? []), w.goal ?? '', w.doneWhen ?? ''].some((s) => s.toLowerCase().includes(seam))
}

export interface WorkRecord {
  features: WorkRecordFeature[]
  /** Present only when digests were moved out, saying how to fetch one. */
  note?: string
}

/**
 * The work record (decision 15): facts about what features actually DID.
 *
 * Deliberately never a ticket's `goal`, `context` or `acceptanceCriteria` —
 * those are intent at a moment, written before the code existed, and the burner
 * may have satisfied them by another route. Handing them to a later session is
 * handing it a decayed spec with none of the decay stamp. What survives is the
 * residue that cannot be wrong later: seams, commits, status, error, timings,
 * and the title as a label rather than a claim.
 *
 * The `digest` is prose and still a fact: the burner wrote it AFTER the work, as
 * its account of what it actually did, what surprised it and what it left alone
 * (decision 4). It carries the decay stamp intent lacks — it describes the code
 * that exists rather than the code someone hoped for — so it belongs here. The
 * run-level aggregate does not: it is these same digests re-concatenated, and
 * serving both would double the response for no new fact (decision 7).
 *
 * Queryable three ways (decision 9 of `mcp-read-tools-stay-within-a-context-budget`):
 * - By seam: "who has touched this before?" — a case-insensitive SUBSTRING
 *   match, because seams are uncoordinated free prose across features
 *   (decision 27) and exact equality would under-report invisibly. A feature
 *   contributes only its matching tickets, as rows WITHOUT digests: a sideways
 *   search finds who touched an area, and inlining every feature's digests is
 *   what made it overflow.
 * - By slug: "what did X actually do?" — digests inline, except that when the
 *   reply would cross {@link MCP_READ_CEILING_CHARS} they are moved out whole,
 *   lowest seq first, each marked `digestNotInlined`. Never truncated.
 * - By slug and seq: that one ticket, digest included — the drill-down.
 */
export function toolGetWorkRecord(
  ctx: AppCtx,
  session: SessionRow,
  input: { featureSlug?: string; seam?: string; seq?: number },
): WorkRecord {
  const project = requireProject(ctx, session)
  const slug = input.featureSlug?.trim()
  const seq = input.seq
  if (seq !== undefined && !slug) {
    throw new InvalidInputError('get_work_record takes seq only together with its featureSlug')
  }
  const seam = seq === undefined ? input.seam?.trim().toLowerCase() : undefined
  if (!slug && !seam) {
    throw new InvalidInputError('get_work_record needs a featureSlug or a seam to look up')
  }

  const records: WorkRecordFeature[] = []
  for (const feature of listFeatures(ctx, project.id)) {
    if (slug && feature.slug !== slug) continue
    let tickets = listByFeature(ctx, feature.id)
    let workerRows = seq === undefined ? listWorkers(ctx, feature.id) : []
    if (seam) {
      tickets = tickets.filter((t) => t.seams.some((s) => s.toLowerCase().includes(seam)))
      workerRows = workerRows.filter((w) => workerMatchesSeam(w, seam))
      if (tickets.length === 0 && workerRows.length === 0) continue
    }
    if (seq !== undefined) {
      tickets = tickets.filter((t) => t.seq === seq)
      if (tickets.length === 0) throw new NotFoundError(`ticket #${seq} not found on ${slug}`)
    }
    const shippedAt = latestEventTs(ctx, feature.id, 'feature.shipped')
    records.push({
      slug: feature.slug,
      title: feature.title,
      status: feature.status,
      ...(shippedAt !== undefined ? { shippedAt } : {}),
      runs: listRunsByFeature(ctx, feature.id).map((r) => ({
        workflow: r.workflow,
        status: r.status,
        startedAt: r.startedAt,
        ...(r.endedAt !== undefined ? { endedAt: r.endedAt } : {}),
        ...(r.summary !== undefined ? { summary: r.summary } : {}),
      })),
      tickets: tickets.map((t) => ({
        seq: t.seq,
        title: t.title,
        status: t.status,
        seams: t.seams,
        commits: t.commits,
        ...(t.error !== undefined ? { error: t.error } : {}),
        ...(!seam && t.digest !== undefined ? { digest: t.digest } : {}),
      })),
      ...(workerRows.length > 0 ? { workers: workerRows.map((w) => workRecordWorker(w, !seam)) } : {}),
    })
  }
  if (seq !== undefined && records.length === 0) {
    throw new NotFoundError(`feature not found: ${slug}`)
  }

  const record: WorkRecord = { features: records }
  if (seam || seq !== undefined) return record
  // The slug form names one feature, so every digest here is that feature's.
  const movable = records
    .flatMap((f) => f.tickets)
    .filter((t) => t.digest !== undefined)
    .sort((a, b) => a.seq - b.seq)
  for (const ticket of movable) {
    if (serializedLength(record) <= MCP_READ_CEILING_CHARS) break
    delete ticket.digest
    ticket.digestNotInlined = true
    record.note = WORK_RECORD_DIGESTS_NOTE
  }
  // Worker summaries go the same way, after the digests, longest first.
  const summaries = records
    .flatMap((f) => f.workers ?? [])
    .filter((w) => w.summary !== undefined)
    .sort((a, b) => b.summary!.length - a.summary!.length)
  for (const worker of summaries) {
    if (serializedLength(record) <= MCP_READ_CEILING_CHARS) break
    delete worker.summary
    worker.summaryNotInlined = true
    record.note = WORK_RECORD_DIGESTS_NOTE
  }
  return record
}

const WORK_RECORD_DIGESTS_NOTE =
  'Some digests did not fit and were moved out whole, lowest seq first: each such ticket carries ' +
  'digestNotInlined: true. Read one with get_work_record({ featureSlug, seq }). Worker handback summaries ' +
  'that did not fit carry summaryNotInlined: true; the worker is still listed, without its summary.'

// --- MCP server assembly ----------------------------------------------------

function ok(result: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(result) }] }
}

function noSession(): CallToolResult {
  return {
    content: [
      {
        type: 'text',
        text: 'No active runcastle session. Launch a session from the runcastle UI first.',
      },
    ],
    isError: true,
  }
}

async function resolveCtxSession(extra: HeaderCarrier): Promise<{ ctx: AppCtx; session: SessionRow } | null> {
  const ctx = await getRuntimeCtx()
  const session = resolveSession(ctx, headerSessionId(extra))
  return session ? { ctx, session } : null
}

/**
 * The caller of a review tool. Never refuses for want of a session: the gate is
 * `requireReviewer`, and the session (if any) is there to make its refusal
 * name who called.
 */
async function resolveReviewCaller(extra: HeaderCarrier): Promise<{ ctx: AppCtx; caller: ReviewCaller }> {
  const rs = await resolveCtxSession(extra)
  return rs ? { ctx: rs.ctx, caller: { session: rs.session } } : { ctx: await getRuntimeCtx(), caller: {} }
}

/** The caller of a feature READ: the resolved session's own feature. */
async function resolveReader(
  extra: HeaderCarrier,
): Promise<{ ctx: AppCtx; reader: FeatureReader } | null> {
  const rs = await resolveCtxSession(extra)
  if (!rs) return null
  return { ctx: rs.ctx, reader: resolveFeatureReader(rs.session) }
}

/** The caller of a feature READ from an orchestrator: the feature `slug` names. */
async function resolveProjectReader(
  extra: HeaderCarrier,
  slug: string,
): Promise<{ ctx: AppCtx; reader: FeatureReader } | null> {
  const rs = await resolveCtxSession(extra)
  if (!rs) return null
  return { ctx: rs.ctx, reader: projectFeatureReader(rs.ctx, rs.session, slug) }
}

/** The `slug` an orchestrator names the feature it reads by. */
const ReadSlug = z
  .string()
  .min(1)
  .describe('The slug of the feature to read — any feature of this project.')

/** Appended to a feature read's description when it is registered for an orchestrator. */
const PROJECT_READ_NOTE =
  ' From the orchestrator, name the feature with `slug`: any feature of this project.'

// --- who gets which tools ---------------------------------------------------

/**
 * The audience a built server is for: a session kind, a drive review on the
 * host (`review`, a `worker` session whose worker is one), or `undefined` for
 * "we could not tell". The drive workers (`fix-drive-worker`, `scenario-worker`,
 * drive-chats-become-workers decision 9) are named apart from any session kind:
 * they are `worker` sessions, told apart by their worker row.
 */
export type McpAudience = SessionKindT | 'review' | 'fix-drive-worker' | 'scenario-worker'

/** The kinds whose session belongs to a FEATURE and may shape its work (every feature kind but `worker`). */
const FEATURE_KINDS: readonly SessionKindT[] = ['chat', 'side']

const PROJECT_KINDS: readonly SessionKindT[] = ['project']

/**
 * The Scenarios worker is in neither list: its scope follows its drive (feature or
 * project), so it is offered only the tools that work at either scope plus its
 * own two. `worker` is in neither either: a worker gets none of the lead's tools
 * (interactive-workers decision 9). A drive worker is offered what the drive chat
 * it replaces was, plus `hand_back`.
 */
const ALL_AUDIENCES: readonly McpAudience[] = [
  ...FEATURE_KINDS,
  ...PROJECT_KINDS,
  'worker',
  'review',
  'fix-drive-worker',
  'scenario-worker',
]

/**
 * Which audiences each tool is registered for — derived from the RUNTIME gates
 * each tool already enforces, not from fresh policy: `requireFeatureId`,
 * `requireProject`, `requireReviewer`, the `kind !== 'project'`
 * checks, and `createFeatureProject`.
 * Every one of those call-time guards stays exactly where it is; this table only
 * decides what a session is TOLD about.
 *
 * The distinction that makes this worth doing at all: the permission allowlist
 * (`RUNCASTLE_MCP_ALLOW_RULES`) grants every tool to every session, and its own
 * comment argues correctly that a rule for a tool that can only be refused is
 * inert. A rule is inert because it costs nothing. A tool DEFINITION is not: the
 * full `tools/list` is ~14 KB of schema re-sent on every turn of every session,
 * and a mean two thirds of it names tools the calling kind cannot reach (for
 * `qa`, which can reach a handful, it was ~94%). Inert permission, expensive
 * definition — the two do not follow from each other.
 */
const TOOL_AUDIENCES: Record<string, readonly McpAudience[]> = {
  // Feature reads. Also reachable by a drive review, which reads ITS OWN
  // feature (a review legitimately wants the branch's context). The project
  // session reads any feature of its project by `slug` (`projectFeatureReader`).
  get_feature_context: [...FEATURE_KINDS, 'review', 'project', 'fix-drive-worker'],
  read_feature_doc: [...FEATURE_KINDS, 'review', 'project', 'fix-drive-worker'],
  // The lead (and its side sessions) close the review's findings: `resolve_finding`.
  resolve_finding: FEATURE_KINDS,
  declare_ready: ['chat'],
  wait_for_you: ['chat'],
  // The lead's hands back to the orchestrator; a host worker's (a drive review, a drive worker) hands back to its lead.
  hand_back: ['chat', 'review', 'fix-drive-worker', 'scenario-worker'],
  // A `worker` session is in no list here: its tools are its own, served in its
  // sandbox (`worker-mcp-script.ts`) and answered over the relay runcastle opens
  // into it (`workers/tools.ts`); its only way to change the feature is its
  // handback (decision 9).
  // The lead's worker tools (decision 4): `requireLeadFeatureId`.
  start_worker: ['chat'],
  start_review: ['chat'],
  message_worker: ['chat'],
  land_worker: ['chat'],
  send_back_worker: ['chat'],
  drop_worker: ['chat'],
  // Refused at call time on a feature another thread holds (`toolNotifyHuman`).
  notify_human: ['chat', 'project'],
  // Design mode: the feature's chat, in every phase (`requireChatFeatureId`).
  start_design_server: ['chat'],
  show_panel: ['chat'],
  // The plan and the designs (`designs-and-the-plan-get-their-own-place`): the feature's chat;
  // an orchestrator chat posts their cards by slug (every-feature-has-one-owner decision 3).
  show_plan: ['chat', 'project'],
  show_design: ['chat', 'project'],
  set_design_state: ['chat'],
  // Every session with a thread to show it in.
  show_file: [...FEATURE_KINDS, ...PROJECT_KINDS, 'review', 'fix-drive-worker', 'scenario-worker'],
  show_review_package: [...FEATURE_KINDS, ...PROJECT_KINDS],
  // Project-scoped: `requireProject`.
  record_finding: PROJECT_KINDS,
  get_project_context: PROJECT_KINDS,
  read_adr: PROJECT_KINDS,
  get_work_record: PROJECT_KINDS,
  read_feature_brief: PROJECT_KINDS,
  list_project_notes: ['project'],
  triage_project_note: ['project'],
  update_project_note: ['project'],
  set_feature_dependencies: ['project'],
  // `createFeatureProject`: the project kinds get the whole door, the drafting
  // talk kinds get parking only, `qa` and the drive workers get nothing.
  create_feature: [...PROJECT_KINDS, ...DRAFTING_KINDS],
  // Single-kind tools, each gated on that kind at call time.
  dry_run_drive: ['project'],
  retry_drive: ['fix-drive-worker'],
  run_scenario: ['scenario-worker'],
  set_scenario_runner: ['scenario-worker'],
  // A drive review's: `requireReviewer`. A gates review gets report_finding over its relay.
  review_drive: ['review'],
  report_finding: ['review'],
  // The one tool both halves share — it emits at whatever scope the caller has.
  record_event: [...FEATURE_KINDS, ...PROJECT_KINDS, 'fix-drive-worker', 'scenario-worker'],
  // The orchestrator's tools (`one-orchestrator-no-mode`): offered to the
  // orchestrator, refused at call time unless it is still live
  // (`requireOrchestratorSession`). Registered in `orchestrator-tools.ts` and
  // `orchestrator-run-tools.ts`.
  start_feature: ['project'],
  plan_feature: ['project'],
  send_to_feature: ['project'],
  read_feature_chat: ['project'],
  stop_feature_run: ['project'],
  drive: ['project'],
  merge_feature: ['project'],
  add_to_brief: ['project'],
  take_feature: ['project'],
  // The chat's own epic name (orchestrator-chats-become-epics decision 12): `toolNameEpic`.
  name_epic: ['project'],
}

/**
 * Whether `tool` should be registered for `audience`.
 *
 * An unrecognized audience — no headers, a session id that resolves to nothing,
 * a kind from a newer build — registers EVERYTHING. Guessing wrong in the other
 * direction would hand a live session a server with no tools and no way to say
 * so, which is a worse failure than an over-long list; the call-time guards
 * still refuse anything the caller may not do.
 */
function registeredFor(tool: string, audience: McpAudience | undefined): boolean {
  if (audience === undefined) return true
  if (!ALL_AUDIENCES.includes(audience)) return true
  return (TOOL_AUDIENCES[tool] ?? ALL_AUDIENCES).includes(audience)
}

/** The audience a session's server is built for: a host review or drive worker by its worker row, any other session by its kind. */
export function sessionAudience(ctx: AppCtx, session: SessionRow): McpAudience {
  if (hostReviewOf(ctx, session)) return 'review'
  const drive = driveWorkerOf(ctx, session)
  if (drive) return drive.kind === 'fix-drive' ? 'fix-drive-worker' : 'scenario-worker'
  return session.kind
}

/** The tool names a given audience is offered — the assertion tests read. */
export function toolsForAudience(audience: McpAudience | undefined): string[] {
  return Object.keys(TOOL_AUDIENCES)
    .filter((tool) => registeredFor(tool, audience))
    .sort()
}

/**
 * The shape of a timeline event tag: `subject.verb`, lowercase, dotted.
 *
 * Not a closed enum, because sessions legitimately record milestones the server
 * has no name for. But not free text either: every emitter in the codebase
 * writes this shape (`phase.complete_requested`, `finding.reported`,
 * `tickets.stored`), the timeline is permanent, and a session that invents
 * `I finished the spec!` puts a row in it that nothing can ever filter on.
 */
const EventType = z
  .string()
  .regex(
    /^[a-z][a-z0-9]*(\.[a-z][a-z0-9_]*)+$/,
    'event type must be a lowercase dotted tag like `decision.recorded`',
  )

/**
 * Build a fresh MCP server carrying the tools `audience` can actually reach.
 *
 * Called per request (stateless mode), so the audience is resolved from the
 * request's own identity headers before assembly — see the route handler.
 */
export function buildMcpServer(audience?: McpAudience): McpServer {
  const server = new McpServer({ name: 'runcastle', version: '0.1.0' })
  const wants = (tool: string): boolean => registeredFor(tool, audience)
  // The feature reads take a `slug` from an orchestrator, which has no
  // feature of its own; every other audience reads exactly as before.
  const projectReads = audience === 'project'

  if (wants('record_finding')) {
    server.registerTool(
      'record_finding',
      {
        title: 'Record a preparation finding',
        description:
          'Store one established project setting while preparing the project; never overwrites a ' +
          'key a human set (reported as `skipped`). An empty `value` with `evidence` records a deliberate none.',
        inputSchema: {
          key: PreparedKey.describe('Which project setting this value is for.'),
          value: z
            .string()
            .describe('The value to store; empty records a deliberate none (needs `evidence`).'),
          evidence: z
            .string()
            .optional()
            .describe('How you know: the command and its output, or what the human said.'),
          userSupplied: z
            .boolean()
            .optional()
            .describe('True only when the human gave or confirmed this value verbatim.'),
        },
      },
      async (args, extra) => {
        const rs = await resolveCtxSession(extra)
        if (!rs) return noSession()
        return ok(await toolRecordFinding(rs.ctx, rs.session, args))
      },
    )
  }

  if (wants('dry_run_drive')) {
    server.registerTool(
      'dry_run_drive',
      {
        title: 'Dry-run the test drive',
        description:
          'Prove the recorded drive keys by running the real test-drive machinery under a ' +
          "synthetic identity in the human's checkout. Ask the human before `start`: it starts services and creates a database.",
        inputSchema: {
          action: z
            .enum(['start', 'status', 'stop'])
            .describe('`start` boots the drive, `status` reports it (poll `devReady`), `stop` tears it down.'),
        },
      },
      async (args, extra) => {
        const rs = await resolveCtxSession(extra)
        if (!rs) return noSession()
        return ok(await toolDryRunDrive(rs.ctx, rs.session, args))
      },
    )
  }

  if (wants('review_drive')) {
    server.registerTool(
      'review_drive',
      {
        title: 'Drive the feature branch for review',
        description:
          "The feature branch running on the human's checkout, to review it: `start`, `status` (its URL) and `stop` the drive, " +
          'replay scenarios and calls, keep screenshots. A refusal carries `deniedCode` and `retriable`.',
        inputSchema: {
          action: z
            .enum(['start', 'status', 'stop', 'scenario', 'try_call', 'capture'])
            .describe(
              '`start`/`status`/`stop` run the drive; `scenario` and `try_call` replay scenario `file`; ' +
                '`capture` keeps a screenshot.',
            ),
          file: z.string().optional().describe('For `scenario` and `try_call`: the repo-relative scenario path.'),
          caption: z.string().max(200).optional().describe('For `capture`: one line on what the picture shows.'),
          outside: z.boolean().optional().describe('For `capture`: true when it belongs to no scenario.'),
        },
      },
      async (args, extra) => {
        const rc = await resolveReviewCaller(extra)
        const { action, file, caption, outside } = args
        if (action === 'capture') return ok(await toolReviewCapture(rc.ctx, rc.caller, { caption, outside }))
        if (action === 'scenario' || action === 'try_call') {
          return ok(await toolReviewScenario(rc.ctx, rc.caller, { action, file }))
        }
        return ok(await toolReviewDrive(rc.ctx, rc.caller, { action }))
      },
    )
  }

  if (wants('report_finding')) {
    server.registerTool(
      'report_finding',
      {
        title: 'Report a structured review finding',
        description:
          'Report one typed finding for the feature under review. Defects stay open for the ' +
          'feature’s lead, which decides what each becomes; observations are retained for the digest.',
        inputSchema: ReviewFindingInput.shape,
      },
      async (args, extra) => {
        const rc = await resolveReviewCaller(extra)
        return ok(toolReportFinding(rc.ctx, rc.caller, ReviewFindingInput.parse(args)))
      },
    )
  }

  if (wants('retry_drive')) {
    server.registerTool(
      'retry_drive',
      {
        title: 'Retry this feature’s test drive',
        description:
          'Stop the failed drive and start a fresh one of this feature. Commit your fix first; ' +
          'the reply reports `drive.hookFailure`, `drive.envKeys`, `drive.devUrl` and `drive.devReady`.',
        inputSchema: {},
      },
      async (_args, extra) => {
        const rs = await resolveCtxSession(extra)
        if (!rs) return noSession()
        return ok(await toolRetryDrive(rs.ctx, rs.session))
      },
    )
  }

  if (wants('run_scenario')) {
    server.registerTool(
      'run_scenario',
      {
        title: 'Land the human on a scenario',
        description:
          'Run one committed scenario against the drive this session is docked to and point the ' +
          'human’s drive panel at its entry URL. Replies with `entryUrl`, a `failure`, or `denied`.',
        inputSchema: {
          file: z
            .string()
            .min(1)
            .describe('Repo-relative path of the scenario, e.g. `.runcastle/scenarios/checkout/expired-coupon.ts`.'),
        },
      },
      async (args, extra) => {
        const rs = await resolveCtxSession(extra)
        if (!rs) return noSession()
        return ok(await toolRunScenario(rs.ctx, rs.session, args.file))
      },
    )
  }

  if (wants('set_scenario_runner')) {
    server.registerTool(
      'set_scenario_runner',
      {
        title: 'Record the scenario runner',
        description:
          'Record the project’s scenario runner: the command that runs one scenario file, with ' +
          '`{file}` where its repo-relative path goes (e.g. `bun {file}`, `bin/rails runner {file}`). ' +
          'The only setting this session may write. Scenario sessions only.',
        inputSchema: {
          command: z.string().min(1).describe('The runner command; must contain `{file}`.'),
        },
      },
      async (args, extra) => {
        const rs = await resolveCtxSession(extra)
        if (!rs) return noSession()
        return ok(toolSetScenarioRunner(rs.ctx, rs.session, args.command))
      },
    )
  }

  const DEPENDS_ON_SCHEMA = z
    .array(z.string().min(1))
    .optional()
    .describe('Slugs of features that must merge first; only with `draft: true`.')

  // A drafting TALK session may only park a draft (`createFeatureProject`), so
  // it is offered only that shape — the full-create arguments it would be
  // refused are neither described to it nor accepted from it. Same
  // guard at call time either way; this only stops charging a grill for the
  // orchestrator's door. (Item 9: with the audience known, policy prose that
  // does not apply to the reader is simply not sent.)
  if (wants('create_feature') && audience !== undefined && DRAFTING_KINDS.includes(audience as SessionKindT)) {
    server.registerTool(
      'create_feature',
      {
        title: 'Park a feature draft',
        description:
          'Park scope that belongs elsewhere as a draft: a row and its brief, no branch, until the ' +
          'human clicks Start. Use `dependsOn` when it builds on this feature.',
        inputSchema: {
          title: z.string().min(1).describe('The parked feature’s name.'),
          oneLiner: z.string().min(1).describe('One line saying what it is.'),
          brief: z
            .string()
            .optional()
            .describe('Why you deferred it, and what it must not swallow. Stored verbatim.'),
          draft: z.literal(true).describe('Always true here — parking is the only move.'),
          dependsOn: DEPENDS_ON_SCHEMA,
        },
      },
      async (args, extra) => {
        const rs = await resolveCtxSession(extra)
        if (!rs) return noSession()
        return ok(await toolCreateFeature(rs.ctx, rs.session, args))
      },
    )
  } else if (wants('create_feature')) {
    server.registerTool(
      'create_feature',
      {
        title: 'Create a feature',
        description:
          'Create a feature from a title, one-liner and brief, started or parked (`draft: true`). ' +
          'Opens no terminal; feature sessions may only park drafts.',
        inputSchema: {
          title: z.string().min(1).describe('The feature’s name; its slug and branch derive from this.'),
          oneLiner: z.string().min(1).describe('One line saying what this feature is.'),
          baseBranch: z
            .string()
            .optional()
            .describe('Branch to cut from; pass it explicitly (not for drafts).'),
          brief: z.string().optional().describe('Why it exists and what it must not swallow; becomes brief.md.'),
          draft: z.boolean().optional().describe('Park it as a draft instead of starting it.'),
          dependsOn: DEPENDS_ON_SCHEMA,
          upNext: z.boolean().optional().describe('With `draft` and `dependsOn`: start by itself once they ship.'),
          planning: z
            .enum(['with-me', 'self'])
            .optional()
            .describe('The human’s choice: `with-me` (they plan it in its chat) or `self` (it plans itself and shows them).'),
          finish: z
            .enum(['you', 'show', 'merge'])
            .optional()
            .describe('The human’s choice: `you` finish it, `show` (build, show them, they merge) or `merge` (build and merge).'),
        },
      },
      async (args, extra) => {
        const rs = await resolveCtxSession(extra)
        if (!rs) return noSession()
        return ok(await toolCreateFeature(rs.ctx, rs.session, args))
      },
    )
  }

  if (wants('get_project_context')) {
    server.registerTool(
      'get_project_context',
      {
        title: 'Get project context',
        description:
          'The project: base branch state, the charter, an index of live ADRs and a feature index. ' +
          'A repeat sends the charter as unchanged; `full: true` returns everything.',
        inputSchema: {
          full: z.boolean().optional().describe('Return the whole project row, every selectable base and the charter.'),
        },
      },
      async (args, extra) => {
        const rs = await resolveCtxSession(extra)
        if (!rs) return noSession()
        return ok(await toolGetProjectContext(rs.ctx, rs.session, args))
      },
    )
  }

  if (wants('list_project_notes')) {
    server.registerTool(
      'list_project_notes',
      {
        title: 'List project notes',
        description:
          'List this project’s open notes oldest first. Notes with a screenshot include its ' +
          'absolute host path and a ready-made attachment sentence for a feature’s brief.',
        inputSchema: {},
      },
      async (_args, extra) => {
        const rs = await resolveCtxSession(extra)
        if (!rs) return noSession()
        return ok(toolListProjectNotes(rs.ctx, rs.session))
      },
    )
  }

  if (wants('triage_project_note')) {
    server.registerTool(
      'triage_project_note',
      {
        title: 'Triage project notes',
        description:
          'Mark one or several open notes triaged with one outcome and an optional destination feature.',
        inputSchema: {
          noteIds: z.array(z.string().min(1)).min(1),
          outcome: z.string().min(1),
          featureId: z.string().min(1).optional(),
        },
      },
      async (args, extra) => {
        const rs = await resolveCtxSession(extra)
        if (!rs) return noSession()
        return ok(toolTriageProjectNote(rs.ctx, rs.session, args))
      },
    )
  }

  if (wants('update_project_note')) {
    server.registerTool(
      'update_project_note',
      {
        title: 'Update project note',
        description: 'Rewrite the text of an open note after its intent has been sharpened.',
        inputSchema: {
          noteId: z.string().min(1),
          text: z.string().min(1),
        },
      },
      async (args, extra) => {
        const rs = await resolveCtxSession(extra)
        if (!rs) return noSession()
        return ok(toolUpdateProjectNote(rs.ctx, rs.session, args))
      },
    )
  }

  if (wants('set_feature_dependencies')) {
    server.registerTool(
      'set_feature_dependencies',
      {
        title: 'Set a draft’s dependencies',
        description:
          'Replace a parked draft’s whole merge-order set (`[]` clears it); it cannot start until ' +
          'they merge. `upNext` moves it between up next and backlog.',
        inputSchema: {
          slug: z.string().min(1).describe('The draft whose set this replaces.'),
          dependsOn: z
            .array(z.string().min(1))
            .describe('Slugs of features in this project the draft must wait on — the WHOLE set.'),
          upNext: z
            .boolean()
            .optional()
            .describe('true = up next, false = backlog; omit to leave the mark unchanged.'),
        },
      },
      async (args, extra) => {
        const rs = await resolveCtxSession(extra)
        if (!rs) return noSession()
        return ok(toolSetFeatureDependencies(rs.ctx, rs.session, args))
      },
    )
  }

  if (wants('read_adr')) {
    server.registerTool(
      'read_adr',
      {
        title: 'Read an ADR',
        description:
          'One project decision record in full, from the ADR index `get_project_context` returns.',
        inputSchema: {
          relPath: z.string().min(1).describe('The index `relPath`, or a bare filename.'),
        },
      },
      async (args, extra) => {
        const rs = await resolveCtxSession(extra)
        if (!rs) return noSession()
        return ok(toolReadAdr(rs.ctx, rs.session, args))
      },
    )
  }

  if (wants('read_feature_brief')) {
    server.registerTool(
      'read_feature_brief',
      {
        title: 'Read a feature brief',
        description:
          'Any feature’s brief by slug, with its title, one-liner and status.',
        inputSchema: {
          slug: z.string().min(1).describe('A feature slug from the feature index.'),
        },
      },
      async (args, extra) => {
        const rs = await resolveCtxSession(extra)
        if (!rs) return noSession()
        return ok(toolReadFeatureBrief(rs.ctx, rs.session, args))
      },
    )
  }

  if (wants('get_work_record')) {
    server.registerTool(
      'get_work_record',
      {
        title: 'Get work record',
        description:
          'What features actually did, facts only: status, workers (assignment, handback summary, files changed, ' +
          'commits, tokens), and for older features runs and tickets with commits; by ' +
          '`featureSlug` each ticket’s digest too. Send a `featureSlug` (with `seq` for one ticket) or a `seam`.',
        inputSchema: z.union([
          z.object({
            featureSlug: z
              .string()
              .min(1)
              .describe('A feature slug from the feature index.'),
            seam: z.string().min(1).optional(),
            seq: z.number().int().min(1).optional().describe('One ticket of that feature, with its digest.'),
          }),
          z.object({
            featureSlug: z.string().min(1).optional(),
            seam: z
              .string()
              .min(1)
              .describe('A surface to ask about; matched as a case-insensitive substring of ticket seams, of the files a worker changed, or of its assignment.'),
            // Accepted only so the tool can refuse it: zod would otherwise strip a
            // `seq` sent without its featureSlug and run a plain seam search.
            seq: z.number().int().min(1).optional(),
          }),
        ]),
      },
      async (args, extra) => {
        const rs = await resolveCtxSession(extra)
        if (!rs) return noSession()
        return ok(toolGetWorkRecord(rs.ctx, rs.session, args))
      },
    )
  }

  if (wants('get_feature_context')) {
    const config = {
      title: 'Get feature context',
      description:
        'The current feature: header (status, rounds, waiting reason, dependencies, designs), ' +
        'ticket rows, the to-do and the canonical docs. A repeat call returns only what ' +
        'changed; `full: true` resends everything.',
    }
    const full = z.boolean().optional().describe('Return every doc in full.')
    if (projectReads) {
      server.registerTool(
        'get_feature_context',
        {
          ...config,
          description:
            'Any feature of this project, named by `slug`, as a short status view: state, waiting ' +
            'reason, ticket counts, review verdict and a docs index. `full: true` returns the lead’s whole bundle.',
          inputSchema: { slug: ReadSlug, full },
        },
        async ({ slug, full: wantsFull }, extra) => {
          const r = await resolveProjectReader(extra, slug)
          if (!r) return noSession()
          if (!wantsFull) return ok(featureStatusView(r.ctx, r.reader))
          return ok(await featureContextWithGit(r.ctx, r.reader))
        },
      )
    } else {
      server.registerTool(
        'get_feature_context',
        { ...config, inputSchema: { full } },
        async ({ full: wantsFull }, extra) => {
          const r = await resolveReader(extra)
          if (!r) return noSession()
          return ok(await featureContextWithGit(r.ctx, r.reader, { dedupe: true, full: wantsFull }))
        },
      )
    }
  }

  if (wants('read_feature_doc')) {
    const config = {
      title: 'Read a feature doc',
      description:
        'One doc of this feature in full, including any `moreDocs` entry or doc left out of the context.',
    }
    const relPath = z.string().min(1).describe('Path relative to the feature’s docs dir, as `moreDocs` spells it.')
    if (projectReads) {
      server.registerTool(
        'read_feature_doc',
        {
          ...config,
          description: config.description + PROJECT_READ_NOTE,
          inputSchema: { slug: ReadSlug, relPath },
        },
        async ({ slug, ...args }, extra) => {
          const r = await resolveProjectReader(extra, slug)
          if (!r) return noSession()
          return ok(toolReadFeatureDoc(r.ctx, r.reader, args))
        },
      )
    } else {
      server.registerTool(
        'read_feature_doc',
        { ...config, inputSchema: { relPath } },
        async (args, extra) => {
          const r = await resolveReader(extra)
          if (!r) return noSession()
          return ok(toolReadFeatureDoc(r.ctx, r.reader, args))
        },
      )
    }
  }

  if (wants('resolve_finding')) {
    server.registerTool(
      'resolve_finding',
      {
        title: 'Resolve a review finding',
        description:
          'Close an open review defect as `addressed` or `dismissed`, with a note. A finding that ' +
          'already closed answers with its current status.',
        inputSchema: ResolveFindingShape,
      },
      async (args, extra) => {
        const rs = await resolveCtxSession(extra)
        if (!rs) return noSession()
        return ok(toolResolveFinding(rs.ctx, rs.session, args))
      },
    )
  }

  if (wants('record_event')) {
    server.registerTool(
      'record_event',
      {
        title: 'Record event',
        description:
          'Add a milestone (not narration) to the timeline of the feature or project.',
        inputSchema: {
          type: EventType.describe('A dotted `subject.verb` tag, e.g. `decision.recorded`; reuse existing tags.'),
          message: z.string().min(1).describe('One human-readable line, shown verbatim.'),
        },
      },
      async (args, extra) => {
        const rs = await resolveCtxSession(extra)
        if (!rs) return noSession()
        return ok(toolRecordEvent(rs.ctx, rs.session, args))
      },
    )
  }

  if (wants('declare_ready')) {
    server.registerTool(
      'declare_ready',
      {
        title: 'Declare the feature ready for the human',
        description:
          'Put a test drive in front of the human and mark the feature ready to test. Refused ' +
          'while a worker is working or holds work that has not landed.',
        inputSchema: {
          scenario: z.string().min(1).describe('A short title for what to drive, e.g. "Checkout with a coupon".'),
        },
      },
      async (args, extra) => {
        const rs = await resolveCtxSession(extra)
        if (!rs) return noSession()
        return ok(toolDeclareReady(rs.ctx, rs.session, args))
      },
    )
  }

  // The lead's workers (interactive-workers decisions 2, 4, 5, 17; names provisional).
  if (wants('start_worker')) {
    server.registerTool(
      'start_worker',
      {
        title: 'Start a worker',
        description:
          'Start a worker on the human’s yes: an agent in its own sandbox and branch off this feature branch, with ' +
          'one assignment. `with-you` is taste work the human iterates on and hands back once they are happy; ' +
          '`on-its-own` hands back when done. Its handback reaches you as a message; nothing lands until you call ' +
          'land_worker.',
        inputSchema: {
          label: z.string().min(1).max(60).describe('A short name for the worker, e.g. "Header".'),
          purpose: z.string().min(1).max(160).describe('One line on what it does, shown under its label.'),
          kind: z.enum(['with-you', 'on-its-own']).describe('`with-you` (taste work, with the human) or `on-its-own`.'),
          goal: z.string().min(1).describe('What the worker should do.'),
          doneWhen: z.string().min(1).describe('How the worker knows it is done.'),
          model: z
            .string()
            .optional()
            .describe('An id from get_feature_context’s annotatedModels; omit for the feature chat’s model.'),
        },
      },
      async (args, extra) => {
        const rs = await resolveCtxSession(extra)
        if (!rs) return noSession()
        return ok(await toolStartWorker(rs.ctx, rs.session, args))
      },
    )
  }

  if (wants('start_review')) {
    server.registerTool(
      'start_review',
      {
        title: 'Start the Review worker',
        description:
          'Start the feature’s Review worker once the work is done: it runs the project’s checks, drives the app when it can ' +
          '(else reads the diff), reports findings and hands back with the Review Package. After fixing defects you judged ' +
          'real, start one with `verify`.',
        inputSchema: {
          mode: z.enum(['drive', 'gates']).optional().describe('`gates` when there is nothing to drive; omit to drive whenever this machine can.'),
          verify: z
            .object({
              findingIds: z.array(z.string().min(1)).min(1).describe('The findings you fixed.'),
              commits: z.array(z.string().min(1)).describe('The commits that fixed them, `<sha> <subject>`.'),
            })
            .optional()
            .describe('A verify review: given only these findings and fix commits.'),
          model: z.string().optional().describe('An id from get_feature_context’s annotatedModels; omit for the feature chat’s model.'),
        },
      },
      async (args, extra) => {
        const rs = await resolveCtxSession(extra)
        if (!rs) return noSession()
        return ok(await toolStartReview(rs.ctx, rs.session, args))
      },
    )
  }

  if (wants('message_worker')) {
    server.registerTool(
      'message_worker',
      {
        title: 'Message a worker',
        description: 'Send one of your workers a message, at any time. One sent while it works waits for the end of its turn.',
        inputSchema: {
          workerId: z.string().min(1).describe('The worker’s id, from get_feature_context’s workers.'),
          text: z.string().min(1).describe('What to tell it.'),
        },
      },
      async (args, extra) => {
        const rs = await resolveCtxSession(extra)
        if (!rs) return noSession()
        return ok(await toolMessageWorker(rs.ctx, rs.session, args))
      },
    )
  }

  if (wants('land_worker')) {
    server.registerTool(
      'land_worker',
      {
        title: 'Land a worker’s handback',
        description:
          'Land a handed-back worker’s branch on the feature branch, through the landing queue. Then run the project’s ' +
          'checks yourself. On a conflict nothing lands: resolve it and call this again.',
        inputSchema: { workerId: z.string().min(1).describe('The worker’s id.') },
      },
      async (args, extra) => {
        const rs = await resolveCtxSession(extra)
        if (!rs) return noSession()
        return ok(await toolLandWorker(rs.ctx, rs.session, args))
      },
    )
  }

  if (wants('send_back_worker')) {
    server.registerTool(
      'send_back_worker',
      {
        title: 'Send a worker’s work back',
        description: 'Send a handed-back worker’s work back with what to change; it works again and hands back again.',
        inputSchema: {
          workerId: z.string().min(1).describe('The worker’s id.'),
          note: z.string().min(1).describe('What to change.'),
        },
      },
      async (args, extra) => {
        const rs = await resolveCtxSession(extra)
        if (!rs) return noSession()
        return ok(await toolSendBackWorker(rs.ctx, rs.session, args))
      },
    )
  }

  if (wants('drop_worker')) {
    server.registerTool(
      'drop_worker',
      {
        title: 'Drop a worker',
        description: 'Drop a worker and throw its work away: its sandbox and branch are removed. Nothing of it lands.',
        inputSchema: { workerId: z.string().min(1).describe('The worker’s id.') },
      },
      async (args, extra) => {
        const rs = await resolveCtxSession(extra)
        if (!rs) return noSession()
        return ok(await toolDropWorker(rs.ctx, rs.session, args))
      },
    )
  }

  if (wants('wait_for_you')) {
    server.registerTool(
      'wait_for_you',
      {
        title: 'Wait for the human',
        description:
          'Say that nothing moves until the human acts, and why; use it for a yes, a decision, or ' +
          'when stuck. Only the human’s next message to you clears it (or your orchestrator’s, when one holds ' +
          'the feature); starting a worker or a review does not.',
        inputSchema: {
          why: z.string().min(1).describe('A few words on what you wait for.'),
          kind: WaitingKind.optional().describe('`plan`, `design` (a recorded design), `stuck`, or `answer` (default).'),
        },
      },
      async (args, extra) => {
        const rs = await resolveCtxSession(extra)
        if (!rs) return noSession()
        return ok(toolWaitForYou(rs.ctx, rs.session, args))
      },
    )
  }

  if (wants('hand_back') && audience === 'review') {
    server.registerTool(
      'hand_back',
      {
        title: 'Hand your review back to your lead',
        description:
          'Hand the review back when it is done (or cannot run): your account, its first line standing alone. Runcastle gives the ' +
          'drive back and shows your lead your findings, pictures and walkthrough. End your turn after.',
        inputSchema: {
          summary: z.string().min(1).describe('Your account: one standalone first line, then a few plain sentences.'),
        },
      },
      async (args, extra) => {
        const rs = await resolveCtxSession(extra)
        if (!rs) return noSession()
        return ok(toolReviewHandBack(rs.ctx, rs.session, args))
      },
    )
  } else if (wants('hand_back') && (audience === 'fix-drive-worker' || audience === 'scenario-worker')) {
    server.registerTool(
      'hand_back',
      {
        title: 'Hand back to your lead',
        description:
          'Hand back when the human is done with what they asked: a short summary of what you changed and committed, ' +
          'on which branch, and what is left. Your lead reads it when it next works. End your turn after.',
        inputSchema: {
          summary: z.string().min(1).describe('What you did, the branch your commits are on, and what is left.'),
        },
      },
      async (args, extra) => {
        const rs = await resolveCtxSession(extra)
        if (!rs) return noSession()
        return ok(toolDriveWorkerHandBack(rs.ctx, rs.session, args))
      },
    )
  } else if (wants('hand_back')) {
    server.registerTool(
      'hand_back',
      {
        title: 'Hand back to the orchestrator',
        description:
          'Bring something to the orchestrator chat that owns this feature (everything: plan yes, designs, ready, ' +
          'conflicts, questions), or, when the human owns it, ask its chat about what reaches beyond the feature. ' +
          'Wakes it once with your summary and a line of the feature’s state. Refused when the feature has no chat.',
        inputSchema: {
          summary: z
            .string()
            .min(1)
            .describe("Done, left, what you need, and what the human told you: the orchestrator never reads your chat."),
          planAgreed: z
            .boolean()
            .optional()
            .describe('True at the human’s plan yes on a feature its chat finishes: the feature passes to that chat.'),
        },
      },
      async (args, extra) => {
        const rs = await resolveCtxSession(extra)
        if (!rs) return noSession()
        return ok(await toolHandBack(rs.ctx, rs.session, args))
      },
    )
  }

  if (wants('start_design_server')) {
    server.registerTool(
      'start_design_server',
      {
        title: 'Start the design server',
        description:
          'Run the project’s frontend dev server in your worktree so the human can see designs live. ' +
          'Returns { url, port, command }; one server per feature.',
        inputSchema: {
          command: z.string().min(1).optional().describe('Serves on $RUNCASTLE_DESIGN_PORT; omit to reuse the recorded one.'),
        },
      },
      async (args, extra) => {
        const rs = await resolveCtxSession(extra)
        if (!rs) return noSession()
        return ok(await toolStartDesignServer(rs.ctx, rs.session, args))
      },
    )
  }

  if (wants('show_panel')) {
    server.registerTool(
      'show_panel',
      {
        title: 'Show the human a panel',
        description:
          'Open a panel (`work`, `review`, `details` or `drive`) beside the chat while you talk about what it shows.',
        inputSchema: {
          view: PanelView.describe('Which view the panel shows.'),
        },
      },
      async (args, extra) => {
        const rs = await resolveCtxSession(extra)
        if (!rs) return noSession()
        return ok(toolShowPanel(rs.ctx, rs.session, args))
      },
    )
  }

  if (wants('show_design')) {
    server.registerTool(
      'show_design',
      {
        title: 'Show the human a design',
        description:
          'Record a design page from the design server and post its card in the chat. Showing it ' +
          'again resets it to waiting; start the server first. Returns { recorded, state }. From an ' +
          'orchestrator chat: post the card of a design the feature’s lead recorded (`slug`, `path`); it never approves it.',
        inputSchema: {
          path: z.string().min(1).describe('The page path on the design server, no `?state=`.'),
          title: z.string().min(1).max(120).optional().describe('The screen the design is, in a few words. Required in a feature’s chat.'),
          slug: z.string().optional().describe("The feature's slug. A feature's own chat leaves it out."),
          width: z.number().int().min(200).max(3840).optional().describe('Layout width in CSS pixels.'),
          picture: z.string().min(1).optional().describe('A screenshot (png, jpg, gif, webp, svg) for its card.'),
        },
      },
      async (args, extra) => {
        const rs = await resolveCtxSession(extra)
        if (!rs) return noSession()
        return ok(toolShowDesign(rs.ctx, rs.session, args))
      },
    )
  }

  if (wants('show_plan')) {
    server.registerTool(
      'show_plan',
      {
        title: 'Show the human the plan',
        description:
          'Post the plan card (plan page, decisions, spec) in this chat; call it when asking for the yes and after every redraw.',
        inputSchema: {
          slug: z.string().optional().describe("The feature's slug. A feature's own chat leaves it out."),
        },
      },
      async (args, extra) => {
        const rs = await resolveCtxSession(extra)
        if (!rs) return noSession()
        return ok(toolShowPlan(rs.ctx, rs.session, args))
      },
    )
  }

  if (wants('set_design_state')) {
    server.registerTool(
      'set_design_state',
      {
        title: 'Mark a design approved or dropped',
        description:
          'Record that the human approved or dropped a design in words; the Approve button already marks itself.',
        inputSchema: {
          path: z.string().min(1).describe('The design page, as passed to show_design.'),
          state: z.enum(['approved', 'dropped']).describe('What the human said.'),
        },
      },
      async (args, extra) => {
        const rs = await resolveCtxSession(extra)
        if (!rs) return noSession()
        return ok(toolSetDesignState(rs.ctx, rs.session, args))
      },
    )
  }

  if (wants('show_file')) {
    server.registerTool(
      'show_file',
      {
        title: 'Show the human a file',
        description:
          'Show one file (up to 100 MB) in this chat: a picture inline, anything else as a card. ' +
          'It waits for nobody; make Markdown and HTML self-contained.',
        inputSchema: {
          path: z.string().min(1).describe('The file. A relative path starts at your working folder.'),
          caption: z.string().max(200).optional().describe('One line saying what the file shows.'),
        },
      },
      async (args, extra) => {
        const rs = await resolveCtxSession(extra)
        if (!rs) return noSession()
        return ok(showFile(rs.ctx, rs.session, args))
      },
    )
  }

  if (wants('notify_human')) {
    server.registerTool(
      'notify_human',
      {
        title: 'Notify the human’s phone',
        description:
          'Send the human a phone notification when they asked to be told or you need them and they ' +
          'seem away; one plain sentence, shown on the lock screen, no secrets.',
        inputSchema: {
          message: z
            .string()
            .min(1)
            .max(NOTIFY_MAX_CHARS)
            .describe('One sentence saying what you want from the human.'),
        },
      },
      async (args, extra) => {
        const rs = await resolveCtxSession(extra)
        if (!rs) return noSession()
        return ok(await toolNotifyHuman(rs.ctx, rs.session, args))
      },
    )
  }

  if (wants('show_review_package')) {
    server.registerTool(
      'show_review_package',
      {
        title: 'Show a review package',
        description:
          'Show the latest review (verdict, screenshots, findings) as one attachment in this chat. ' +
          'Returns `commitsSince`, how far the branch has moved on since.',
        inputSchema: {
          slug: z.string().optional().describe("The feature's slug. A feature's own chats leave it out."),
        },
      },
      async (args, extra) => {
        const rs = await resolveCtxSession(extra)
        if (!rs) return noSession()
        const feature = rs.session.featureId
          ? getFeatureRow(rs.ctx, rs.session.featureId)
          : requireProjectFeature(rs.ctx, rs.session, args.slug ?? '')
        return ok(await showReviewPackage(rs.ctx, rs.session, feature))
      },
    )
  }

  registerOrchestratorTools(server, wants, resolveCtxSession)
  registerOrchestratorRunTools(server, wants, resolveCtxSession)

  return server
}

// --- Hono sub-app (mounted at /mcp) -----------------------------------------

const mcp = new Hono()

// Declare UTF-8 on JSON responses (see routes/hooks.ts — bare `application/json`
// invites CP1252 misdecoding by charset-less HTTP clients).
mcp.use('*', async (c, next) => {
  await next()
  if (c.res.headers.get('content-type') === 'application/json') {
    c.res.headers.set('content-type', 'application/json; charset=utf-8')
  }
})

/**
 * Who this request is, from its identity headers alone — resolved BEFORE the
 * server is assembled, because the tool list is part of the answer.
 *
 * Deliberately total: every path that cannot say for sure returns `undefined`,
 * which registers everything. A session header that resolves gives its kind; a
 * request with no headers at all falls back to the live singleton the same way
 * tool calls do.
 */
export async function resolveAudience(sessionId: string | undefined): Promise<McpAudience | undefined> {
  try {
    const ctx = await getRuntimeCtx()
    const session = resolveSession(ctx, sessionId)
    return session ? sessionAudience(ctx, session) : undefined
  } catch {
    return undefined
  }
}

/**
 * Drain a POST's body BEFORE anything else in this handler runs.
 *
 * `@hono/mcp` reads the body itself (`await ctx.req.json()`), but only after we
 * have awaited a db round trip (`resolveAudience`) and synchronously assembled a
 * whole `McpServer` with every tool's schema. Leaving the socket unread across
 * all of that is the one structural risk this repo owns in the large-batch
 * `emit_tickets` stall: a payload small enough to already sit in the socket's
 * receive buffer is there whenever the transport gets round to asking, while one
 * that takes several reads depends on the runtime buffering correctly while
 * nobody is asking — size-dependent and silent, which is what sessions reported
 * past ~10KB. Reading first removes the window.
 *
 * It costs nothing: Hono caches the body (`HonoRequest#json()` is
 * `#cachedBody('text').then(JSON.parse)`), so the transport's own read is served
 * from that cache rather than the stream, and `handleRequest(ctx, parsedBody)`
 * is its documented way to be handed the value.
 *
 * Doing it here also gives the failure somewhere to be seen. A body that never
 * finishes arriving is the only way an `/mcp` request dies with nothing to show
 * for it — `@hono/mcp`'s json-response promise simply never settles — and
 * silence was the defining symptom of the incident.
 *
 * Upstream, for traceability: no release indicts a specific bug — `@hono/mcp`
 * 0.3.2, the only newer release, adds `onsessiondisconnected` and nothing else,
 * and the payload/framing sweep recorded in `test/mcp-large-batch.test.ts` could
 * not reproduce the stall on linux, so there is nothing to bump to. The nearest
 * open upstream reports put the same symptom — a large tool-call argument that
 * dies silently — one layer further out, in the MCP client rather than in any
 * server:
 *
 *   • https://github.com/anthropics/claude-code/issues/86314 — a large
 *     tool-input string argument stalls the client's own response stream for 80+
 *     seconds with no error, before the call is ever dispatched over MCP;
 *   • https://github.com/anthropics/claude-code/issues/72228 — parameters
 *     emitted after a long parameter value are dropped client-side, so the
 *     server sees a partial call and nothing surfaces the loss.
 *
 * Neither is confirmed as our cause (both are linux reports; the incident host is
 * win32), so this stays a workaround at the layer we own rather than a version
 * bump. If they are fixed upstream and sessions still stall, the remaining
 * suspect is Bun's win32 socket read path — see the RESIDUAL GAP note in
 * `test/mcp-large-batch.test.ts`.
 */
async function readMcpBody(c: Context): Promise<unknown> {
  if (c.req.method !== 'POST') return undefined
  let text: string
  try {
    text = await c.req.text()
  } catch (e) {
    console.error(
      `[mcp] request body read failed after ${c.req.header('content-length') ?? 'unknown'} ` +
        `declared bytes: ${e instanceof Error ? e.message : String(e)}`,
    )
    return undefined
  }
  try {
    return JSON.parse(text)
  } catch {
    // Not ours to answer: handing back `undefined` lets the transport re-read
    // (from Hono's cache) and reply with its own JSON-RPC parse error.
    return undefined
  }
}

mcp.all('*', async (c) => {
  const body = await readMcpBody(c)
  const audience = await resolveAudience(c.req.header('X-Runcastle-Session'))
  const server = buildMcpServer(audience)
  const transport = new StreamableHTTPTransport({ enableJsonResponse: true })
  await server.connect(transport)
  const res = await transport.handleRequest(c, body)
  return res ?? c.body(null, 202)
})

export default mcp
