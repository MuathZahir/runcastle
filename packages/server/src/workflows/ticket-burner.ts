import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type {
  Feature,
  RuncastleConfig,
  Ticket,
  TicketStatus,
  WorkflowCtx,
  WorkflowDef,
} from '@runcastle/core'
import { loadConfig } from '@runcastle/core/config-load'
import { envPath, featureDocsRel, logsDir, worktreeDir } from '@runcastle/core/paths'
import type {
  AgentCommandOptions,
  AgentProvider,
  AgentStreamEvent,
  ClaudeCodeOptions,
  PrintCommand,
  RunOptions,
  RunResult,
} from '@ai-hero/sandcastle'
import { claudeCode, run } from '@ai-hero/sandcastle'
import { docker } from '@ai-hero/sandcastle/sandboxes/docker'
import { noSandbox } from '@ai-hero/sandcastle/sandboxes/no-sandbox'

/**
 * Ticket burner — WAVE B3 (SPEC §8), the AFK engine over `@ai-hero/sandcastle`
 * 0.12.0. One `claude --print` agent run per ticket, in topological order of
 * `blockedBy` (global seq numbers per docs/research/CORRECTIONS.md C1), commits
 * landing on `feature/<slug>` via sandcastle's `branch` strategy.
 *
 * Structure: the pure units (topo/cycle, seq→ticket resolution, template
 * rendering, .env parsing, run-result interpretation, the stream throttler) are
 * exported and unit-tested with no sandcastle involvement. The sandcastle
 * boundary is isolated behind an injectable `executeTicketRun` (see `BurnDeps`)
 * so the scheduler (ready-queue, blocked-by-failed cascade, success/failure/
 * conflict/zero-commit handling) is testable against a fake.
 *
 * Branch-strategy note: `{ type: 'branch', branch: 'feature/<slug>' }` is the
 * only strategy that guarantees commits land on the feature branch regardless of
 * what branch the host checkout (`project.repoPath`) is on — at burn time the
 * host is still on `mainBranch` (B2 creates the feature branch without checking
 * it out), so `head`/`merge-to-head` would write to `main`. See the module's
 * final report for the live-run risks this choice trades against.
 */

/** M1 worker-pool width; M2 raises this constant (SPEC §8). */
export const CONCURRENCY = 1

const AUTH_MISSING_EVENT = 'auth.missing'
const AUTH_MISSING_MESSAGE =
  'run `claude setup-token` and put CLAUDE_CODE_OAUTH_TOKEN in ~/.runcastle/.env'

// ---------------------------------------------------------------------------
// Outcome + dependency shapes (the sandcastle boundary)
// ---------------------------------------------------------------------------

/** What one ticket run resolves to. Aborts are thrown, never returned here. */
export type TicketOutcome =
  | { readonly status: 'done'; readonly commits: string[] }
  | {
      readonly status: 'failed'
      readonly error: string
      /** Extra event emitted before the generic `ticket.failed` (e.g. conflict). */
      readonly event?: { type: string; message: string }
    }

export interface BurnDeps {
  config: RuncastleConfig
  /** Whether a CLAUDE_CODE_OAUTH_TOKEN is available (docker requires it). */
  hasAuthToken: boolean
  /** Runs one ticket to a terminal outcome. Real impl calls sandcastle `run()`. */
  executeTicketRun: (ctx: WorkflowCtx, ticket: Ticket) => Promise<TicketOutcome>
}

// ---------------------------------------------------------------------------
// Pure unit — seq→ticket resolution
// ---------------------------------------------------------------------------

/** Index tickets by their global `seq` (the space `blockedBy` references). */
export function indexBySeq(tickets: Ticket[]): Map<number, Ticket> {
  return new Map(tickets.map((t) => [t.seq, t]))
}

// ---------------------------------------------------------------------------
// Pure unit — cycle detection over blockedBy edges
// ---------------------------------------------------------------------------

/**
 * Detect a dependency cycle among `tickets` following `blockedBy` (global seq)
 * edges. Returns the cycle as a list of seq numbers (closing back on the first),
 * or `null` when the graph is acyclic. Edges to seqs outside the set are ignored
 * (they can never be part of a cycle within the set).
 */
