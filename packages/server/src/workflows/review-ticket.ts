import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import type { ModelEntry, RuncastleConfig, Ticket, WorkflowCtx } from '@runcastle/core'
import { logsDir, reviewDir, reviewWalkthroughPath } from '@runcastle/core/paths'
import { run } from '@ai-hero/sandcastle'
import type { AgentStreamEvent, RunOptions } from '@ai-hero/sandcastle'
import { noSandbox } from '@ai-hero/sandcastle/sandboxes/no-sandbox'
import { renderRunMcpConfig } from '../launcher/artifacts'
import { appendTranscript, beginTranscript, endTranscript } from '../services/agent-stream'
import { releaseReviewDrive } from '../services/git'
import type { BurnAgentMcp, HarvestedDigest, TicketOutcome } from './ticket-burner'
import {
  buildBurnAgent,
  buildFeatureBrief,
  buildLapDigestsBlock,
  buildTicketJson,
  buildTicketTiming,
  burnerAssetPath,
  createStreamThrottle,
  createToolTimer,
  emitTicketTiming,
  errorHeadline,
  harvestDigest,
  readAgentFile,
  registerTicketAbort,
  releaseTicketAbort,
  renderTemplate,
} from './ticket-burner'

/**
 * The burn's second execution kind (improve-workflow spec, "Per-kind execution
 * in the burner"): a `review` ticket, run HOST-SIDE against the integrated
 * feature branch once every implementation ticket is terminal.
 *
 * Everything the implementation path does to keep concurrent agents apart is
 * absent here on purpose — no per-ticket branch, no container, no merge-queue
 * entry — because a review has nothing to land. It runs `claude --print` in the
 * project's real checkout, with the runcastle MCP wired in under the run's
 * identity, so the agent can boot the app through `review_drive`, walk it, and
 * write what it finds through `add_test_note`.
 *
 * Semantics, from decision 6: **findings are not failure.** The ticket is done
 * when the review ran to completion, however many bugs it wrote up. It fails
 * only when the review could not run at all — an unresolvable base, an agent
 * that crashed — and that reason rides the ticket's digest into the run digest,
 * because "review could not run: X" is the one thing the human arriving at the
 * review screen needs to know.
 *
 * A review runs in exactly ONE of two modes, never both: a browser **Drive** of
 * the app against the ticket's acceptance criteria, or **Gates** — the project's
 * verify commands plus a two-axis read of the branch's diff. Measured across a
 * burn's worth of reviews, the ones that did exactly one delivered in around
 * half an hour and the ones that attempted both ran long or died having
 * delivered neither. The prompt makes the choice in its first step; this path
 * supplies the half of it the agent cannot cheaply observe — whether a drive is
 * available at all ({@link buildDriveAvailability}) — and the gate commands the
 * other mode runs ({@link buildGateNotes}).
 *
 * So neither a missing `agent-browser` nor a drive that refused is a failure:
 * both just mean Gates mode. The template tells the agent to say `could not
 * drive: <reason>` in its digest, fall back to Gates, and forbids it from
 * building an environment of its own — a worktree, an install, a codegen — to
 * drive in instead: that improvisation was the most expensive single act
 * observed in any review, and it verified nothing, because an app the agent
 * assembled for itself is not the app the human runs.
 */

/** The prompt the review agent is spawned with. */
export function reviewTemplatePath(): string {
  return burnerAssetPath('review-ticket.md')
}

const PLACEHOLDERS = [
  'TICKET_JSON',
  'FEATURE_BRIEF',
  'DOCS_DIGEST',
  'LAP_DIGESTS',
  'FEATURE_BRANCH',
  /** The ref the branch forked from — the feature's own base, not a shell guess. */
  'BASE_BRANCH',
  /** Whether Drive mode is open at all, decided host-side (see {@link buildDriveAvailability}). */
  'DRIVE_AVAILABILITY',
  /** Gates mode's commands and their known-failure baseline. */
  'GATE_NOTES',
  'DIGEST_PATH',
  'BLOCKED_PATH',
  'WALKTHROUGH_PATH',
] as const

/** {@link renderTemplate} over the review template's fixed key set. */
export function renderReviewPrompt(
  template: string,
  values: Record<(typeof PLACEHOLDERS)[number], string>,
): string {
  return renderTemplate(template, values)
}

/** The CLI the review agent drives the app with. */
export const AGENT_BROWSER_BIN = 'agent-browser'

