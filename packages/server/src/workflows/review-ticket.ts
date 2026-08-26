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
  burnerAssetPath,
  createStreamThrottle,
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
 * only when the review could not run at all — no `agent-browser` on the machine,
 * a drive it could not get, an agent that crashed — and that reason rides the
 * ticket's digest into the run digest, because "review could not run: X" is the
 * one thing the human arriving at the review screen needs to know.
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
 * Run one review ticket to a terminal outcome. The sandcastle boundary, so not
 * exercised by unit tests — the pure units around it (prompt rendering, the
 * artifacts the agent is handed, the PATH probe, the outcome shapes) are.
 */
export async function executeReviewTicket(
  ctx: WorkflowCtx,
  ticket: Ticket,
  deps: ReviewDeps,
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

  if (!findOnPath(AGENT_BROWSER_BIN)) {
    return couldNotReview(
      ticket,
      `\`${AGENT_BROWSER_BIN}\` is not on this machine's PATH, so there is no way to drive the app. Install it and re-burn this ticket.`,
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
    DIGEST_PATH: artifacts.digestPath,
    BLOCKED_PATH: artifacts.blockedPath,
    WALKTHROUGH_PATH: artifacts.walkthroughPath,
  })

  mkdirSync(logsDir(), { recursive: true })
  const throttle = createStreamThrottle((e) => ctx.emitEvent({ ...e, ticketId: ticket.id }))
  beginTranscript(ticket.id)
  const onStreamEvent = (event: AgentStreamEvent): void => {
    throttle.onEvent(event)
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