export function detectCycle(tickets: Ticket[]): number[] | null {
  const bySeq = indexBySeq(tickets)
  const WHITE = 0
  const GRAY = 1
  const BLACK = 2
  const color = new Map<number, number>()
  const stack: number[] = []

  const dfs = (seq: number): number[] | null => {
    color.set(seq, GRAY)
    stack.push(seq)
    const t = bySeq.get(seq)
    if (t) {
      for (const b of t.blockedBy) {
        if (!bySeq.has(b)) continue
        const c = color.get(b) ?? WHITE
        if (c === GRAY) {
          const idx = stack.indexOf(b)
          return [...stack.slice(idx), b]
        }
        if (c === WHITE) {
          const found = dfs(b)
          if (found) return found
        }
      }
    }
    color.set(seq, BLACK)
    stack.pop()
    return null
  }

  for (const t of tickets) {
    if ((color.get(t.seq) ?? WHITE) === WHITE) {
      const found = dfs(t.seq)
      if (found) return found
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Pure unit — prompt template rendering
// ---------------------------------------------------------------------------

const PLACEHOLDERS = ['TICKET_JSON', 'FEATURE_BRIEF', 'DOCS_DIGEST', 'COMMIT_CONVENTION'] as const
type PlaceholderKey = (typeof PLACEHOLDERS)[number]

/**
 * Replace every `{{KEY}}` placeholder in the burner template with its value.
 * Uses split/join (not RegExp) so values may contain `$` and special chars
 * safely, and replaces all occurrences of each key.
 */
export function renderTicketPrompt(
  template: string,
  values: Record<PlaceholderKey, string>,
): string {
  let out = template
  for (const key of PLACEHOLDERS) {
    out = out.split(`{{${key}}}`).join(values[key])
  }
  return out
}

/** The `{{TICKET_JSON}}` payload — the fields an unattended agent needs. */
export function buildTicketJson(ticket: Ticket): string {
  return JSON.stringify(
    {
      seq: ticket.seq,
      title: ticket.title,
      goal: ticket.goal,
      context: ticket.context,
      acceptanceCriteria: ticket.acceptanceCriteria,
      seams: ticket.seams,
      blockedBy: ticket.blockedBy,
    },
    null,
    2,
  )
}

/** The `{{FEATURE_BRIEF}}` block — title / oneLiner / slug / branch. */
export function buildFeatureBrief(feature: Feature): string {
  return [
    `**${feature.title}** (\`${feature.slug}\`)`,
    '',
    feature.oneLiner,
    '',
    `Working branch: \`${feature.branch}\``,
  ].join('\n')
}

/** The `{{DOCS_DIGEST}}` block from the feature's `docs/features/<slug>/*.md`. */
export function buildDocsDigest(files: { name: string; content: string }[]): string {
  if (files.length === 0) {
    return '_No feature docs found — work from the ticket context and the code._'
  }
  return files.map((f) => `### ${f.name}\n\n${f.content.trim()}`).join('\n\n---\n\n')
}

// ---------------------------------------------------------------------------
// Pure unit — .env parsing (no dependency)
// ---------------------------------------------------------------------------

/**
 * Parse `KEY=VALUE` lines into a record. Ignores blank lines and `#` comments,
 * tolerates a leading `export `, and strips one layer of matching surrounding
 * quotes from the value. First occurrence of `=` splits key from value.
 */
export function parseEnvFile(content: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line.length === 0 || line.startsWith('#')) continue
    const body = line.startsWith('export ') ? line.slice(7).trim() : line
    const eq = body.indexOf('=')
    if (eq === -1) continue
    const key = body.slice(0, eq).trim()
    if (key.length === 0) continue
    let value = body.slice(eq + 1).trim()
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1)
    }
    out[key] = value
  }
  return out
}

// ---------------------------------------------------------------------------
// Pure unit — stream-event throttle (batch text, pass tool calls through)
// ---------------------------------------------------------------------------

