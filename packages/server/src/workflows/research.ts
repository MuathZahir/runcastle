import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type {
  AgentRuntime,
  Feature,
  ModelEntry,
  RuncastleConfig,
  Waypoint,
  WorkflowCtx,
  WorkflowDef,
} from '@runcastle/core'
import { newId, resolveModelEntry } from '@runcastle/core'
import { loadConfig } from '@runcastle/core/config-load'
import { envPath, featureDocsRel, logsDir } from '@runcastle/core/paths'
import { resolveSkillsRoot } from '../launcher/skills-root'
import type { RunOptions, RunResult } from '@ai-hero/sandcastle'
import { run } from '@ai-hero/sandcastle'
import {
  branchCommitsAhead,
  cleanupBurnWorktree,
  mergeTempBranch,
  researchBranchName,
} from '../services/git'
import type { StreamThrottle, ThrottledEvent } from './ticket-burner'
import { RUNTIME_AUTH_SETUP_HINT } from '../services/setup'
import {
  AUTH_MISSING_EVENT,
  buildBurnAgent,
  buildCodexAuthCopyCommand,
  buildFeatureBrief,
  codexAuthMountFor,
  createStreamThrottle,
  isWorktreeTeardownError,
  // The ONE docs-digest reader. This module used to carry a private copy of the
  // old unbounded `*.md` glob — the third independent instance of that bug, after
  // the burner's and the MCP tool's — so a research waypoint was handed the same
  // ~25k-token payload (outcome.md + test-notes.md and all) that the allowlist
  // exists to prevent. Importing it keeps the three callers on one contract.
  readDocsDigestFromDisk,
  readTokenFromEnvFile,
  selectSandbox,
} from './ticket-burner'

/**
 * Research waypoint AFK (mapped ideation, ADR-0001 / SPEC §13.2). A research
 * waypoint is worked headlessly by a run instead of a HITL terminal: the sandbox
 * agent reads the question, researches web + repo, writes the summary under
 * `docs/features/<slug>/research/<waypoint-slug>.md`, and commits — to a
 * per-run TEMP branch (`runcastle/research/...`, based on the feature branch
 * tip), never to the feature branch itself. The feature branch therefore stays
 * checked out in the talk worktree for the run's whole duration, so HITL
 * terminals run in PARALLEL with research (ADR-0001 §7 "serial HITL, parallel
 * AFK"). On success the temp branch is merged back into the feature branch
 * (fast-forward unless docs moved mid-run) and deleted; a merge conflict fails
 * the run with an actionable event and preserves the temp branch for manual
 * recovery. On success the workflow resolves the waypoint with a summary; on
 * failure or cancel it returns without resolving, so the runner's finalizer
 * auto-releases the waypoint back to the frontier (SPEC §13.2 run finalizer).
 *
 * Structure mirrors the ticket-burner: the sandcastle boundary is isolated behind
 * an injectable `executeResearchRun` (see `ResearchDeps`) so the workflow's
 * control flow — auth precheck, resolve-on-success, release-on-failure — is
 * testable against a fake, with no real sandcastle involvement.
 */

/** What one research run resolves to. Aborts are thrown, never returned here. */
export type ResearchOutcome =
  | { readonly status: 'done'; readonly commits: string[]; readonly docRelPath: string }
  | { readonly status: 'failed'; readonly error: string }

export interface ResearchDeps {
  config: RuncastleConfig
  /** The runtime this waypoint's resolved model launches — whose auth key must be set. */
  runtime: AgentRuntime
  /** Whether {@link runtime}'s auth key is available (docker requires it). */
  hasAuthToken: boolean
  /** Runs the waypoint to a terminal outcome. Real impl calls sandcastle `run()`. */
  executeResearchRun: (ctx: WorkflowCtx, waypoint: Waypoint) => Promise<ResearchOutcome>
}

/** lowercase, non-alphanumeric runs → single hyphen, trimmed. Empty → `waypoint`. */
export function waypointSlug(waypoint: Pick<Waypoint, 'seq' | 'title'>): string {
  const base = waypoint.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `${waypoint.seq}-${base || 'waypoint'}`
}

