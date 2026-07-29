import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { PreparedKey, Project, RuncastleConfig } from '@runcastle/core'
import { PREPARED_KEYS, newId, resolveModel, resolvePreparedSettings } from '@runcastle/core'
import { loadConfig } from '@runcastle/core/config-load'
import { burnCacheDir, envPath, logsDir } from '@runcastle/core/paths'
import type { RunOptions, RunResult } from '@ai-hero/sandcastle'
import { run } from '@ai-hero/sandcastle'
import * as z from 'zod'
import { resolveSkillsRoot } from '../launcher/skills-root'
import {
  deletePrepBranch,
  headSha,
  prepBranchName,
  readFileAtRef,
} from '../services/git'
import type { CacheMount, StreamThrottle, ThrottledEvent } from './ticket-burner'
import {
  buildBurnAgent,
  buildIsolatedSetupCommand,
  cacheMountFor,
  createStreamThrottle,
  detectPackageManager,
  readRepoToolchain,
  readTokenFromEnvFile,
  resolveBurnWorkspaceMode,
  resolveSetupCommand,
  selectSandbox,
} from './ticket-burner'

/**
 * Project preparation — the run that fills in what nobody fills in.
 *
 * `verifyCommands`, `knownFailures` and friends sit empty on almost every
 * install, and the reason is not that the settings form is unfriendly: these
 * are not preferences, they are FINDINGS. Answering "which tests are already
 * red on main" honestly requires running the suite; answering "how do I verify
 * a change here" requires knowing the workspace filter names. That is agent
 * work, and today it is paid by every burn agent on every ticket and then
 * thrown away (ADR-0008 measured two whole monorepo suite runs lost to guessing
 * one filter name). This run pays it once and records it with evidence.
 *
 * Three design commitments, each load-bearing:
 *
 * 1. **Measured, not inferred.** The agent is required to RUN what it proposes.
 *    Deriving `verifyCommands` by reading `package.json` would automate exactly
 *    the guess that produced the waste — just earlier, and with more confidence
 *    attached to it.
 * 2. **Measured WHERE IT WILL BE USED.** Preparation runs in the same sandbox
 *    image, with the same setup command, that ticket agents get. A baseline
 *    captured in a different environment is not comparable to what those agents
 *    see, and an incomparable baseline is worse than none.
 * 3. **Findings travel by commit, not by stream.** The agent writes
 *    `.runcastle/prep.json` and commits it to a throwaway branch; we read it
 *    with `git show` and delete the branch. Nothing is ever merged, the user's
 *    repo is never polluted, and a dropped agent stream cannot lose the work.
 *
 * Structure mirrors the burner and research: the sandcastle boundary sits
 * behind an injectable `executePrepRun`, so the control flow is testable
 * against a fake with no container involved.
 */

const AUTH_MISSING_EVENT = 'auth.missing'
const AUTH_MISSING_MESSAGE =
  'run `claude setup-token` and put CLAUDE_CODE_OAUTH_TOKEN in ~/.runcastle/.env'

/** Repo-relative path (a git pathspec) the agent writes its findings to. */
export const PREP_FINDINGS_PATH = '.runcastle/prep.json'

/**
 * Ceiling for the pre-agent install hook. Matches the burner's: the same
 * command on the same image, and a cold monorepo install has been measured at
 * several minutes before the agent gets a turn.
 */
const PREP_SETUP_TIMEOUT_MS = 15 * 60_000

// ---------------------------------------------------------------------------
// Pure unit — the findings document
// ---------------------------------------------------------------------------

/** One established fact: the value a later reader uses, plus what justified it. */
export interface PrepFinding {
  value: string
  evidence?: string
}

export interface PrepFindings {
  values: Partial<Record<PreparedKey, PrepFinding>>
  /** The agent's free-text caveats (unrunnable suites, odd bootstraps). */
  notes?: string
}

/**
 * Lenient per-key shape. The agent is told to emit `{value, evidence}`, but a
 * bare string is accepted too: the difference is cosmetic and rejecting the
 * whole document over it would throw away a full suite run.
 */
const RawFinding = z.union([
  z.string(),
  z.object({
    value: z.string().nullish(),
    evidence: z.string().nullish(),
  }),
])

const RawFindings = z
  .object({ notes: z.string().nullish() })
  .catchall(z.unknown())

export interface ParsedPrepFindings {
  findings: PrepFindings
  /** Non-fatal problems worth surfacing (unknown keys, dropped empty values). */
  warnings: string[]
}