export interface ThrottledEvent {
  type: string
  message: string
  data?: unknown
}

export interface StreamThrottle {
  /** Feed one sandcastle stream event; may emit 0..1 throttled events. */
  onEvent(event: AgentStreamEvent): void
  /** Emit any buffered text (call once when the run ends). */
  flush(): void
}

/**
 * Throttle sandcastle's per-chunk stream so the UI timeline gets coarse events,
 * never one-per-token: `text` chunks accumulate and flush at ~`intervalMs` or
 * `maxChars` (whichever first, evaluated per incoming event); `toolCall`s flush
 * pending text then emit immediately with name + a truncated arg summary; `raw`
 * lines are ignored (only present under `verbose`). `now` is injectable so the
 * time-based path is deterministic in tests.
 */
export function createStreamThrottle(
  emit: (e: ThrottledEvent) => void,
  opts: { intervalMs?: number; maxChars?: number; now?: () => number } = {},
): StreamThrottle {
  const intervalMs = opts.intervalMs ?? 2000
  const maxChars = opts.maxChars ?? 500
  const now = opts.now ?? Date.now

  let buffer = ''
  let lastIteration = 0
  let lastFlush = now()

  const flushText = (): void => {
    if (buffer.length === 0) return
    emit({ type: 'burn.text', message: buffer, data: { iteration: lastIteration } })
    buffer = ''
    lastFlush = now()
  }

  const onEvent = (event: AgentStreamEvent): void => {
    if (event.type === 'text') {
      lastIteration = event.iteration
      buffer += event.message
      if (buffer.length >= maxChars || now() - lastFlush >= intervalMs) flushText()
    } else if (event.type === 'toolCall') {
      lastIteration = event.iteration
      flushText()
      const rawArgs = event.formattedArgs ?? ''
      const args = rawArgs.length > 200 ? `${rawArgs.slice(0, 200)}…` : rawArgs
      emit({
        type: 'burn.tool',
        message: args.length > 0 ? `${event.name} ${args}` : event.name,
        data: { name: event.name, args: rawArgs, iteration: event.iteration },
      })
    }
    // 'raw' events are ignored — verbose is off, so they should not arrive.
  }

  return { onEvent, flush: flushText }
}

// ---------------------------------------------------------------------------
// Pure unit — run-result interpretation
// ---------------------------------------------------------------------------

/**
 * Map a sandcastle `RunResult` (commits) plus optional BLOCKED.md content to a
 * terminal ticket outcome (SPEC §8): commits landed → done; zero commits with a
 * BLOCKED.md → failed carrying its content; zero commits and no BLOCKED.md →
 * `agent made no commits`.
 */
export function interpretRunResult(
  result: Pick<RunResult, 'commits'>,
  blockedContent: string | undefined,
): TicketOutcome {
  const commits = result.commits.map((c) => c.sha)
  if (commits.length > 0) return { status: 'done', commits }
  if (blockedContent !== undefined && blockedContent.trim().length > 0) {
    return { status: 'failed', error: `agent reported BLOCKED:\n${blockedContent.trim()}` }
  }
  return { status: 'failed', error: 'agent made no commits' }
}

/** Heuristic: did `run()` throw because a branch merge conflicted? */
export function isMergeConflictError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : typeof err === 'string' ? err : ''
  return (
    /conflict/i.test(msg) || /git branch -D/i.test(msg) || /automatic merge failed/i.test(msg)
  )
}

// ---------------------------------------------------------------------------
// Scheduler — worker pool over the ready queue (concurrency = CONCURRENCY)
// ---------------------------------------------------------------------------

type ReadyState = 'ready' | 'wait' | { blockedBy: number; present: boolean }

function firstLine(s: string): string {
  const i = s.indexOf('\n')
  return (i === -1 ? s : s.slice(0, i)).trim()
}

/**
 * Drive tickets to terminal states honouring `blockedBy`. A ticket is ready when
 * all its blockers are `done`; a ticket with a `failed`/missing blocker is
 * marked failed (`blocked by failed ticket <seq>`) and cascades to its own
 * dependents. Runs up to `CONCURRENCY` at once. Aborts propagate (thrown by
 * `execute`) so the runner finalizes the run as cancelled. Returns the count of
 * tickets in `done` state at the end.
 */