/**
 * Whether `agent-browser` is on this machine's PATH. Probed BEFORE the agent is
 * spawned: a review that discovers halfway through that it cannot open a browser
 * has already switched the human's checkout and burned an agent to say so, and
 * "the CLI is not installed" is a fact the burner can establish for free.
 *
 * It selects the mode rather than failing the ticket. A machine with no browser
 * can still run Gates mode, which needs nothing but the repository — refusing
 * the whole review there withheld the mode that was still perfectly available.
 *
 * PATH is walked directly rather than shelling out to `which`/`where`, which
 * differ per platform and cost a process either way.
 */
export function findOnPath(
  bin: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  const dirs = (env.PATH ?? env.Path ?? '').split(delimiter).filter(Boolean)
  // On Windows a bare name is only executable via one of PATHEXT's suffixes;
  // elsewhere the name IS the file.
  const suffixes =
    platform === 'win32'
      ? (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
      : ['']
  for (const dir of dirs) {
    for (const suffix of suffixes) {
      const candidate = join(dir, `${bin}${suffix}`)
      if (existsSync(candidate)) return candidate
    }
  }
  return undefined
}

/**
 * The `{{DRIVE_AVAILABILITY}}` block: whether Drive mode is open at all.
 *
 * The prompt's first step asks two questions — does this lap have a surface a
 * human could operate, and is a drive available. The first is a judgement only
 * the agent can make from the ticket and the diff; the second is a host fact it
 * would otherwise pay a `review_drive` start to discover, on the human's real
 * checkout. So it is answered here, and when the answer is no the block says so
 * flatly: the mode is already decided, and the agent should not call the tool.
 *
 * Pure — the caller does the PATH probe and passes the result.
 */
export function buildDriveAvailability(
  browserPath: string | undefined,
  devCommand: string | undefined,
): string {
  const missing: string[] = []
  if (!browserPath) {
    missing.push(
      `\`${AGENT_BROWSER_BIN}\` is not on this machine's PATH, so there is no browser to walk the app with`,
    )
  }
  if (!devCommand?.trim()) {
    missing.push('this project has no dev command configured, so a drive has no app to boot')
  }
  if (missing.length === 0) {
    return (
      `A drive **is** available: \`${AGENT_BROWSER_BIN}\` is on this machine's PATH and the ` +
      'project has a dev command, so `review_drive` can boot the app and you can walk it. Drive ' +
      'mode is open to you — take it if, and only if, this lap has a surface a human could operate.'
    )
  }
  return (
    `A drive is **not** available: ${missing.join(', and ')}. So the mode is already decided — ` +
    'run Gates mode, whatever this lap touched, and do not call `review_drive`. This is not a ' +
    'degraded review; it is the whole review this lap gets.'
  )
}

/**
 * The `{{GATE_NOTES}}` block: the gates Gates mode runs, and the failures they
 * already produce without this lap's help.
 *
 * The implementers were handed the same two config fields through
 * `buildVerifyNotes`, but in the opposite voice — theirs says which failures are
 * "yours to fix", and a reviewer fixes nothing. Same facts, read for a different
 * purpose: the reviewer runs the gates to find out what the lap broke, so what
 * it needs from the baseline is what to subtract.
 *
 * With nothing configured the answer is to run nothing. A reviewer guessing at a
 * monorepo's filter names — and discovering them by running the wrong suite — is
 * the long-review failure mode this whole mode split exists to end.
 */
export function buildGateNotes(
  config: Pick<RuncastleConfig, 'verifyCommands' | 'knownFailures'>,
): string {
  const commands = config.verifyCommands?.trim()
  const failures = config.knownFailures?.trim()
  const out: string[] = []

  if (commands) {
    out.push(
      "Run exactly these, once each — they are this project's own verify commands, so do not go looking for alternatives, add concurrency flags, or re-run one to re-read its output (redirect to a file and read that instead):",
      '',
      '```',
      commands,
      '```',
    )
  } else {
    out.push(
      'This project has no verify commands configured, so there are no gates to run. Do not go hunting for them — say so in one line of your summary note and spend the whole mode on the diff.',
    )
  }

  out.push('')

  if (failures) {
    out.push(
      "These already fail on this repo without this lap's help:",
      '',
      '```',
      failures,
      '```',
      '',
      "Subtract that baseline: a failure inside it is not this lap's and is not a finding. A failure outside it is one this lap introduced, and it is the finding worth the human's attention above every other.",
    )
  } else {
    out.push(
      "No pre-existing-failure baseline is configured, so a red gate may well predate this lap. Run it once, then check whether the failure touches the diff before writing it up as this lap's — and never re-run a suite to establish what was already red.",
    )
  }

  return out.join('\n')
}

/**
 * Everything the review agent reports back through, kept OUT of the repo: the
 * agent works in the human's real checkout, so a `DIGEST.md` written at its root
 * would be an untracked file in their tree — and the drive refuses to start on a
 * dirty tree.
 */
interface ReviewArtifacts {
  dir: string
  /** The run-scoped runcastle MCP server, in both the forms a runtime can take it. */
  mcp: BurnAgentMcp
  digestPath: string
  blockedPath: string
  /** Where a browser review points `agent-browser record start`. */
  walkthroughPath: string
}

function writeReviewArtifacts(
  ticket: Ticket,
  runId: string,
  config: RuncastleConfig,
): ReviewArtifacts {
  const dir = reviewDir(ticket.id)
  // A re-burn of the same ticket must not inherit the last attempt's DIGEST.md
  // or BLOCKED.md — that is how a failed review reports success.
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  const mcpConfigPath = join(dir, 'mcp.json')
  const mcpConfig = renderRunMcpConfig(runId, config)
  writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig, null, 2), 'utf8')
  return {
    dir,
    // The file is what Claude Code reads; the values are what Codex takes as
    // `-c` overrides. Same server, same `X-Runcastle-Run` header, either way.
    mcp: { path: mcpConfigPath, config: mcpConfig },
    digestPath: join(dir, 'DIGEST.md'),
    blockedPath: join(dir, 'BLOCKED.md'),
    walkthroughPath: reviewWalkthroughPath(ticket.id),
  }
}