/**
 * Parse the agent's findings document.
 *
 * Deliberately forgiving about SHAPE and strict about CONTENT: unknown keys are
 * reported and skipped rather than failing the run, but a key whose value is
 * absent/empty is DROPPED, because "no value" is a legitimate and expected
 * outcome ("this repo has no database") and must never reach the settings as an
 * empty string that reads like a real answer.
 *
 * Throws only when the document is not parseable JSON at all — at that point
 * there is nothing to salvage and the run genuinely failed.
 */
export function parsePrepFindings(raw: string): ParsedPrepFindings {
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch (e) {
    throw new Error(`findings file is not valid JSON: ${e instanceof Error ? e.message : String(e)}`)
  }

  const outer = RawFindings.safeParse(json)
  if (!outer.success) throw new Error('findings file is not a JSON object')

  const warnings: string[] = []
  const values: Partial<Record<PreparedKey, PrepFinding>> = {}
  const known = new Set<string>(PREPARED_KEYS)

  for (const [key, rawValue] of Object.entries(outer.data)) {
    if (key === 'notes') continue
    if (!known.has(key)) {
      warnings.push(`ignored unknown key "${key}"`)
      continue
    }
    const parsed = RawFinding.safeParse(rawValue)
    if (!parsed.success) {
      warnings.push(`ignored "${key}": not a string or {value, evidence} object`)
      continue
    }
    const entry = parsed.data
    const value = (typeof entry === 'string' ? entry : (entry.value ?? '')).trim()
    if (value === '') continue // "could not establish" — the honest empty state
    const evidence = typeof entry === 'string' ? undefined : entry.evidence?.trim()
    values[key as PreparedKey] = { value, ...(evidence ? { evidence } : {}) }
  }

  const notes = outer.data.notes?.trim()
  return { findings: { values, ...(notes ? { notes } : {}) }, warnings }
}

// ---------------------------------------------------------------------------
// Pure unit — prompt rendering
// ---------------------------------------------------------------------------

const PLACEHOLDERS = ['REQUESTED_KEYS', 'SETUP_COMMAND'] as const
type PlaceholderKey = (typeof PLACEHOLDERS)[number]

/** Replace every `{{KEY}}` placeholder (split/join so `$` and specials are safe). */
export function renderPrepPrompt(
  template: string,
  values: Record<PlaceholderKey, string>,
): string {
  let out = template
  for (const key of PLACEHOLDERS) {
    out = out.split(`{{${key}}}`).join(values[key])
  }
  return out
}

/** What each key means, as the prompt states the ask. */
const KEY_BRIEF: Record<PreparedKey, string> = {
  setupCommand:
    '**`setupCommand`** — the command that takes a clean checkout to a state where the code builds and tests run: dependency install, plus any codegen or contract build that every task would otherwise discover it needed mid-flight (ORM client generation, protobuf, a `contracts:build` step). Run it and report what worked.',
  verifyCommands:
    '**`verifyCommands`** — the exact typecheck / test / lint commands for this repo, one per line. In a monorepo these must include the correct workspace filter names. Run each one and confirm it executes the thing it claims to.',
  knownFailures:
    '**`knownFailures`** — which tests are ALREADY failing on this checkout, before anything is changed. Run the full suite once and report the count plus the failing suite names. "0 known failures" is a real, useful answer.',
  devCommand:
    "**`devCommand`** — the command that starts this project's dev server on a developer's own machine. Read it from config; do not run it here.",
  driveSetupCommand:
    "**`driveSetupCommand`** — a single shell command that takes this repo from a fresh checkout to \"the dev server would actually work\": backing services up, schema applied, whatever this project needs. Chain steps with `&&`. Read it from the repo's own config (compose file, Makefile, package scripts, README); do not run it here. Omit it if the dev command alone is enough — an empty answer is better than a guessed one, because this runs on a developer's real machine.",
  driveStopCommand:
    '**`driveStopCommand`** — the matching teardown for `driveSetupCommand`, if this project has one (`docker compose down`, a stop script). Read it from config; do not run it here. Omit it if setup leaves nothing that needs stopping.',
  driveEnv:
    "**`driveEnv`** — `KEY=VALUE` lines (one per line) overlaid on the dev server's environment during a test drive, with `{{slug}}`, `{{branch}}` and `{{id}}` (an identifier-safe slug) rendered per drive. Its purpose is giving a branch its own database, e.g. `DATABASE_URL=postgres://localhost:5432/myapp_{{id}}` paired with a `driveSetupCommand` that creates it. Report it ONLY if you can read the real connection variable's name and shape out of the repo's own config or `.env.example`; a connection string you assembled from defaults points at the wrong database convincingly, which is worse than omitting the key. Omit it if the project has no database or you had to guess the host, port or credentials.",
  dbResetCommand:
    '**`dbResetCommand`** — the command that rebuilds the dev database from the migrations currently in the working tree. Read it from config; do not run it here. Omit it entirely if this repo has no database.',
}