export async function burnTickets(
  ctx: WorkflowCtx,
  tickets: Ticket[],
  execute: (ctx: WorkflowCtx, ticket: Ticket) => Promise<TicketOutcome>,
): Promise<number> {
  const bySeq = indexBySeq(tickets)
  const status = new Map<number, TicketStatus>(tickets.map((t) => [t.seq, t.status]))
  const pending = new Set<number>(tickets.filter((t) => t.status === 'pending').map((t) => t.seq))
  const inFlight = new Map<number, Promise<void>>()

  const readyState = (seq: number): ReadyState => {
    const t = bySeq.get(seq)
    if (!t) return 'wait'
    for (const b of t.blockedBy) {
      const present = bySeq.has(b)
      const bs = present ? status.get(b) : undefined
      if (!present || bs === 'failed') return { blockedBy: b, present }
    }
    return t.blockedBy.every((b) => status.get(b) === 'done') ? 'ready' : 'wait'
  }

  const failTicket = (seq: number, error: string, extra?: { type: string; message: string }) => {
    const t = bySeq.get(seq)
    status.set(seq, 'failed')
    if (!t) return
    ctx.updateTicket(t.id, { status: 'failed', error })
    if (extra) ctx.emitEvent({ ...extra, ticketId: t.id })
  }

  const runOne = async (seq: number): Promise<void> => {
    const t = bySeq.get(seq)
    if (!t) return
    status.set(seq, 'burning')
    ctx.updateTicket(t.id, { status: 'burning' })
    ctx.emitEvent({
      type: 'ticket.burning',
      message: `burning ticket ${t.seq}: ${t.title}`,
      ticketId: t.id,
    })

    const outcome = await execute(ctx, t) // throws on abort — propagates
    if (outcome.status === 'done') {
      status.set(seq, 'done')
      ctx.updateTicket(t.id, { status: 'done', commits: outcome.commits })
      ctx.emitEvent({
        type: 'ticket.done',
        message: `ticket ${t.seq} done — ${outcome.commits.length} commit(s)`,
        ticketId: t.id,
        data: { commits: outcome.commits },
      })
    } else {
      failTicket(seq, outcome.error, outcome.event)
      ctx.emitEvent({
        type: 'ticket.failed',
        message: `ticket ${t.seq} failed: ${firstLine(outcome.error)}`,
        ticketId: t.id,
        data: { error: outcome.error },
      })
    }
  }

  while (pending.size > 0 || inFlight.size > 0) {
    ctx.signal.throwIfAborted()

    // 1) Cascade: fail every pending ticket blocked by a failed/missing blocker.
    for (const seq of [...pending]) {
      const st = readyState(seq)
      if (typeof st === 'object') {
        pending.delete(seq)
        const t = bySeq.get(seq)
        const reason = st.present
          ? `blocked by failed ticket ${st.blockedBy}`
          : `blocked by missing ticket ${st.blockedBy}`
        failTicket(seq, reason)
        if (t) {
          ctx.emitEvent({
            type: 'ticket.blocked',
            message: `ticket ${t.seq} ${reason}`,
            ticketId: t.id,
            data: { reason, blockedBy: st.blockedBy },
          })
        }
      }
    }

    // 2) Fill the pool with ready tickets.
    while (inFlight.size < CONCURRENCY) {
      const readySeq = [...pending].find((seq) => readyState(seq) === 'ready')
      if (readySeq === undefined) break
      pending.delete(readySeq)
      const p = runOne(readySeq).finally(() => {
        inFlight.delete(readySeq)
      })
      inFlight.set(readySeq, p)
    }

    if (inFlight.size > 0) {
      await Promise.race(inFlight.values())
    } else if (pending.size > 0) {
      // Defensive: acyclic + no failed blockers guarantees a ready or blocked
      // ticket, so this should be unreachable. Fail the rest rather than spin.
      for (const seq of [...pending]) {
        pending.delete(seq)
        const t = bySeq.get(seq)
        failTicket(seq, 'unresolvable dependencies')
        if (t) {
          ctx.emitEvent({
            type: 'ticket.blocked',
            message: `ticket ${t.seq} has unresolvable dependencies`,
            ticketId: t.id,
          })
        }
      }
    }
  }

  let done = 0
  for (const s of status.values()) if (s === 'done') done += 1
  return done
}

