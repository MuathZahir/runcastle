import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Feature, RuncastleConfig, Waypoint, WorkflowCtx, WorkflowDef } from '@runcastle/core'
import { loadConfig } from '@runcastle/core/config-load'
import { envPath, featureDocsRel, logsDir, worktreeDir } from '@runcastle/core/paths'
import type { RunOptions, RunResult } from '@ai-hero/sandcastle'
import { run } from '@ai-hero/sandcastle'
import { docker } from '@ai-hero/sandcastle/sandboxes/docker'
import { noSandbox } from '@ai-hero/sandcastle/sandboxes/no-sandbox'
import type { StreamThrottle, ThrottledEvent } from './ticket-burner'
import {
  buildBurnAgent,
  buildDocsDigest,
  buildFeatureBrief,
  createStreamThrottle,
  parseEnvFile,
} from './ticket-burner'

/**
 * Research waypoint AFK (mapped ideation, ADR-0001 / SPEC §13.2). A research
 * waypoint is worked headlessly by a run instead of a HITL terminal: the sandbox
 * agent reads the question, researches web + repo, writes the summary under
 * `docs/features/<slug>/research/<waypoint-slug>.md`, and commits to the feature
 * branch. On success the workflow resolves the waypoint with a summary; on
 * failure or cancel it returns without resolving, so the runner's finalizer
 * auto-releases the waypoint back to the frontier (SPEC §13.2 run finalizer).
 *
 * Structure mirrors the ticket-burner: the sandcastle boundary is isolated behind
 * an injectable `executeResearchRun` (see `ResearchDeps`) so the workflow's
 * control flow — auth precheck, resolve-on-success, release-on-failure — is
 * testable against a fake, with no real sandcastle involvement.
 */

const AUTH_MISSING_EVENT = 'auth.missing'
const AUTH_MISSING_MESSAGE =
  'run `claude setup-token` and put CLAUDE_CODE_OAUTH_TOKEN in ~/.runcastle/.env'

/** What one research run resolves to. Aborts are thrown, never returned here. */
export type ResearchOutcome =
  | { readonly status: 'done'; readonly commits: string[]; readonly docRelPath: string }
  | { readonly status: 'failed'; readonly error: string }

export interface ResearchDeps {
  config: RuncastleConfig
  /** Whether a CLAUDE_CODE_OAUTH_TOKEN is available (docker requires it). */
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

  // Auth precheck: docker needs a token before we start any container.
  if (deps.config.sandbox === 'docker' && !deps.hasAuthToken) {
    ctx.emitEvent({ type: AUTH_MISSING_EVENT, message: AUTH_MISSING_MESSAGE })
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
    message: `waypoint ${waypoint.seq} research failed: ${firstLine(outcome.error)}`,
    data: { waypointId: waypoint.id, error: outcome.error },
  })
  return { status: 'failed', summary: outcome.error }
}

function firstLine(s: string): string {
  const i = s.indexOf('\n')
  return (i === -1 ? s : s.slice(0, i)).trim()
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

/** Absolute path to the research prompt template in `packages/skills`. */
function researchTemplatePath(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  return join(here, '..', '..', '..', 'skills', 'burner', 'research-waypoint.md')
}

/** Read `docs/features/<slug>/*.md` from the talk worktree, or a skip note. */
function readDocsDigestFromDisk(projectId: string, slug: string): string {
  const worktree = worktreeDir(projectId, slug)
  if (!existsSync(worktree)) return '_No talk worktree on disk — docs digest skipped._'
  const docsDir = join(worktree, ...featureDocsRel(slug).split('/'))
  if (!existsSync(docsDir)) return '_No docs/features dir in the talk worktree — docs digest skipped._'
  const files = readdirSync(docsDir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.md'))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((e) => ({ name: e.name, content: readFileSync(join(docsDir, e.name), 'utf8') }))
  return buildDocsDigest(files)
}

/**
 * Run one research waypoint through sandcastle. Renders the prompt, builds the
 * `run()` options (branch strategy targeting `feature/<slug>`, throttled stream
 * forwarding, abort wiring), and interprets commits. Aborts are rethrown so the
 * runner marks the run cancelled.
 */
async function realExecuteResearchRun(
  ctx: WorkflowCtx,
  waypoint: Waypoint,
  config: RuncastleConfig,
  token: string | undefined,
): Promise<ResearchOutcome> {
  const { project, feature } = ctx
  const docRelPath = researchDocRel(feature.slug, waypoint)

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

  const runOptions: RunOptions = {
    agent: buildBurnAgent(config, token),
    sandbox:
      config.sandbox === 'docker'
        ? docker(config.sandboxImage ? { imageName: config.sandboxImage } : {})
        : noSandbox(),
    cwd: project.repoPath,
    prompt,
    branchStrategy: { type: 'branch', branch: feature.branch, baseBranch: project.mainBranch },
    signal: ctx.signal,
    name: `research-${waypoint.seq}`,
    logging: { type: 'file', path: logFilePath, onAgentStreamEvent: throttle.onEvent },
  }

  let result: RunResult
  try {
    result = await run(runOptions)
  } catch (err) {
    throttle.flush()
    if (ctx.signal.aborted) throw err // let the runner mark the run cancelled
    return { status: 'failed', error: err instanceof Error ? err.message : String(err) }
  }
  throttle.flush()

  return interpretResearchResult(result, docRelPath)
}

/** Resolve production deps: real config, token from `~/.runcastle/.env`, real run. */
function resolveResearchDeps(): ResearchDeps {
  const config = loadConfig()
  const token = readTokenFromEnvFile(envPath())
  return {
    config,
    hasAuthToken: token !== undefined,
    executeResearchRun: (ctx, waypoint) => realExecuteResearchRun(ctx, waypoint, config, token),
  }
}

/** Read CLAUDE_CODE_OAUTH_TOKEN from the .env file, falling back to process env. */
function readTokenFromEnvFile(path: string): string | undefined {
  let fromFile: string | undefined
  if (existsSync(path)) {
    try {
      fromFile = parseEnvFile(readFileSync(path, 'utf8')).CLAUDE_CODE_OAUTH_TOKEN
    } catch {
      fromFile = undefined
    }
  }
  const token = fromFile && fromFile.length > 0 ? fromFile : process.env.CLAUDE_CODE_OAUTH_TOKEN
  return token && token.length > 0 ? token : undefined
}

export const research: WorkflowDef = {
  id: 'research',
  run: (ctx) => researchRun(ctx, resolveResearchDeps()),
}