/**
 * The `{{REQUESTED_KEYS}}` block: only the keys this run is actually allowed to
 * establish. Keys a human has already answered are omitted rather than listed
 * as "skip these" — an agent asked to establish a fact and then told to discard
 * it still pays for the discovery.
 */
export function buildRequestedKeysBlock(keys: readonly PreparedKey[]): string {
  if (keys.length === 0) {
    return '_Everything is already established. Report an empty findings object and stop._'
  }
  const order = new Map<string, number>(PREPARED_KEYS.map((k, i) => [k, i]))
  return [...keys]
    .sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0))
    .map((k) => `- ${KEY_BRIEF[k]}`)
    .join('\n')
}

// ---------------------------------------------------------------------------
// Workflow control flow (testable against a fake `executePrepRun`)
// ---------------------------------------------------------------------------

/** What one preparation run resolves to. Aborts are thrown, never returned. */
export type PrepOutcome =
  | { readonly status: 'done'; readonly findings: PrepFindings; readonly warnings: string[] }
  | { readonly status: 'failed'; readonly error: string }

/** The project-scoped context a preparation run works against. */
export interface PrepCtx {
  project: Project
  /** Requested keys — those not already answered by a human. */
  keys: readonly PreparedKey[]
  emitEvent: (e: ThrottledEvent) => void
  signal: AbortSignal
}

export interface PrepDeps {
  config: RuncastleConfig
  /** Whether a CLAUDE_CODE_OAUTH_TOKEN is available (container sandboxes require it). */
  hasAuthToken: boolean
  executePrepRun: (ctx: PrepCtx) => Promise<PrepOutcome>
}

export interface PrepResult {
  status: 'succeeded' | 'failed'
  summary: string
  findings?: PrepFindings
}

/**
 * The testable core: auth precheck, the nothing-to-do short-circuit, delegation
 * to the sandbox, and the summary. Applying the findings is the caller's job
 * (services/prep.ts) — this module never touches the database.
 */
export async function prepRun(ctx: PrepCtx, deps: PrepDeps): Promise<PrepResult> {
  if (ctx.keys.length === 0) {
    ctx.emitEvent({
      type: 'prep.skipped',
      message: 'nothing to prepare — every field is already set',
    })
    return { status: 'succeeded', summary: 'nothing to prepare' }
  }

  if (deps.config.sandbox !== 'noSandbox' && !deps.hasAuthToken) {
    ctx.emitEvent({ type: AUTH_MISSING_EVENT, message: AUTH_MISSING_MESSAGE })
    return { status: 'failed', summary: 'preparation aborted: auth token missing' }
  }

  ctx.emitEvent({
    type: 'prep.started',
    message: `preparing ${ctx.project.name} — establishing ${ctx.keys.join(', ')}`,
    data: { keys: [...ctx.keys] },
  })

  const outcome = await deps.executePrepRun(ctx) // throws on abort — propagates

  if (outcome.status === 'failed') {
    ctx.emitEvent({
      type: 'prep.failed',
      message: `preparation failed: ${errorHeadline(outcome.error)}`,
      data: { error: outcome.error },
    })
    return { status: 'failed', summary: outcome.error }
  }

  for (const warning of outcome.warnings) {
    ctx.emitEvent({ type: 'prep.warning', message: `preparation: ${warning}` })
  }

  const found = Object.keys(outcome.findings.values)
  const missed = ctx.keys.filter((k) => !found.includes(k))
  const summary =
    found.length === 0
      ? 'preparation established nothing'
      : `established ${found.join(', ')}${missed.length > 0 ? ` (could not establish ${missed.join(', ')})` : ''}`

  return { status: 'succeeded', summary, findings: outcome.findings }
}