/** Repo-relative path of a research waypoint's summary doc (forward slashes). */
export function researchDocRel(slug: string, waypoint: Pick<Waypoint, 'seq' | 'title'>): string {
  return `${featureDocsRel(slug)}/research/${waypointSlug(waypoint)}.md`
}

/**
 * The testable core of the research workflow: everything except how `ResearchDeps`
 * are resolved. Reads the `Waypoint` from `ctx.input`, runs the auth precheck,
 * delegates the sandbox run to `deps.executeResearchRun`, and on success resolves
 * the waypoint with a summary. A failed outcome returns `failed` WITHOUT resolving
 * — the runner then auto-releases the still-claimed waypoint to the frontier.
 */
export async function researchRun(
  ctx: WorkflowCtx,
  deps: ResearchDeps,
): Promise<{ status: 'succeeded' | 'failed'; summary: string }> {
  const waypoint = ctx.input as Waypoint | undefined
  if (!waypoint || typeof waypoint.id !== 'string') {
    ctx.emitEvent({ type: 'research.error', message: 'research run started without a waypoint' })
    return { status: 'failed', summary: 'no waypoint to research' }
  }

  // Auth precheck: container sandboxes (docker/podman) need a token before we
  // start any container; noSandbox runs the CLI on the already-authed host. The
  // message names the fix for THIS run's runtime.
  if (deps.config.sandbox !== 'noSandbox' && !deps.hasAuthToken) {
    ctx.emitEvent({ type: AUTH_MISSING_EVENT, message: RUNTIME_AUTH_SETUP_HINT[deps.runtime] })
    return { status: 'failed', summary: 'research aborted: auth token missing' }
  }

  ctx.emitEvent({
    type: 'research.started',
    message: `researching waypoint ${waypoint.seq}: ${waypoint.title}`,
    data: { waypointId: waypoint.id, seq: waypoint.seq },
  })

  const outcome = await deps.executeResearchRun(ctx, waypoint) // throws on abort — propagates
  if (outcome.status === 'done') {
    const summary = `researched: ${waypoint.title} — see ${outcome.docRelPath} (${outcome.commits.length} commit(s))`
    ctx.resolveWaypoint(waypoint.id, 'resolved', summary)
    ctx.emitEvent({
      type: 'research.done',
      message: `waypoint ${waypoint.seq} researched — ${outcome.commits.length} commit(s)`,
      data: { waypointId: waypoint.id, commits: outcome.commits, docRelPath: outcome.docRelPath },
    })
    return { status: 'succeeded', summary }
  }

  // Failed: leave the waypoint claimed — the runner's finalizer auto-releases it.
  ctx.emitEvent({
    type: 'research.failed',
    message: `waypoint ${waypoint.seq} research failed: ${errorHeadline(outcome.error)}`,
    data: { waypointId: waypoint.id, error: outcome.error },
  })
  return { status: 'failed', summary: outcome.error }
}

/**
 * The most informative single line of a multi-line error. Git buries the cause
 * under progress noise (a failed `worktree add` opens with "Preparing worktree
 * (...)"), so prefer the LAST `fatal:`/`error:` line over the first line.
 */
function errorHeadline(s: string): string {
  const lines = s
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  const causes = lines.filter((l) => /^(fatal|error):/i.test(l))
  return causes.at(-1) ?? lines[0] ?? ''
}

/**
 * Stream throttle for research runs: identical batching + payload shapes to the
 * burner's `createStreamThrottle`, but the emitted event types are `research.*`
 * (`research.text`, `research.tool`) instead of `burn.*`, so a research
 * timeline never carries ticket-burner naming.
 */
export function createResearchStreamThrottle(
  emit: (e: ThrottledEvent) => void,
  opts: Parameters<typeof createStreamThrottle>[1] = {},
): StreamThrottle {
  return createStreamThrottle(
    (e) => emit({ ...e, type: e.type.replace(/^burn\./, 'research.') }),
    opts,
  )
}

// ---------------------------------------------------------------------------
// Pure unit — prompt template rendering
// ---------------------------------------------------------------------------

const PLACEHOLDERS = ['WAYPOINT_JSON', 'FEATURE_BRIEF', 'DOCS_DIGEST', 'RESEARCH_DOC_PATH'] as const
type PlaceholderKey = (typeof PLACEHOLDERS)[number]