/**
 * Give the drive slot back, whatever happened. The agent is told to stop what it
 * started, but an agent that crashed — or that ended its turn holding the slot —
 * would otherwise leave the human's checkout parked on the feature branch with a
 * dev server running and the machine-wide slot taken.
 *
 * Never fails the ticket: the review's outcome is what it is, and a teardown
 * that could not complete is the drive's problem to report, not this path's.
 */
async function releaseDriveQuietly(): Promise<void> {
  try {
    await releaseReviewDrive()
  } catch {
    /* best-effort — the ticket's outcome stands */
  }
}

export interface ReviewDeps {
  config: RuncastleConfig
  token: string | undefined
  model: ModelEntry
  /**
   * The run's docs digest, already built (and already charged to the timeline)
   * once for the whole burn. Re-reading it here would be the thirteenth
   * transmission of the same bytes in one run.
   */
  docsDigest: string
  /**
   * What every implementer in this burn said it did. The template used to tell
   * the reviewer it was "the only agent in the burn that can answer" what
   * landed; it never was, and the two things a diff cannot express — what
   * surprised each implementer, and what each left undone — live only here.
   */
  lapDigests: readonly HarvestedDigest[]
}

/**
 * Run one review ticket to a terminal outcome, and put its `ticket.timing` on
 * the event log however it ends — including the two refusals below, which end
 * the ticket before an agent ever starts. A review used to emit no timing at
 * all, which left every reader of a review's duration reconstructing it from
 * the append-only log file (see {@link buildTicketTiming}).
 */
export async function executeReviewTicket(
  ctx: WorkflowCtx,
  ticket: Ticket,
  deps: ReviewDeps,
): Promise<TicketOutcome> {
  const startedAt = Date.now()
  const timer = createToolTimer()
  try {
    return await reviewTicketOutcome(ctx, ticket, deps, timer)
  } finally {
    emitTicketTiming(ctx, ticket, buildTicketTiming(timer.summary(), startedAt, Date.now()))
  }
}

/**
 * The review itself. The sandcastle boundary, so not exercised by unit tests —
 * the pure units around it (prompt rendering, the artifacts the agent is handed,
 * the PATH probe, the outcome shapes) are.
 */