/**
 * The most informative single line of a multi-line error — git buries the cause
 * under progress noise, so prefer the last `fatal:`/`error:` line.
 */
export function errorHeadline(s: string): string {
  const lines = s
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  const causes = lines.filter((l) => /^(fatal|error):/i.test(l))
  return causes.at(-1) ?? lines[0] ?? ''
}

/**
 * Stream throttle for preparation runs: the burner's batching and payload
 * shapes, re-typed to `prep.*` so a project timeline never carries burn naming.
 */
export function createPrepStreamThrottle(
  emit: (e: ThrottledEvent) => void,
  opts: Parameters<typeof createStreamThrottle>[1] = {},
): StreamThrottle {
  return createStreamThrottle((e) => emit({ ...e, type: e.type.replace(/^burn\./, 'prep.') }), opts)
}

// ---------------------------------------------------------------------------
// Real sandcastle boundary (IO) — not exercised by unit tests
// ---------------------------------------------------------------------------

/**
 * Make the pre-agent dependency install best-effort.
 *
 * Preparation exists to ESTABLISH `setupCommand`. Letting it die because the
 * *guess* at that command failed is the one failure mode it must not have — and
 * it is not hypothetical: two real repos killed a run each here before the agent
 * got a single turn. One had an untracked lockfile the sandbox clone never saw;
 * the other had a genuine peer-dependency conflict (`@types/react-dom` wanting a
 * newer `@types/react` than the project pinned) that no install command we could
 * have guessed would resolve. In both cases the agent was well placed to find
 * what actually works — `--legacy-peer-deps`, the flag the error itself names,
 * whatever CI does — and report it with evidence. It never got the chance.
 *
 * So the install may fail; the agent starts anyway and is told (see the prompt
 * template) to verify the workspace really installed before trusting any test
 * result. A missing `node_modules` is a fact the agent can measure and fix. An
 * aborted run is not.
 *
 * **Prep only.** The burner keeps its fail-fast install: a ticket agent without
 * dependencies produces garbage commits, and there failing early is cheaper than
 * discovering it late. The asymmetry is the point — prep's job IS the unknown
 * install, the burner's job assumes a known one.
 *
 * Parenthesised for the same precedence reason as the fallback in
 * {@link resolveSetupCommand}: callers join with ` && `, so a bare `|| true`
 * would swallow the failure of every step before it — including the clone,
 * whose failure must stay fatal.
 */
export function nonFatalSetup(setupCommand: string): string {
  return `( ${setupCommand} || true )`
}

/** Absolute path to the preparation prompt template (workspace or vendored). */
export function prepTemplatePath(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  return join(resolveSkillsRoot(here), 'burner', 'prepare-project.md')
}

/**
 * Run one preparation through sandcastle and read back the committed findings.
 *
 * The branch is throwaway: it exists only so the agent's structured output
 * lands somewhere deterministic, and it is deleted in `finally` whatever
 * happens. Nothing is merged, so the user's branches are untouched even when a
 * run fails halfway.
 */