/** Replace every `{{KEY}}` placeholder (split/join so `$` and specials are safe). */
export function renderResearchPrompt(
  template: string,
  values: Record<PlaceholderKey, string>,
): string {
  let out = template
  for (const key of PLACEHOLDERS) {
    out = out.split(`{{${key}}}`).join(values[key])
  }
  return out
}

/** The `{{WAYPOINT_JSON}}` payload — the fields the research agent needs. */
export function buildWaypointJson(waypoint: Waypoint): string {
  return JSON.stringify(
    { seq: waypoint.seq, title: waypoint.title, type: waypoint.type, question: waypoint.question },
    null,
    2,
  )
}

// ---------------------------------------------------------------------------
// Run-result interpretation
// ---------------------------------------------------------------------------

/**
 * Map a sandcastle `RunResult` to a terminal research outcome: commits landed →
 * done (the summary doc was written + committed); zero commits → failed (the
 * research produced nothing to resolve the waypoint with).
 */
export function interpretResearchResult(
  result: Pick<RunResult, 'commits'>,
  docRelPath: string,
): ResearchOutcome {
  const commits = result.commits.map((c) => c.sha)
  if (commits.length > 0) return { status: 'done', commits, docRelPath }
  return { status: 'failed', error: 'agent produced no commits — no research summary landed' }
}

// ---------------------------------------------------------------------------
// Real sandcastle boundary (IO) — not exercised by unit tests
// ---------------------------------------------------------------------------

/**
 * Absolute path to the research prompt template. Resolves the skills root the
 * same way everywhere (workspace `packages/skills`, or the vendored root via
 * `RUNCASTLE_SKILLS_DIR` in a published install — issue #51).
 */
export function researchTemplatePath(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  return join(resolveSkillsRoot(here), 'burner', 'research-waypoint.md')
}

/**
 * Run one research waypoint through sandcastle. Renders the prompt, builds the
 * `run()` options (branch strategy targeting a per-run temp branch based on
 * `feature/<slug>`, throttled stream forwarding, abort wiring), interprets
 * commits, then lands the temp branch on the feature branch. Aborts are
 * rethrown so the runner marks the run cancelled.
 */