async function reviewTicketOutcome(
  ctx: WorkflowCtx,
  ticket: Ticket,
  deps: ReviewDeps,
  timer: ReturnType<typeof createToolTimer>,
): Promise<TicketOutcome> {
  const { project, feature } = ctx

  // The diff is taken against the branch this feature forked from, so without a
  // recorded base there is no diff to review — and no main line to substitute,
  // which is precisely the substitution that used to review the wrong commits.
  if (!feature.baseBranch) {
    return couldNotReview(
      ticket,
      `feature ${feature.slug} has no recorded base branch, so there is nothing to diff \`${feature.branch}\` against.`,
    )
  }

  const artifacts = writeReviewArtifacts(ticket, ctx.runId, deps.config)
  const prompt = renderReviewPrompt(readFileSync(reviewTemplatePath(), 'utf8'), {
    TICKET_JSON: buildTicketJson(ticket),
    FEATURE_BRIEF: buildFeatureBrief(feature),
    DOCS_DIGEST: deps.docsDigest,
    LAP_DIGESTS: buildLapDigestsBlock(deps.lapDigests),
    FEATURE_BRANCH: feature.branch,
    // The base the branch forked from, read off the feature rather than guessed
    // — a feature cut from `develop` used to be diffed against main, which reads
    // every commit develop is behind main as this feature's work. The agent runs
    // with `branchStrategy: {type:'head'}` in the human's own checkout, where
    // HEAD is still the base branch at step 1 — the merge that landed the lap
    // fast-forwards the feature REF without any checkout, and the runner detached
    // the talk worktree — so the template's old `<base>...HEAD` diff was empty on
    // a perfectly healthy lap, and its own failure criterion then made it report
    // "could not review".
    BASE_BRANCH: feature.baseBranch,
    DRIVE_AVAILABILITY: buildDriveAvailability(findOnPath(AGENT_BROWSER_BIN), project.devCommand),
    GATE_NOTES: buildGateNotes(deps.config),
    DIGEST_PATH: artifacts.digestPath,
    BLOCKED_PATH: artifacts.blockedPath,
    WALKTHROUGH_PATH: artifacts.walkthroughPath,
  })

  mkdirSync(logsDir(), { recursive: true })
  const throttle = createStreamThrottle((e) => ctx.emitEvent({ ...e, ticketId: ticket.id }))
  beginTranscript(ticket.id)
  const onStreamEvent = (event: AgentStreamEvent): void => {
    throttle.onEvent(event)
    timer.onEvent(event)
    if (event.type === 'text') {
      appendTranscript(ticket.id, { kind: 'text', text: event.message })
    } else if (event.type === 'toolCall') {
      appendTranscript(ticket.id, {
        kind: 'tool',
        text: event.formattedArgs ?? '',
        name: event.name,
      })
    }
  }

  const ticketAbort = registerTicketAbort(ticket.id)
  const signal = AbortSignal.any([ctx.signal, ticketAbort.signal])

  const options: RunOptions = {
    // Always the host build, whatever `config.sandbox` says about implementation
    // tickets: the app, its database and its browser only exist out here.
    agent: buildBurnAgent(deps.config, deps.token, deps.model, {
      onHost: true,
      mcp: artifacts.mcp,
    }),
    sandbox: noSandbox(),
    cwd: project.repoPath,
    prompt,
    // `head`: no worktree, no temp branch, no merge — sandcastle runs the agent
    // in the checkout as it stands, which is where the review drive puts the
    // integrated feature branch.
    branchStrategy: { type: 'head' },
    signal,
    name: `ticket-${ticket.seq}-review`,
    maxIterations: deps.config.burnMaxIterations,
    logging: {
      type: 'file',
      path: join(logsDir(), `review-${feature.id}-${ticket.seq}.log`),
      onAgentStreamEvent: onStreamEvent,
    },
  }

  let runError: unknown
  try {
    await run(options)
  } catch (err) {
    if (ctx.signal.aborted) throw err // run cancelled — the runner finalizes it
    runError = err
  } finally {
    releaseTicketAbort(ticket.id)
    throttle.flush()
    endTranscript(ticket.id)
    // Before the harvest below, so the review is never read off a machine the
    // drive still holds.
    await releaseDriveQuietly()
  }

  // The outcome is read off what the agent LEFT, not off how its process ended
  // — the same rule the implementation path applies to commits. An agent that
  // wrote its digest reviewed the feature, whatever `run()` did on the way out.
  const blocked = readAgentFile([artifacts.dir], 'BLOCKED.md')?.trim()
  const digest = harvestDigest([artifacts.dir])
  if (blocked) return couldNotReview(ticket, blocked, digest)
  if (runError !== undefined && digest === undefined) {
    return couldNotReview(
      ticket,
      ticketAbort.signal.aborted
        ? 'stopped by user'
        : `the review agent died: ${errorHeadline(runError instanceof Error ? runError.message : String(runError))}`,
    )
  }
  // Ran to completion: done, with no commits, because a review never writes
  // code. Its findings are already in the feature's test notes.
  return { status: 'done', commits: [], ...(digest ? { digest } : {}) }
}

/**
 * The failure shape, and the only one this path has: the review could not run.
 * The reason goes in the digest as well as the error so it survives into the run
 * digest, where the human reads what the burn produced.
 */
function couldNotReview(ticket: Ticket, reason: string, digest?: string): TicketOutcome {
  const headline = `Review could not run: ${reason}`
  return {
    status: 'failed',
    error: `ticket ${ticket.seq}: ${headline}`,
    digest: digest ? `${digest}\n\n**${headline}**` : `**${headline}**`,
  }
}