async function realExecutePrepRun(
  ctx: PrepCtx,
  config: RuncastleConfig,
  token: string | undefined,
  model: string,
): Promise<PrepOutcome> {
  const { project } = ctx
  const branch = prepBranchName(newId('b').slice(2, 10))

  const toolchain = readRepoToolchain(project.repoPath)
  const pm = detectPackageManager(toolchain)
  // Prepared settings resolve project-first: a re-prepare of a project that
  // already has a setup command should bootstrap the way its tickets will.
  const prepared = resolvePreparedSettings(config, project)
  const setupCommand = resolveSetupCommand(toolchain, prepared.setupCommand)
  const workspaceMode = resolveBurnWorkspaceMode(config)

  const mounts: CacheMount[] = []
  if (config.sandbox !== 'noSandbox' && pm) {
    const mount = cacheMountFor(pm, burnCacheDir(pm))
    if (mount) {
      mkdirSync(mount.hostPath, { recursive: true }) // a missing hostPath fails sandbox creation
      mounts.push(mount)
    }
  }

  const template = readFileSync(prepTemplatePath(), 'utf8')
  const prompt = renderPrepPrompt(template, {
    REQUESTED_KEYS: buildRequestedKeysBlock(ctx.keys),
    SETUP_COMMAND: setupCommand ?? '(no install step detected)',
  })

  mkdirSync(logsDir(), { recursive: true })
  const logFilePath = join(logsDir(), `prep-${project.id}.log`)
  const throttle = createPrepStreamThrottle((e) => ctx.emitEvent(e))

  if (setupCommand) {
    ctx.emitEvent({
      type: 'prep.setup',
      message: `attempting a dependency install before the agent starts (best-effort): ${setupCommand}`,
    })
  }

  // Best-effort: a failed install must not abort the run (see nonFatalSetup).
  // The prompt still shows the UNWRAPPED command — the `|| true` is plumbing,
  // and quoting it at the agent would only muddy what it is asked to verify.
  const prepSetupCommand = setupCommand ? nonFatalSetup(setupCommand) : undefined

  const hookCommand =
    workspaceMode === 'isolated'
      ? buildIsolatedSetupCommand(branch, prepSetupCommand, pm)
      : prepSetupCommand

  const runOptions: RunOptions = {
    agent: buildBurnAgent(config, token, model),
    sandbox: selectSandbox(config, mounts),
    cwd: project.repoPath,
    prompt,
    // Based on the project's main branch: preparation measures the repo as it
    // ships, which is the same baseline every ticket agent forks from.
    branchStrategy: { type: 'branch', branch, baseBranch: project.mainBranch },
    signal: ctx.signal,
    name: 'prepare',
    // One iteration: preparation is measurement, not construction. A second
    // `claude --print` against the same worktree would re-run the full suite
    // from scratch (sandcastle rebuilds the container per iteration), and a
    // run that ended without committing findings has no partial work worth
    // resuming — it is cheaper and more honest to report that it established
    // nothing than to pay for another whole suite run hoping for better.
    maxIterations: 1,
    ...(hookCommand
      ? {
          hooks: {
            sandbox: {
              onSandboxReady: [{ command: hookCommand, timeoutMs: PREP_SETUP_TIMEOUT_MS }],
            },
          },
        }
      : {}),
    logging: { type: 'file', path: logFilePath, onAgentStreamEvent: throttle.onEvent },
  }

  try {
    let result: RunResult | undefined
    try {
      result = await run(runOptions)
    } catch (err) {
      throttle.flush()
      if (ctx.signal.aborted) throw err // let the caller mark the run cancelled
      // Sandcastle can reject in its teardown step AFTER the agent committed
      // (a Windows worktree-removal race). The findings live on the branch
      // either way, so fall through and try to read them before giving up.
      const msg = err instanceof Error ? err.message : String(err)
      const salvaged = await readFindings(project.repoPath, branch)
      if (!salvaged) return { status: 'failed', error: msg }
      ctx.emitEvent({
        type: 'prep.salvaged',
        message: `the agent finished but sandcastle errored on teardown (${errorHeadline(msg)}) — reading the findings it committed anyway`,
      })
      return salvaged
    }
    throttle.flush()

    if (result.commits.length === 0) {
      return {
        status: 'failed',
        error: `agent produced no commits — no ${PREP_FINDINGS_PATH} landed`,
      }
    }
    const read = await readFindings(project.repoPath, branch)
    return (
      read ?? {
        status: 'failed',
        error: `agent committed, but ${PREP_FINDINGS_PATH} is missing from ${branch}`,
      }
    )
  } finally {
    await deletePrepBranch(project.repoPath, branch)
  }
}

/** Read + parse the committed findings file, or `undefined` when absent. */
async function readFindings(repoPath: string, branch: string): Promise<PrepOutcome | undefined> {
  const raw = await readFileAtRef(repoPath, branch, PREP_FINDINGS_PATH)
  if (raw === undefined) return undefined
  try {
    const { findings, warnings } = parsePrepFindings(raw)
    return { status: 'done', findings, warnings }
  } catch (e) {
    return { status: 'failed', error: e instanceof Error ? e.message : String(e) }
  }
}

/** Resolve production deps: real config, token from `~/.runcastle/.env`, real run. */
export function resolvePrepDeps(project: Project): PrepDeps {
  const config = loadConfig()
  const token = readTokenFromEnvFile(envPath())
  const model = resolveModel('prepare', config, project)
  return {
    config,
    hasAuthToken: token !== undefined,
    executePrepRun: (c) => realExecutePrepRun(c, config, token, model),
  }
}

/** The main-branch sha a run's findings are stamped with, if git can report it. */
export async function prepHeadSha(project: Project): Promise<string | undefined> {
  return existsSync(project.repoPath) ? headSha(project.repoPath, project.mainBranch) : undefined
}