async function realExecuteResearchRun(
  ctx: WorkflowCtx,
  waypoint: Waypoint,
  config: RuncastleConfig,
  token: string | undefined,
  model: ModelEntry,
): Promise<ResearchOutcome> {
  const { project, feature } = ctx
  const docRelPath = researchDocRel(feature.slug, waypoint)
  // Per-run unique suffix (nanoid alphabet is branch-name-safe) so a re-worked
  // waypoint never reuses a stale sandcastle worktree or a conflict leftover.
  const tempBranch = researchBranchName(feature.slug, waypoint.seq, newId('b').slice(2, 10))

  const template = readFileSync(researchTemplatePath(), 'utf8')
  const prompt = renderResearchPrompt(template, {
    WAYPOINT_JSON: buildWaypointJson(waypoint),
    FEATURE_BRIEF: buildFeatureBrief(feature),
    DOCS_DIGEST: readDocsDigestFromDisk(project.id, feature.slug),
    RESEARCH_DOC_PATH: docRelPath,
  })

  mkdirSync(logsDir(), { recursive: true })
  const logFilePath = join(logsDir(), `research-${feature.id}-${waypoint.seq}.log`)
  const throttle = createResearchStreamThrottle((e) => ctx.emitEvent(e))

  // A container Codex waypoint burns on the operator's ChatGPT login exactly as
  // an implementation ticket does — same mount, same copy, same helpers.
  const codexAuthMount = codexAuthMountFor(model.runtime, config.sandbox)

  const runOptions: RunOptions = {
    agent: buildBurnAgent(config, token, model),
    // Shared with the burner, never hand-rolled here: the local
    // `sandbox === 'docker' ? docker() : noSandbox()` this replaces is how a
    // `podman` config silently became "run the AFK agent on the host".
    sandbox: selectSandbox(config, codexAuthMount ? [codexAuthMount] : []),
    cwd: project.repoPath,
    prompt,
    // Temp branch based on the feature branch tip — the feature branch itself
    // stays free (talk worktree attached, HITL parallel). Merged back below.
    branchStrategy: { type: 'branch', branch: tempBranch, baseBranch: feature.branch },
    signal: ctx.signal,
    name: `research-${waypoint.seq}`,
    ...(codexAuthMount
      ? { hooks: { sandbox: { onSandboxReady: [{ command: buildCodexAuthCopyCommand() }] } } }
      : {}),
    logging: { type: 'file', path: logFilePath, onAgentStreamEvent: throttle.onEvent },
  }

  let result: RunResult | undefined
  /** Commits recovered off the temp branch when only sandcastle's teardown died. */
  let salvaged: string[] = []
  try {
    result = await run(runOptions)
  } catch (err) {
    throttle.flush()
    if (ctx.signal.aborted) throw err // let the runner mark the run cancelled
    const msg = err instanceof Error ? err.message : String(err)
    // Same flake the burner handles (see `isWorktreeTeardownError`): sandcastle
    // rejects when it cannot remove its worktree in the run's release step —
    // after the agent wrote and committed the summary. Recover the commits off
    // the temp branch and land them rather than losing the waypoint's work.
    salvaged = isWorktreeTeardownError(err)
      ? await branchCommitsAhead(project.repoPath, feature.branch, tempBranch)
      : []
    if (salvaged.length === 0) return { status: 'failed', error: msg }
    const removed = await cleanupBurnWorktree(project.repoPath, tempBranch)
    ctx.emitEvent({
      type: 'burn.worktree.teardown-failed',
      message: `waypoint ${waypoint.seq}: agent finished but sandcastle could not remove its worktree (${errorHeadline(msg)})${removed ? ' — cleaned up' : ' — left on disk'}; landing the ${salvaged.length} commit(s) anyway`,
      data: { tempBranch, error: msg, cleanedUp: removed },
    })
  }
  throttle.flush()

  const outcome: ResearchOutcome = result
    ? interpretResearchResult(result, docRelPath)
    : { status: 'done', commits: salvaged, docRelPath }
  if (outcome.status !== 'done') return outcome

  // Land the research commits on the feature branch (run-finalize success path).
  // A conflict means docs moved mid-run (an HITL session committed in parallel):
  // the merge was aborted, the temp branch is preserved, and the run fails with
  // an actionable event — the waypoint stays unresolved and returns to the
  // frontier via the runner's auto-release.
  const merge = await mergeTempBranch(project.repoPath, feature.branch, tempBranch)
  if (!merge.ok) {
    const detail = merge.error ?? 'merge failed'
    ctx.emitEvent({
      type: merge.conflict ? 'merge.conflict.needs-human' : 'research.merge_failed',
      message: merge.conflict
        ? `research branch ${tempBranch} conflicts with ${feature.branch} — merge it manually (git merge ${tempBranch}; resolve; git branch -D ${tempBranch}), then resolve the waypoint`
        : `could not land ${tempBranch} on ${feature.branch}: ${errorHeadline(detail)} — the branch is preserved for manual recovery`,
      data: { tempBranch, featureBranch: feature.branch, conflict: merge.conflict ?? false, error: detail },
    })
    return {
      status: 'failed',
      error: `research committed to ${tempBranch} but merging into ${feature.branch} failed: ${detail}`,
    }
  }

  return outcome
}

/**
 * Resolve production deps: real config, token from `~/.runcastle/.env`, real
 * run. Research is the `research` step (issue #48): its model resolves through
 * `resolveModel` — a per-run override wins over the per-project override, then
 * the global step override, then the global default.
 */
function resolveResearchDeps(ctx: WorkflowCtx): ResearchDeps {
  const config = loadConfig()
  const model = resolveModelEntry('research', config, ctx.project, ctx.modelOverride)
  const token = readTokenFromEnvFile(envPath(), model.runtime)
  return {
    config,
    runtime: model.runtime,
    hasAuthToken: token !== undefined,
    executeResearchRun: (c, waypoint) => realExecuteResearchRun(c, waypoint, config, token, model),
  }
}

export const research: WorkflowDef = {
  id: 'research',
  run: (ctx) => researchRun(ctx, resolveResearchDeps(ctx)),
}