// ---------------------------------------------------------------------------
// Workflow entry — auth precheck, cycle guard, schedule, summarise
// ---------------------------------------------------------------------------

/**
 * The testable core of the burner: everything except how `BurnDeps` are
 * resolved (config load, token read, real sandcastle call). Tests pass a fake
 * `executeTicketRun` + config to exercise success/failure/conflict/zero-commit,
 * the blocked-by-failed cascade, cycle detection and the auth precheck.
 */
export async function burnRun(
  ctx: WorkflowCtx,
  deps: BurnDeps,
): Promise<{ status: 'succeeded' | 'failed'; summary: string }> {
  const tickets = ctx.tickets
  const total = tickets.length

  // Auth precheck: docker needs a token before we start any container.
  if (deps.config.sandbox === 'docker' && !deps.hasAuthToken) {
    ctx.emitEvent({ type: AUTH_MISSING_EVENT, message: AUTH_MISSING_MESSAGE })
    return { status: 'failed', summary: 'burn aborted: auth token missing' }
  }

  // Cycle guard: fail the whole run before touching any ticket.
  const cycle = detectCycle(tickets)
  if (cycle) {
    const path = cycle.join(' → ')
    ctx.emitEvent({
      type: 'burn.cycle',
      message: `dependency cycle detected: ${path}`,
      data: { cycle },
    })
    return { status: 'failed', summary: `dependency cycle: ${path}` }
  }

  const done = await burnTickets(ctx, tickets, deps.executeTicketRun)
  const summary = `${done}/${total} tickets done`
  ctx.emitEvent({ type: 'burn.summary', message: summary, data: { done, total } })
  return { status: done === total ? 'succeeded' : 'failed', summary }
}

// ---------------------------------------------------------------------------
// Real sandcastle boundary (IO) — not exercised by unit tests
// ---------------------------------------------------------------------------

/** Absolute path to the burner prompt template in `packages/skills`. */
function burnerTemplatePath(): string {
  // …/packages/server/src/workflows -> …/packages/skills/burner/implement-ticket.md
  const here = dirname(fileURLToPath(import.meta.url))
  return join(here, '..', '..', '..', 'skills', 'burner', 'implement-ticket.md')
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

/** First-found `BLOCKED.md` across candidate dirs (worktree first, then repo). */
function readBlockedFile(dirs: (string | undefined)[]): string | undefined {
  for (const dir of dirs) {
    if (!dir) continue
    const p = join(dir, 'BLOCKED.md')
    if (existsSync(p)) {
      try {
        return readFileSync(p, 'utf8')
      } catch {
        /* fall through */
      }
    }
  }
  return undefined
}

/**
 * Build the sandcastle claude agent for a burn, working around two host/Windows
 * gaps in `@ai-hero/sandcastle` 0.12.0's `noSandbox` provider (docker is
 * unaffected — it runs inside a Linux container with a POSIX shell):
 *
 * 1. **Permissions.** For `noSandbox`, sandcastle forces
 *    `dangerouslySkipPermissions=false` (never auto-skip on the host) and passes
 *    NO `--permission-mode`, so the `claude --print` agent runs in the default
 *    mode and cannot apply edits — every ticket makes zero commits. We pass
 *    `permissionMode: 'bypassPermissions'` for noSandbox (the same effect docker
 *    gets from `--dangerously-skip-permissions` inside its container) so the AFK
 *    agent can actually write files; the noSandbox user has opted into host
 *    execution. Docker keeps sandcastle's default.
 * 2. **Windows model quoting.** sandcastle POSIX-single-quotes the `--model`
 *    value (`shellEscape`), but its noSandbox exec runs through
 *    `cmd.exe /d /s /c` with verbatim args on Windows, and cmd.exe does NOT strip
 *    single quotes — so `claude` receives a quoted, invalid model name ("issue
 *    with the selected model"). We de-quote the (shell-safe `[a-z0-9-]`) model in
 *    the print command on win32+noSandbox.
 */
export function buildBurnAgent(config: RuncastleConfig, token: string | undefined): AgentProvider {
  const noSandbox = config.sandbox !== 'docker'
  const opts: ClaudeCodeOptions = {
    ...(token ? { env: { CLAUDE_CODE_OAUTH_TOKEN: token } } : {}),
    ...(noSandbox ? { permissionMode: 'bypassPermissions' as const } : {}),
  }
  const agent = claudeCode(config.model, opts)

  if (noSandbox && process.platform === 'win32') {
    const quoted = `--model '${config.model}'`
    const unquoted = `--model ${config.model}`
    return {
      ...agent,
      buildPrintCommand: (o: AgentCommandOptions): PrintCommand => {
        const built = agent.buildPrintCommand(o)
        return { ...built, command: built.command.split(quoted).join(unquoted) }
      },
    }
  }
  return agent
}

/**
 * Run one ticket through sandcastle. Renders the prompt, builds the `run()`
 * options (branch strategy targeting `feature/<slug>`, throttled stream
 * forwarding, abort wiring), interprets commits/BLOCKED.md, and maps a merge
 * conflict to a `merge.conflict.needs-human` failure. Aborts are rethrown.
 */
async function realExecuteTicketRun(
  ctx: WorkflowCtx,
  ticket: Ticket,
  config: RuncastleConfig,
  token: string | undefined,
): Promise<TicketOutcome> {
  const { project, feature } = ctx

  const template = readFileSync(burnerTemplatePath(), 'utf8')
  const prompt = renderTicketPrompt(template, {
    TICKET_JSON: buildTicketJson(ticket),
    FEATURE_BRIEF: buildFeatureBrief(feature),
    DOCS_DIGEST: readDocsDigestFromDisk(project.id, feature.slug),
    COMMIT_CONVENTION: `ticket(${ticket.seq}): <summary>`,
  })

  mkdirSync(logsDir(), { recursive: true })
  const logFilePath = join(logsDir(), `burn-${feature.id}-${ticket.seq}.log`)
  const throttle = createStreamThrottle((e) => ctx.emitEvent({ ...e, ticketId: ticket.id }))

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
    name: `ticket-${ticket.seq}`,
    logging: { type: 'file', path: logFilePath, onAgentStreamEvent: throttle.onEvent },
  }

  let result: RunResult
  try {
    result = await run(runOptions)
  } catch (err) {
    throttle.flush()
    if (ctx.signal.aborted) throw err // let the runner mark the run cancelled
    const msg = err instanceof Error ? err.message : String(err)
    if (isMergeConflictError(err)) {
      return {
        status: 'failed',
        error: `merge conflict landing ticket ${ticket.seq} on ${feature.branch}: ${msg}`,
        event: {
          type: 'merge.conflict.needs-human',
          message: `ticket ${ticket.seq}: merge conflict on ${feature.branch} — resolve manually per the error, then re-burn`,
        },
      }
    }
    return { status: 'failed', error: msg }
  }
  throttle.flush()

  const blocked = readBlockedFile([result.preservedWorktreePath, project.repoPath])
  return interpretRunResult(result, blocked)
}

/** Resolve production deps: real config, token from `~/.runcastle/.env`, real run. */
function resolveBurnDeps(): BurnDeps {
  const config = loadConfig()
  const token = readTokenFromEnvFile(envPath())
  return {
    config,
    hasAuthToken: token !== undefined,
    executeTicketRun: (ctx, ticket) => realExecuteTicketRun(ctx, ticket, config, token),
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

export const ticketBurner: WorkflowDef = {
  id: 'ticket-burner',
  run: (ctx) => burnRun(ctx, resolveBurnDeps()),
}
