import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { basename, dirname, join, posix as posixPath, win32 as winPath } from 'node:path'
import { fileURLToPath } from 'node:url'
import type {
  AgentRuntime,
  Feature,
  ModelConfig,
  ModelEntry,
  RuncastleConfig,
  Ticket,
  TicketStatus,
  WorkflowCtx,
  WorkflowDef,
} from '@runcastle/core'
import {
  WITHHELD_FEATURE_DOCS,
  agentDigestDocOrder,
  isAgentDigestDoc,
  newId,
  resolveModelEntry,
  resolvePreparedSettings,
  resolveSandboxImage,
} from '@runcastle/core'
import { loadConfig } from '@runcastle/core/config-load'
import {
  ATTACHMENTS_DIR,
  annotationPath,
  burnCacheDir,
  envPath,
  featureDocsRel,
  logsDir,
  worktreeDir,
} from '@runcastle/core/paths'
import type { McpConfig } from '../launcher/artifacts'
import { resolveSkillsRoot } from '../launcher/skills-root'
import { codexHomeDir, codexLoggedIn } from '../services/codex-auth'
import { ADR_DIR_REL, CHARTER_FILE, MAP_SECTIONS, listLiveAdrs } from '../services/knowledge'
import { RUNTIME_AUTH_KEY, RUNTIME_AUTH_SETUP_HINT } from '../services/setup'
import {
  appendTranscript,
  beginTranscript,
  endTranscript,
} from '../services/agent-stream'
import {
  allowPushToCheckedOutBranches,
  branchCommitsAhead,
  burnWorktreePath,
  cleanupBurnWorktree,
  commitSummaries,
  excludePath,
  mergeTempBranch,
  ticketBranchName,
  unexcludePath,
} from '../services/git'
import type { TempBranchMergeResult } from '../services/git'
import type {
  AgentCommandOptions,
  AgentProvider,
  AgentStreamEvent,
  ClaudeCodeOptions,
  CodexOptions,
  PrintCommand,
  RunOptions,
  RunResult,
} from '@ai-hero/sandcastle'
import { claudeCode, codex, run } from '@ai-hero/sandcastle'
import { buildGuardInstallCommand } from './burn-guard'
// The other execution kind. Imported for its one entry point only — everything
// it needs from here it takes from the exported pure units, and neither module
// touches the other while it is being evaluated.
import { executeReviewTicket } from './review-ticket'
import { docker } from '@ai-hero/sandcastle/sandboxes/docker'
import { podman } from '@ai-hero/sandcastle/sandboxes/podman'
import { noSandbox } from '@ai-hero/sandcastle/sandboxes/no-sandbox'

/**
 * Ticket burner — WAVE B3 (SPEC §8), the AFK engine over `@ai-hero/sandcastle`
 * 0.12.0. One `claude --print` agent run per ticket, honouring `blockedBy`
 * (global seq numbers per docs/research/CORRECTIONS.md C1), up to
 * `config.burnConcurrency` tickets in parallel (M2 — see ADR on burn
 * concurrency).
 *
 * Structure: the pure units (topo/cycle, seq→ticket resolution, template
 * rendering, .env parsing, workspace-mode resolution + isolated setup command,
 * run-result interpretation, the stream throttler, the
 * serial merge queue) are exported and unit-tested with no sandcastle
 * involvement. The sandcastle boundary is isolated behind an injectable
 * `executeTicketRun` (see `BurnDeps`) so the scheduler (ready-queue,
 * blocked-by-failed cascade, success/failure/conflict/zero-commit handling) is
 * testable against a fake.
 *
 * Branch-strategy note (M2): each ticket runs on its OWN temp branch
 * `runcastle/ticket/<slug>/<seq>-<unique>` (`baseBranch: feature/<slug>`).
 * Sandcastle's `branch` strategy keys its `.sandcastle/worktrees/<branch>`
 * worktree on the branch name, so distinct per-ticket names are what isolate
 * concurrent agents — burning `feature/<slug>` directly would share ONE
 * worktree across all tickets. Landings on the feature branch are serialized
 * through a per-run merge queue, and a ticket is only `done` once its branch
 * has landed — so a dependent ticket always forks a tip that includes its
 * blockers' commits.
 *
 * All of the above is the `implementation` ticket kind. A `review` ticket takes
 * none of it — no temp branch, no container, no merge queue — and is executed
 * host-side by `./review-ticket`, once every implementation ticket in the run is
 * terminal. `isReviewTicket` is the only fork.
 */

export const AUTH_MISSING_EVENT = 'auth.missing'

/**
 * Whether a runtime can authenticate an unattended container burn. The two
 * runtimes answer it differently: Claude Code needs the long-lived token from
 * `~/.runcastle/.env`, while Codex burns on the operator's own `codex login`,
 * borrowed into the container — so for Codex a token is merely the silent
 * `CODEX_API_KEY` override (decision 3), never the requirement.
 *
 * `loggedIn` is injected so the whole precheck is testable without a real home.
 */
export function burnAuthReady(
  runtime: AgentRuntime,
  token: string | undefined,
  loggedIn: () => boolean = codexLoggedIn,
): boolean {
  if (token !== undefined) return true
  return runtime === 'codex' && loggedIn()
}

// ---------------------------------------------------------------------------
// Outcome + dependency shapes (the sandcastle boundary)
// ---------------------------------------------------------------------------

/** What one ticket run resolves to. Aborts are thrown, never returned here. */
export type TicketOutcome =
  | {
      readonly status: 'done'
      readonly commits: string[]
      /**
       * The agent's own account of the work, harvested from the `DIGEST.md` it
       * writes just before signalling COMPLETE. Absent when it wrote none —
       * harvest is best-effort, so the ticket is done either way.
       */
      readonly digest?: string
    }
  | {
      readonly status: 'failed'
      readonly error: string
      /** Extra event emitted before the generic `ticket.failed` (e.g. conflict). */
      readonly event?: { type: string; message: string }
      /**
       * An account of the failure worth keeping in the run's record — the review
       * ticket's "could not review, because X". Optional because most failures
       * say everything they have to say in `error`; when present it is stored
       * and harvested exactly like a done ticket's digest.
       */
      readonly digest?: string
    }

/**
 * What the run knows at the moment a ticket starts, beyond the ticket itself.
 *
 * It exists for one reason: the burn already harvests every finished ticket's
 * own account of its work into an in-process array, and until now that array
 * went ONLY to the run row. Two agents in the same process at the same instant
 * needed it — an implementer that was handed its blockers as bare integers, and
 * a reviewer told it was "the only agent who can say what landed" — and both
 * were left to rediscover from `git log` what was sitting in memory beside them.
 */
export interface TicketRunContext {
  /** Digests harvested from tickets that have already settled in this run. */
  readonly digests: readonly HarvestedDigest[]
}

/**
 * The prompt blocks that are identical for every ticket in one burn — resolved
 * ONCE per run rather than per ticket, both because re-reading them 12 times is
 * waste and because the docs digest's timeline event should fire once, not once
 * per lane.
 */
export interface BurnPromptBlocks {
  readonly docsDigest: string
  readonly projectStandards: string
  readonly driveNotes: string
}

export interface BurnDeps {
  config: RuncastleConfig
  /** The runtime this run's resolved model launches — whose auth key must be set. */
  runtime: AgentRuntime
  /** Whether {@link runtime} can authenticate this run (container sandboxes require it). */
  hasAuthToken: boolean
  /**
   * The runtime of a ticket whose OWN model cannot authenticate a container
   * burn, or `undefined` when it can. A ticket assigned to the other runtime
   * re-resolves its model AND its credential, so the run-level check above says
   * nothing about it — this is what stops a Codex ticket inside a Claude run
   * from spending a container to discover it has no login.
   */
  ticketAuthMissing?: (ticket: Ticket) => AgentRuntime | undefined
  /** Worker-pool width — how many tickets burn in parallel (`config.burnConcurrency`). */
  concurrency: number
  /** Runs one ticket to a terminal outcome. Real impl calls sandcastle `run()`. */
  executeTicketRun: (
    ctx: WorkflowCtx,
    ticket: Ticket,
    run: TicketRunContext,
  ) => Promise<TicketOutcome>
}

/**
 * The one fork in the burn (improve-workflow spec, "Per-kind execution"): a
 * review ticket is executed host-side against the integrated feature branch —
 * no per-ticket branch, no container, no merge-queue entry — and everything
 * below that reads `kind` reads it through here.
 */
export function isReviewTicket(ticket: Ticket): boolean {
  return ticket.kind === 'review'
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

/**
 * The implement-ticket template's keys, in TEMPLATE ORDER — and that order is
 * load-bearing, not cosmetic (see the ordering note on `implement-ticket.md`).
 *
 * Everything above the line is RUN-CONSTANT: identical bytes for every ticket in
 * a burn, and identical across a ticket's own retry iterations. Everything below
 * it varies per ticket. Keeping the constant half first makes the rendered
 * prompts of concurrent tickets share a long common prefix — measured at ~92% of
 * the prompt, against 11.6% when the ticket JSON sat near the top — which is the
 * shape a prompt cache can actually reuse. A new placeholder that varies per
 * ticket MUST go below the line or the prefix collapses to whatever precedes it.
 */
const PLACEHOLDERS = [
  // --- run-constant ---
  'WORKSPACE_NOTES',
  'PROJECT_STANDARDS',
  'FEATURE_BRIEF',
  'DOCS_DIGEST',
  'VERIFY_NOTES',
  'DRIVE_NOTES',
  'GUARD_NOTES',
  // --- ticket-specific (must stay last) ---
  'TICKET_JSON',
  'BLOCKERS',
] as const
type PlaceholderKey = (typeof PLACEHOLDERS)[number]

/** The keys above whose value is the same for every ticket in one burn. */
export const RUN_CONSTANT_PLACEHOLDERS: readonly PlaceholderKey[] = [
  'WORKSPACE_NOTES',
  'PROJECT_STANDARDS',
  'FEATURE_BRIEF',
  'DOCS_DIGEST',
  'VERIFY_NOTES',
  'DRIVE_NOTES',
  'GUARD_NOTES',
]

/** The keys whose value differs between two tickets of the same burn. */
export const TICKET_SPECIFIC_PLACEHOLDERS: readonly PlaceholderKey[] = ['TICKET_JSON', 'BLOCKERS']

/**
 * Replace every `{{KEY}}` placeholder in a burner template with its value.
 * Uses split/join (not RegExp) so values may contain `$` and special chars
 * safely, and replaces all occurrences of each key. Keys absent from `values`
 * are left alone — a template is free to carry placeholders one caller fills
 * and another does not.
 */
export function renderTemplate(template: string, values: Record<string, string>): string {
  let out = template
  for (const [key, value] of Object.entries(values)) {
    out = out.split(`{{${key}}}`).join(value)
  }
  return out
}

/** {@link renderTemplate} over the implement-ticket template's fixed key set. */
export function renderTicketPrompt(
  template: string,
  values: Record<PlaceholderKey, string>,
): string {
  return renderTemplate(template, values)
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

/**
 * The `{{FEATURE_BRIEF}}` block — title / oneLiner / slug / integration branch.
 *
 * The branch line says **integration** branch and says not to check it out,
 * because that is what it is: every implementer works on its own temp branch
 * forked from it, and the prompt's first paragraph forbids checking it out. The
 * label used to read "Working branch", which told the agent to do the one thing
 * the same prompt banned twenty lines earlier.
 */
export function buildFeatureBrief(feature: Feature): string {
  return [
    `**${feature.title}** (\`${feature.slug}\`)`,
    '',
    feature.oneLiner,
    '',
    `Integration branch (do NOT check it out): \`${feature.branch}\` — your own temp branch is forked from it, and the run merges you back into it.`,
  ].join('\n')
}

/** A doc named to the agent but not inlined, with the reason it was not. */
export interface WithheldDoc {
  readonly name: string
  readonly reason: string
}

/**
 * The `{{DOCS_DIGEST}}` block: the canonical feature docs in full, followed by
 * an INDEX of everything else in the feature's docs dir.
 *
 * The index is the half that makes the allowlist safe (see `@runcastle/core`'s
 * `docs.ts`): the burner agent works in a real checkout and has `Read`, so a doc
 * it is told exists — by path, with the reason it was not inlined — is one call
 * away, while the alternative (inlining everything) shipped a 97 KB digest to
 * every coder in a 12-ticket run.
 */
export function buildDocsDigest(
  files: { name: string; content: string }[],
  withheld: readonly WithheldDoc[] = [],
  docsRel?: string,
): string {
  const parts: string[] = []
  if (files.length === 0) {
    parts.push('_No canonical feature docs found — work from the ticket context and the code._')
  } else {
    parts.push(files.map((f) => `### ${f.name}\n\n${f.content.trim()}`).join('\n\n---\n\n'))
  }
  if (withheld.length > 0) {
    const at = (name: string): string => (docsRel ? `${docsRel}/${name}` : name)
    parts.push(
      [
        '### Also on disk, not inlined',
        '',
        'These exist in this feature\'s docs directory and are NOT reproduced above. Read one only if your ticket points at it:',
        '',
        ...withheld.map((w) => `- \`${at(w.name)}\` — ${w.reason}`),
      ].join('\n'),
    )
  }
  return parts.join('\n\n---\n\n')
}

/**
 * `map.md` sections a coder must not act on, dropped from the digest.
 *
 * "Not yet specified" and "Out of scope" are the map's two negative-space
 * sections: between them they enumerate work that is deliberately NOT this
 * lap's, and on a mapped feature "Not yet specified" is the section that grows
 * without bound as waypoints pile up. The implementer is already told, twice,
 * never to expand scope beyond its ticket — so the only thing these sections can
 * change about its behaviour is to tempt it. Destination and Notes stay: those
 * are the intent a coder resolves ambiguity against.
 *
 * A pointer replaces what was cut, so the contract's naming half holds here too.
 */
export const DROPPED_MAP_SECTIONS: readonly string[] = ['Not yet specified', 'Out of scope']

/**
 * Strip {@link DROPPED_MAP_SECTIONS} out of a `map.md` body. Section headings are
 * matched at any heading level and case-insensitively, and a section runs to the
 * next heading of the same-or-shallower depth. Content with none of them is
 * returned unchanged (no pointer line is added for a cut that did not happen).
 */
export function trimMapDoc(content: string, docPath?: string): string {
  const lines = content.split(/\r?\n/)
  const out: string[] = []
  let dropping: number | null = null
  let dropped = false
  for (const line of lines) {
    const heading = /^(#{1,6})\s+(.*?)\s*$/.exec(line)
    if (heading) {
      const depth = heading[1]?.length ?? 1
      const title = (heading[2] ?? '').toLowerCase()
      if (dropping !== null && depth <= dropping) dropping = null
      if (DROPPED_MAP_SECTIONS.some((s) => s.toLowerCase() === title)) {
        dropping = depth
        dropped = true
        continue
      }
    }
    if (dropping === null) out.push(line)
  }
  const body = out.join('\n').replace(/\n{3,}$/, '\n').trimEnd()
  if (!dropped) return content
  const where = docPath ? ` — read \`${docPath}\` if you need them` : ''
  return `${body}\n\n_(The "${DROPPED_MAP_SECTIONS.join('" and "')}" sections are omitted here: they describe work outside this ticket${where}.)_`
}

/** Both halves of a docs digest read off disk, plus what it cost to ship. */
export interface DocsDigestResult {
  /** The rendered `{{DOCS_DIGEST}}` block. */
  readonly text: string
  /** `text.length` — the per-ticket byte cost, for the timeline event. */
  readonly bytes: number
  /** Canonical docs inlined, in digest order. */
  readonly included: readonly string[]
  /** Docs named but not inlined. */
  readonly withheld: readonly WithheldDoc[]
  /**
   * Set when the digest carries NO spec at all. A burn can legitimately run this
   * way (the runner detaches the talk worktree for exactly these runs), which is
   * precisely why it must be visible rather than one italic line inside a
   * container's prompt.
   */
  readonly missing?: 'no-worktree' | 'no-docs-dir' | 'no-canonical-docs'
}

/**
 * The `{{PROJECT_STANDARDS}}` block: the repo's own standards named BY PATH.
 *
 * By path, never by content. The reviewer is told to judge the diff against
 * `CLAUDE.md` ("the highest authority"), `CONTEXT.md` and the live ADRs — and
 * until this block existed the implementer was told none of it, so every burn
 * was graded against a rulebook only one of its agents had seen. Inlining them
 * would re-create exactly the bloat the docs allowlist just removed; the agent
 * has `Read` and a real checkout, so a path is enough.
 *
 * Only files that actually exist are listed: a path that resolves to nothing
 * teaches the agent to distrust the whole block.
 */
export const AGENT_CONVENTIONS_FILE = 'CLAUDE.md'

export function buildProjectStandards(repoPath: string): string {
  const present: string[] = []
  if (existsSync(join(repoPath, AGENT_CONVENTIONS_FILE))) {
    present.push(
      '`CLAUDE.md` — this repo\'s agent-facing conventions, and the highest authority on them',
    )
  }
  if (existsSync(join(repoPath, CHARTER_FILE))) {
    present.push(`\`${CHARTER_FILE}\` — the project charter: what this codebase is for`)
  }
  const adrs = listLiveAdrs(repoPath).map((a) => a.relPath)
  if (adrs.length > 0) {
    const list = adrs.map((p) => `\`${p}\``).join(', ')
    present.push(`${adrs.length} live ADR(s) under \`${ADR_DIR_REL}/\`: ${list}`)
  }

  if (present.length === 0) {
    return 'This repo documents no standards of its own (no `CLAUDE.md`, no `CONTEXT.md`, no live ADRs), so the conventions of the surrounding code are the whole standard. Read the files nearest your change and match them.'
  }
  return [
    'Your diff will be reviewed against these, so read the ones your change touches BEFORE you write code — they are in your checkout:',
    '',
    ...present.map((p) => `- ${p}`),
    '',
    'Read them, do not skim past them: a convention you break here is a review finding, and a fix ticket, later in this same run. Where they are silent, match the conventions of the surrounding code.',
  ].join('\n')
}

/** Everything the drive contract can be configured with (project columns). */
export interface DriveSettings {
  readonly repoPath: string
  readonly driveSetupCommand?: string | undefined
  readonly driveStopCommand?: string | undefined
  readonly devCommand?: string | undefined
  readonly dbResetCommand?: string | undefined
}

/**
 * The `{{DRIVE_NOTES}}` block: keep the project's test-drive machinery true.
 *
 * Conditional, and it did not used to be. The old prompt spent ~3.3 KB per
 * ticket teaching every agent about `.runcastle/drive-setup.sh`, `drive.env` and
 * the `RUNCASTLE_*` variables — on every project, including the ones with no
 * `.runcastle/` directory at all, and naming a `.sh` file this very repo does
 * not have (its own hook is `drive-setup.ts`). The contract the server actually
 * resolves is the prepared project columns, which may hold ANY command; the
 * `.runcastle/` convention is one common shape of it, not the shape.
 *
 * So: a project with a configured drive gets the instruction, quoting the
 * commands it really runs. A project without one gets two sentences telling the
 * agent to report the need instead of inventing the machinery.
 */
export function buildDriveNotes(settings: DriveSettings): string {
  const configured: string[] = []
  const add = (label: string, cmd?: string): void => {
    const v = cmd?.trim()
    if (v) configured.push(`- **${label}**: \`${v}\``)
  }
  add('setup', settings.driveSetupCommand)
  add('stop', settings.driveStopCommand)
  add('dev server', settings.devCommand)
  add('db reset', settings.dbResetCommand)
  const hasDir = existsSync(join(settings.repoPath, '.runcastle'))

  if (configured.length === 0 && !hasDir) {
    return [
      'This project has no test-drive machinery configured, so there is nothing here for you to keep in step — do not invent any.',
      '',
      'If your ticket makes the dev environment need something new (a service, a required env var, a seed, a background process), say so plainly in your digest. That is the whole obligation: a human wires it up once, for the project, not once per ticket.',
    ].join('\n')
  }

  const out: string[] = [
    "The project's test drive boots this branch through commands committed in this repo, so the drive of *this* branch runs *this* branch's copy of them.",
  ]
  if (configured.length > 0) {
    out.push('', 'What the server runs:', '', ...configured)
  }
  if (hasDir) {
    out.push(
      '',
      'The scripts those commands invoke live under `.runcastle/`. `drive-setup` writes computed values (a port, a database name, a URL) to `.runcastle/drive.env` as plain `KEY=VALUE` — that file is the only channel from the script to the app — and the server provides `RUNCASTLE_SLUG`, `RUNCASTLE_BRANCH` and `RUNCASTLE_ID` to every drive hook, so per-drive identity is derived from those and never from git inside the script.',
    )
  }
  out.push(
    '',
    '**Standing instruction: if your ticket introduces infrastructure the dev environment needs, update that machinery in this same branch.** The triggers are a **service** the app now needs, a **required env var** it reads at boot and fails without, a **seed** that must exist before the app is usable, or a **process** the dev environment must run alongside the app. Anything short of those needs no edit — the steps are idempotent by design, so a branch that merely adds a package or a migration is already covered. This is part of your ticket, not adjacent work: a branch whose drive cannot boot is not done.',
    '',
    '**Check it, never run it.** Your sandbox has no services and no app, so running `drive-setup`, `drive-stop`, or the app itself buys a confusing failure and burns your budget. What you *can* verify offline: that the script parses (`bash -n` for a shell script), that every path it names — compose file, seed file, env sample, sourced helper — exists in the repo, and that any env var your change made mandatory is actually written out. Say in your digest which of those you checked, and say plainly when one was not possible rather than implying it passed.',
  )
  return out.join('\n')
}

/**
 * The `{{GUARD_NOTES}}` block: whether the deny hook is actually armed.
 *
 * The prompt used to assert flatly that `git stash` and friends are "denied
 * before they run" — but the guard installs only under a container sandbox with
 * `burnGuard` on, so under `noSandbox` (or with the kill switch thrown) that
 * paragraph was simply false. An agent that reads a false claim about its
 * environment has no way to tell which of the prompt's other claims are also
 * false, so the rules are stated either way and only the ENFORCEMENT claim is
 * conditional.
 */
export function buildGuardNotes(guardInstalled: boolean): string {
  return guardInstalled
    ? 'Three of the rules below are enforced by a tool hook, not merely stated: `git stash`, test-runner concurrency flags, and rewriting files through interpreter heredocs are **denied before they run**. A denial is policy, not a broken environment — read its reason, take the alternative it names, and carry on. Do not try to route around it.'
    : 'Nothing below is machine-enforced in this burn — the deny hook is not installed, so the rules hold on your discipline alone. They are not style preferences: each one is a measured way burns lose work.'
}

/**
 * The `{{BLOCKERS}}` block: what this ticket's blockers actually built.
 *
 * The ticket JSON carries `blockedBy: [2]` — bare integers that appeared nowhere
 * else in the prompt, so the agent was never told what they referred to, nor the
 * one fact that matters operationally: the scheduler already landed those
 * tickets and their commits are in the base of the branch it is standing on. The
 * alternative it reached for instead was an unbounded `git log` archaeology dig
 * inside the container. Every blocker here already wrote an account of its own
 * work; this hands it over.
 */
export function buildBlockersBlock(
  blockedBy: readonly number[],
  digests: readonly HarvestedDigest[],
): string {
  if (blockedBy.length === 0) {
    return 'This ticket has no blockers — nothing in this run had to land before it.'
  }
  const bySeq = new Map(digests.map((d) => [d.seq, d]))
  const ordered = [...blockedBy].sort((a, b) => a - b)
  const head = `This ticket was blocked by ticket(s) ${ordered.join(', ')} of this same run. **They have already landed** — their commits are in the branch you are standing on, so read the code, do not re-implement it, and do not go digging through \`git log\` to find out what they were.`
  const bodies = ordered.map((seq) => {
    const d = bySeq.get(seq)
    if (!d) {
      return `### ticket ${seq}\n\n_Landed, but left no account of its work. Read the code it added if you need the detail._`
    }
    return `### ticket ${seq} — ${d.title}\n\n${d.digest.trim()}`
  })
  return [head, '', 'In their own words:', '', ...bodies].join('\n')
}

/**
 * The `{{LAP_DIGESTS}}` block for the review prompt: what every implementer in
 * this burn says it did.
 *
 * The review template claimed the reviewer was "the only agent in the burn that
 * can answer" what the lap delivered. It never was: a dozen implementers each
 * wrote an account first, and the two sections a reviewer cannot reconstruct
 * from a diff at any price — "Surprises" and "Left undone" — exist only in them.
 * The diff says what changed; these say what it cost and what was left.
 */
export function buildLapDigestsBlock(digests: readonly HarvestedDigest[]): string {
  if (digests.length === 0) {
    return '_No implementation ticket in this burn left a digest — the diff and the feature docs are all you have._'
  }
  return [...digests]
    .sort((a, b) => a.seq - b.seq)
    .map((d) => `### ticket ${d.seq} — ${d.title}\n\n${d.digest.trim()}`)
    .join('\n\n---\n\n')
}

// ---------------------------------------------------------------------------
// Pure units — the conflict-resolver prompt (resolve-conflict.md)
// ---------------------------------------------------------------------------

/** The `{{CONFLICT_FILES}}` block: the unmerged paths git reported, as a list. */
export function buildConflictFilesBlock(files: string[]): string {
  if (files.length === 0) {
    return '_git did not report the paths — run `git status` after starting the merge to see them._'
  }
  return files.map((f) => `- \`${f}\``).join('\n')
}

/**
 * The `{{OTHER_SIDE}}` block: one-line summaries of the commits that landed on
 * the feature branch while this ticket was being implemented. This is the
 * context a resolver spawned after the fact would otherwise lack entirely —
 * without it the agent sees conflict markers with no idea who wrote the other
 * half or why.
 */
export function buildOtherSideBlock(summaries: string[]): string {
  if (summaries.length === 0) {
    return '_No commit summaries available — inspect `git log` on the feature branch._'
  }
  return summaries.map((s) => `- ${s}`).join('\n')
}

/**
 * The `{{MERGE_COMMAND}}` the resolver must run to start the merge. Mounted mode
 * works in a git worktree of the host repo, so the feature branch is a local ref
 * it can name directly. Isolated mode (ADR-0005) works in a container-native
 * CLONE whose `origin` is the mounted worktree: the feature branch exists there
 * only as a remote ref, and cloning happened before this merge was needed, so
 * the fetch is explicit and the merge takes `FETCH_HEAD`.
 */
export function resolveMergeCommand(mode: BurnWorkspaceMode, featureBranch: string): string {
  return mode === 'mounted'
    ? `git merge --no-edit ${featureBranch}`
    : `git fetch origin ${featureBranch} && git merge --no-edit FETCH_HEAD`
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
// Pure unit — setup-command detection (deps install before the agent starts)
// ---------------------------------------------------------------------------

export const PACKAGE_MANAGERS = ['bun', 'pnpm', 'yarn', 'npm'] as const
export type PackageManager = (typeof PACKAGE_MANAGERS)[number]

/** What the target repo's root reveals about its JS toolchain. */
export interface RepoToolchain {
  hasPackageJson: boolean
  /** `packageManager` field from package.json (corepack pin), e.g. `"pnpm@9.6.0"`. */
  packageManagerField?: string
  /** Which lockfiles exist at the repo root. */
  lockfiles: { bun: boolean; pnpm: boolean; yarn: boolean; npm: boolean }
}

/**
 * Pick the repo's package manager: the `packageManager` field wins (it is the
 * corepack pin — authoritative even when stray lockfiles exist), then lockfile
 * presence (bun → pnpm → yarn → npm), then npm as the neutral default for a
 * repo with a package.json but no other marker. `undefined` for non-JS repos.
 */
export function detectPackageManager(tc: RepoToolchain): PackageManager | undefined {
  const pinned = tc.packageManagerField?.split('@')[0]
  if (pinned && (PACKAGE_MANAGERS as readonly string[]).includes(pinned)) {
    return pinned as PackageManager
  }
  if (tc.lockfiles.bun) return 'bun'
  if (tc.lockfiles.pnpm) return 'pnpm'
  if (tc.lockfiles.yarn) return 'yarn'
  if (tc.lockfiles.npm) return 'npm'
  return tc.hasPackageJson ? 'npm' : undefined
}

/** `strict`, then `permissive` if it fails — as one shell word (see below). */
function orFallback(strict: string, permissive: string): string {
  return `( ${strict} || ${permissive} )`
}

/**
 * The dependency-install command to run in the sandbox before the agent starts
 * (sandcastle `sandbox.onSandboxReady`), or `undefined` when there is nothing
 * to install. An explicit `override` (config `setupCommand`) always wins — even
 * with no package.json, so non-JS projects can bootstrap. Detection follows
 * {@link detectPackageManager}; a root install covers JS workspaces/monorepos,
 * so there is no per-package resolution to do. pnpm/yarn go through corepack
 * (present in the node:22 base image; neither manager is preinstalled), and
 * `--frozen-lockfile` (a working deprecated alias on yarn berry) / `npm ci` is
 * used only when the matching lockfile actually exists.
 *
 * **The strict form always falls back to the permissive one** — `( npm ci ||
 * npm install )`. Lockfile presence is read off the HOST working tree, but the
 * strict form asserts something about the lockfile that the sandbox may not be
 * able to honour, and a wrong assertion here kills the run in a pre-agent hook
 * before the agent gets a single turn. Two real repos, both measured:
 *
 * - **The lockfile is untracked.** `isolated` mode `git clone`s the workspace,
 *   and a clone carries tracked files only — so `existsSync` says
 *   `package-lock.json` is there and the container disagrees. `npm ci` dies
 *   with EUSAGE ("can only install with an existing package-lock.json").
 * - **The lockfile is tracked but stale.** It reaches the container intact and
 *   `npm ci` correctly refuses to reconcile it ("Missing: … from lock file").
 *
 * Neither is worth failing over. The strict form is a claim about the lockfile;
 * where the claim does not hold, the permissive install is simply the correct
 * command, and preparation then *establishes* that with evidence — which is the
 * entire point of the run it would otherwise have aborted. Reproducibility is
 * preserved wherever it was actually available: the strict form still runs
 * first and still wins whenever it can.
 *
 * Parenthesised because callers join parts with ` && ` and `&&`/`||` share
 * precedence left-to-right: a bare `cd repo && npm ci || npm install` would run
 * the fallback with the *whole preceding chain* as its left operand, installing
 * in the wrong directory after an unrelated earlier failure.
 *
 * An explicit override is never wrapped — a command the user typed runs
 * verbatim, including its own failure semantics.
 */
export function resolveSetupCommand(tc: RepoToolchain, override?: string): string | undefined {
  const trimmed = override?.trim()
  if (trimmed) return trimmed
  const pm = detectPackageManager(tc)
  if (!pm) return undefined
  switch (pm) {
    case 'bun':
      return tc.lockfiles.bun
        ? orFallback('bun install --frozen-lockfile', 'bun install')
        : 'bun install'
    case 'pnpm':
      return tc.lockfiles.pnpm
        ? orFallback('corepack pnpm install --frozen-lockfile', 'corepack pnpm install')
        : 'corepack pnpm install'
    case 'yarn':
      return tc.lockfiles.yarn
        ? orFallback('corepack yarn install --frozen-lockfile', 'corepack yarn install')
        : 'corepack yarn install'
    case 'npm':
      return tc.lockfiles.npm ? orFallback('npm ci', 'npm install') : 'npm install'
  }
}

/**
 * Where each package manager keeps its *download* cache inside the sandbox
 * (`~` expands to the container agent home). Bind-mounting a persistent host
 * dir here lets installs after the first skip the network.
 *
 * **pnpm is deliberately absent.** Its `~/.local/share/pnpm/store` is not a
 * download cache but a content-addressed store whose whole point is to
 * *hardlink* packages into `node_modules`. A bind mount is always a different
 * filesystem from the container's overlayfs — on every host OS, not just
 * Windows — so pnpm cannot hardlink out of a mounted store and silently falls
 * back to copying every file of every package. That is strictly worse than
 * letting the store live inside the container, where linking works: the mount
 * costs a full cross-boundary copy per install and buys only the download.
 * npm/yarn caches hold tarballs and are always extracted (never linked), and
 * bun's cache saves the fetch-and-extract regardless of link fallback, so
 * those three keep their mounts.
 */
export const PM_CACHE_SANDBOX_PATHS: Partial<Record<PackageManager, string>> = {
  bun: '~/.bun/install/cache',
  yarn: '~/.cache/yarn',
  npm: '~/.npm',
}

/** Structurally matches sandcastle's `MountConfig` (not exported from its barrel). */
export interface CacheMount {
  readonly hostPath: string
  readonly sandboxPath: string
  readonly readonly?: boolean
}

/**
 * The bind-mount for one package manager's persistent host cache, or
 * `undefined` for a manager that is better off with its cache inside the
 * container (pnpm — see {@link PM_CACHE_SANDBOX_PATHS}).
 */
export function cacheMountFor(pm: PackageManager, hostPath: string): CacheMount | undefined {
  const sandboxPath = PM_CACHE_SANDBOX_PATHS[pm]
  return sandboxPath ? { hostPath, sandboxPath } : undefined
}

// ---------------------------------------------------------------------------
// Pure unit — borrowing the host's Codex login (decision 1)
// ---------------------------------------------------------------------------

/** Where a burn container sees the host's Codex home — read-only, never written. */
export const CODEX_HOST_MOUNT_PATH = '/mnt/host-codex'

/**
 * The bind-mount that lends a container burn the operator's `codex login`, or
 * `undefined` when there is nothing to lend: a Claude burn, a `noSandbox` burn
 * (which runs as the operator and inherits the real home), or a host that has
 * never logged in. Read-only, so a container refreshing its token cannot
 * corrupt the host file (decision 1) — and a logged-out host is skipped rather
 * than mounted, because a missing `hostPath` fails sandbox creation outright
 * and an operator burning on a hand-set `CODEX_API_KEY` needs no login at all.
 */
export function codexAuthMountFor(
  runtime: AgentRuntime,
  sandbox: RuncastleConfig['sandbox'],
  env: Record<string, string | undefined> = process.env,
  loggedIn: (env: Record<string, string | undefined>) => boolean = codexLoggedIn,
): CacheMount | undefined {
  if (runtime !== 'codex' || sandbox === 'noSandbox' || !loggedIn(env)) return undefined
  return { hostPath: codexHomeDir(env), sandboxPath: CODEX_HOST_MOUNT_PATH, readonly: true }
}

/**
 * The sandbox-ready step that copies the borrowed login into the container's
 * own Codex home, where the CLI looks for it. ONLY `auth.json`: burns pass
 * their model with `-m` and the run-scoped MCP server with `-c`, and an
 * operator's `config.toml` (sandbox mode, approval policy, trusted projects)
 * must not leak into a print-mode burn. `$HOME` is expanded by the container's
 * own shell, so this is correct for whichever user the image runs as.
 */
export function buildCodexAuthCopyCommand(): string {
  return `mkdir -p "$HOME/.codex" && cp "${CODEX_HOST_MOUNT_PATH}/auth.json" "$HOME/.codex/auth.json"`
}

/**
 * Chain the sandbox-ready steps in the only order that works: borrow the Codex
 * login first (nothing else authenticates the agent), arm the burn guard next
 * (before the agent's first tool call), install dependencies last. Absent steps
 * drop out; `undefined` means there is nothing to run at all, which is what
 * sandcastle wants rather than an empty hook.
 */
export function chainSetupCommands(...steps: readonly (string | undefined)[]): string | undefined {
  const present = steps.filter((step): step is string => !!step)
  return present.length > 0 ? present.join(' && ') : undefined
}

// ---------------------------------------------------------------------------
// Pure unit — burn workspace mode (ADR-0005: keep the hot path off the mount)
// ---------------------------------------------------------------------------

/** Sandcastle's fixed bind-mount target for the worktree inside the container. */
export const SANDBOX_WORKSPACE_PATH = '/home/agent/workspace'
/** Container-native clone the agent works in under `isolated` mode. */
export const ISOLATED_REPO_PATH = '/home/agent/repo'

export type BurnWorkspaceMode = 'mounted' | 'isolated'

/**
 * Resolve the effective workspace mode for a burn (ADR-0005). `noSandbox` is
 * always `mounted` — there is no container, so there is nothing to isolate
 * from. `auto` keys on the HOST platform: Docker Desktop on win32/darwin serves
 * bind mounts through a filesystem translation layer that every small-file
 * operation pays (measured on Windows: 2000 small-file writes 4891ms on the
 * mount vs 82ms on the container's native FS), while a Linux host bind mount is
 * a native kernel path where isolation would only add clone overhead.
 */
export function resolveBurnWorkspaceMode(
  config: Pick<RuncastleConfig, 'sandbox' | 'burnWorkspace'>,
  platform: NodeJS.Platform = process.platform,
): BurnWorkspaceMode {
  if (config.sandbox === 'noSandbox') return 'mounted'
  if (config.burnWorkspace === 'auto') return platform === 'linux' ? 'mounted' : 'isolated'
  return config.burnWorkspace
}

/**
 * The `sandbox.onSandboxReady` command for `isolated` mode (runs in-container
 * via `sh -c`, cwd = the mounted workspace). Seven steps:
 *
 * 1. Whitelist every repo path for git (`safe.directory '*'`). Bind-mounted
 *    paths are owned by the host UID, and when the workspace is a worktree its
 *    gitdir resolves into the parent `.git` mount (`/.sandcastle-parent-git`)
 *    — which sandcastle ≤0.12.0 does not whitelist, so the clone's
 *    `upload-pack` dies with "dubious ownership". Container-local global
 *    config: no shared state, safe under any concurrency.
 * 2. Clone the workspace onto the container's native filesystem — one bulk
 *    transfer across the mount instead of a per-file tax on every later
 *    install/typecheck/test.
 * 3. Carry any attachments across (spec.md "Riding into the burn"). The
 *    host-side copy put them in the mounted workspace, but they are untracked
 *    and git-excluded by design, so a clone cannot bring them — and the ticket
 *    context names their path relative to wherever the agent works, which in
 *    this mode is the clone. Guarded on the directory existing, because most
 *    burns have no attachments at all; re-excluded inside the clone, because
 *    step 4 pushes the clone's commits back and `info/exclude` is not something
 *    a clone inherits.
 * 4. Install a `post-commit` hook in the clone that, on every commit, pushes
 *    `HEAD:<tempBranch>` back to the workspace and then hard-resets the
 *    workspace checkout to the freshly-pushed ref — syncing needs no agent
 *    discipline at all, and the mounted working tree tracks the branch, so
 *    sandcastle's end-of-run dirty check stays clean (no worktree pile-up).
 *    The push moves the REF only: the host wrote
 *    `receive.denyCurrentBranch=ignore` before any container started
 *    (`allowPushToCheckedOutBranches`), because `updateInstead`
 *    push-to-checkout resolves the branch's checkout via its registered HOST
 *    path (`C:\...`) — nonexistent in-container — and refuses every push.
 *    The hook unsets GIT_DIR/GIT_WORK_TREE/GIT_INDEX_FILE first: git exports
 *    them to hook processes, and they would otherwise pin the
 *    `git -C <workspace>` reset to the clone's repo instead of the workspace.
 * 5. For corepack-managed managers (pnpm/yarn), shim the bare binary onto
 *    `~/.local/bin` (on PATH in the node:22 image). Neither manager is
 *    preinstalled — only `corepack` is — and in real burns every agent
 *    independently burned iterations rediscovering `pnpm: command not found`
 *    and hand-writing this exact shim.
 * 6. Run the deps install inside the clone, where pnpm's hardlinks actually
 *    work (ADR-0004) and node_modules materializes on native FS.
 * 7. LAST, re-pin `core.hooksPath` to the clone's `.git/hooks`. A husky
 *    `prepare` script run by the install sets `core.hooksPath=.husky/_`, which
 *    makes git ignore `.git/hooks/` entirely — silently disarming the sync
 *    hook from step 4, so every commit stays trapped in the clone and the
 *    ticket fails with "agent made no commits" despite completed work. The
 *    re-pin must follow the install (last writer wins); it also disables the
 *    repo's own commit hooks (e.g. commitlint), which would otherwise reject
 *    the burner's mandated `ticket(N):` message format.
 *
 * The `receive.denyCurrentBranch` write must NOT happen here: a worktree
 * shares its parent repo's `.git/config`, so N sandboxes running it
 * concurrently race on the shared `config.lock`.
 */
export function buildIsolatedSetupCommand(
  tempBranch: string,
  setupCommand: string | undefined,
  pm?: PackageManager,
): string {
  const hookFile = `${ISOLATED_REPO_PATH}/.git/hooks/post-commit`
  const attachmentsDir = `${SANDBOX_WORKSPACE_PATH}/${ATTACHMENTS_DIR}`
  const cloneAttachmentsDir = `${ISOLATED_REPO_PATH}/${ATTACHMENTS_DIR}`
  const parts = [
    `git config --global --add safe.directory '*'`,
    `git clone ${SANDBOX_WORKSPACE_PATH} ${ISOLATED_REPO_PATH}`,
    `if [ -d "${attachmentsDir}" ]; then mkdir -p "${cloneAttachmentsDir}" && cp -r "${attachmentsDir}/." "${cloneAttachmentsDir}/" && mkdir -p "${ISOLATED_REPO_PATH}/.git/info" && printf '%s\\n' '${ATTACHMENTS_DIR}/' >> "${ISOLATED_REPO_PATH}/.git/info/exclude"; fi`,
    `printf '#!/bin/sh\\nunset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE\\ngit push --quiet origin HEAD:%s && exec git -C ${SANDBOX_WORKSPACE_PATH} reset --hard --quiet %s\\n' '${tempBranch}' '${tempBranch}' > ${hookFile}`,
    `chmod +x ${hookFile}`,
  ]
  if (pm === 'pnpm' || pm === 'yarn') {
    const shim = `$HOME/.local/bin/${pm}`
    parts.push(
      `mkdir -p "$HOME/.local/bin"`,
      `printf '#!/bin/sh\\nexec corepack ${pm} "$@"\\n' > "${shim}"`,
      `chmod +x "${shim}"`,
    )
  }
  if (setupCommand) parts.push(`cd ${ISOLATED_REPO_PATH} && ${setupCommand}`)
  parts.push(
    `git -C ${ISOLATED_REPO_PATH} config core.hooksPath ${ISOLATED_REPO_PATH}/.git/hooks`,
  )
  return parts.join(' && ')
}

/**
 * The `{{WORKSPACE_NOTES}}` block for the burner prompt: where the agent must
 * work. Isolated mode redirects it into the native-FS clone and covers the
 * places the redirect could otherwise leak (edits in the mounted mirror, a
 * BLOCKED.md the host would never see). DIGEST.md goes the other way — the
 * mirror in isolated mode, the checkout root in mounted mode — because it is
 * harvested from disk and must never ride a commit. Worst case if the agent
 * ignores this and works in the workspace anyway: today's mounted behavior —
 * slow, but correct.
 */
export function buildWorkspaceNotes(mode: BurnWorkspaceMode): string {
  if (mode === 'mounted') {
    return [
      'Work in the current directory — it is the repo checkout on your branch.',
      '',
      'Write `DIGEST.md` at the root of that checkout, and leave it uncommitted — the host harvests it from disk.',
      '',
      'If you are blocked and write `BLOCKED.md`, write it at the root of that checkout too. **These two paths are the only authoritative ones** — nothing later in this prompt overrides them.',
    ].join('\n')
  }
  return [
    `Your working repository is \`${ISOLATED_REPO_PATH}\` — a clone on the container's fast native filesystem, with dependencies already installed. Do ALL work there: \`cd ${ISOLATED_REPO_PATH}\` first; every file you read, edit, test, and commit lives under it.`,
    '',
    `The directory you start in (\`${SANDBOX_WORKSPACE_PATH}\`) is a slow mounted mirror used only to collect your commits — never edit files, install, or run tests there. Your commits sync back automatically (a post-commit hook pushes them); just commit as normal. If you re-run the dependency install and it reconfigures git hooks (husky), run \`git -C ${ISOLATED_REPO_PATH} config core.hooksPath ${ISOLATED_REPO_PATH}/.git/hooks\` afterwards so the sync hook stays armed.`,
    '',
    `If you are blocked and write \`BLOCKED.md\`, write it at \`${ISOLATED_REPO_PATH}/BLOCKED.md\` AND copy it to \`${SANDBOX_WORKSPACE_PATH}/BLOCKED.md\` so the orchestrator can see it.`,
    '',
    `Write \`DIGEST.md\` at \`${SANDBOX_WORKSPACE_PATH}/DIGEST.md\` — the mounted mirror, so the host can see it — and NOT inside \`${ISOLATED_REPO_PATH}\`, where it would be committed with your work.`,
    '',
    '**Those paths are the only authoritative ones** — nothing later in this prompt overrides them.',
  ].join('\n')
}

// ---------------------------------------------------------------------------
// Attachments — an annotated note's screenshot riding into its fix burn
// ---------------------------------------------------------------------------

/**
 * The note ids a ticket's context names attachments for. The ticket payload
 * carries no attachment field (its shape is pinned), so the
 * `.runcastle-attachments/<noteId>.png` sentence the promotion wrote into the
 * context is the whole handover — reading it back here is what closes the loop,
 * and `attachmentRelPath` is the single place the spelling lives.
 *
 * Scanned rather than regexed against a hardcoded directory so the two ends
 * cannot drift; a mention of a note that has no PNG is simply dropped later.
 */
export function attachedNoteIds(context: string): string[] {
  const marker = `${ATTACHMENTS_DIR}/`
  const ids: string[] = []
  for (let at = context.indexOf(marker); at !== -1; at = context.indexOf(marker, at + 1)) {
    const id = /^([\w-]+)\.png/.exec(context.slice(at + marker.length))?.[1]
    if (id && !ids.includes(id)) ids.push(id)
  }
  return ids
}

/**
 * Absolute host paths of the screenshots a ticket should burn with: every note
 * its context names, minus the ones whose PNG is no longer on disk. A note's
 * screenshot can be deleted between promotion and burn (the note itself, a
 * manual cleanup), and that is not a burn failure — the agent's Read fails and
 * it proceeds on the note text, exactly as an unannotated note would.
 */
export function attachmentSources(context: string): string[] {
  return attachedNoteIds(context).map(annotationPath).filter((p) => existsSync(p))
}

/**
 * Host `onWorktreeReady` commands that copy `sources` into the burn worktree's
 * `.runcastle-attachments/`. Sandcastle runs these through the platform shell
 * with cwd = the worktree, after `git worktree add` and before the sandbox
 * starts — the one window in which the workspace exists on the host and no
 * agent is looking at it yet. Doing it there rather than in a sandbox hook is
 * what makes it sandbox-agnostic: docker and noSandbox both bind the same
 * directory the copy just wrote into.
 *
 * One command per file (plus the mkdir) because `cmd.exe` does not chain an
 * `if not exist` with `&&` the way `sh` chains `mkdir -p`, and sandcastle runs
 * the list in order anyway.
 *
 * Destinations are built with `node:path`, in the namespace of the TARGET
 * platform rather than the host's: `platform` is a parameter here, so the
 * separator has to follow the shell the command is written for, not the machine
 * that wrote it. (In production the two are the same — the only caller takes the
 * default — but a `join` that answered `/` for a `cmd.exe` copy under test would
 * be describing a Windows this code never runs on.)
 */
export function buildAttachmentCopyCommands(
  sources: string[],
  platform: NodeJS.Platform = process.platform,
): { command: string }[] {
  if (sources.length === 0) return []
  const win = platform === 'win32'
  const path = win ? winPath : posixPath
  const dir = ATTACHMENTS_DIR
  const mkdir = win ? `if not exist "${dir}" mkdir "${dir}"` : `mkdir -p "${dir}"`
  return [
    { command: mkdir },
    ...sources.map((src) => {
      const dest = path.join(dir, path.basename(src))
      return {
        command: win ? `copy /Y "${src}" "${dest}" >nul` : `cp "${src}" "${dest}"`,
      }
    }),
  ]
}

/**
 * Undo the workspace preparation once the run is over — both halves of it.
 *
 * The images go first. Belt and braces: the directory is excluded from git
 * before it is ever written, so it cannot be committed and cannot ride the
 * merge — but a worktree sandcastle PRESERVES (the agent left uncommitted work)
 * would otherwise keep the images around for as long as the leftover does.
 *
 * Then the exclude itself, which is load-bearing only while the agent commits.
 * It is written against the repo's COMMON git dir, so leaving it behind would
 * hide any `.runcastle-attachments/` from the human's own `git status` in every
 * worktree, forever (decisions.md #10). Two burns overlapping can un-exclude
 * each other's live directory; the cost is the directory showing up in
 * `git status` until that burn cleans up too, which is not worth coordinating.
 */
export async function clearAttachments(workspacePath: string, repoPath: string): Promise<void> {
  rmSync(join(workspacePath, ATTACHMENTS_DIR), { recursive: true, force: true })
  await unexcludePath(repoPath, `${ATTACHMENTS_DIR}/`)
}

/**
 * The `{{VERIFY_NOTES}}` block for the burner prompt: how the agent should
 * spend its verification budget. Pure — reads only the two optional config
 * fields.
 *
 * Setting `verifyCommands` is also the ONLY good way to bound test concurrency.
 * The prompt forbids agents from improvising `--maxWorkers`/`--shard`, because
 * measured in-sandbox a serialised suite takes 10–20 minutes for work its
 * configured concurrency does in ~55s — but agents were reaching for those
 * flags to survive real OOM kills. An operator whose environment genuinely
 * needs a bound states it here, once, instead of every agent guessing at it
 * per ticket.
 *
 * Both halves exist because burn logs showed agents paying, per ticket, for
 * information the operator already had:
 *
 * - **Commands.** With nothing stated, agents guess workspace filter names and
 *   discover them by running whole monorepo suites that error out. One ticket
 *   burned two full runs on `--filter helix-frontend` and `--filter helix`
 *   before finding the right one. `config.verifyCommands` states them once.
 * - **Baseline.** Agents must separate their own breakage from the repo's
 *   existing breakage, and with no baseline the only way to get one is to run
 *   the full suite before touching anything — doubling the most expensive
 *   command in the burn, every ticket. `config.knownFailures` retires it.
 *
 * When a field is unset the block still says something useful: derive the
 * commands once and record them, capture the baseline once and reuse it. The
 * failure mode being prevented is re-deriving per slice, not deriving at all.
 */
export function buildVerifyNotes(
  config: Pick<RuncastleConfig, 'verifyCommands' | 'knownFailures'>,
): string {
  const commands = config.verifyCommands?.trim()
  const failures = config.knownFailures?.trim()
  const out: string[] = []

  if (commands) {
    out.push(
      'Verify with exactly these commands — they are correct for this repo, so do not go looking for alternatives or guess at workspace/package filter names:',
      '',
      '```',
      commands,
      '```',
    )
  } else {
    out.push(
      "No verification commands are configured, so derive them ONCE from the repo (root `package.json` scripts, the workspace's own manifest, CI config) before your first test run — reading a manifest is free, discovering a filter name by running the wrong suite is not. Write the working commands into your notes and reuse them verbatim for the rest of the ticket.",
    )
  }

  out.push('')

  if (failures) {
    out.push(
      'These tests ALREADY fail on this repo before you touch anything:',
      '',
      '```',
      failures,
      '```',
      '',
      'Treat that as your baseline — do NOT spend a run establishing it yourself. Only a failure outside this set is yours to fix; if you hit one that looks pre-existing but is not listed, confirm it on a single targeted run of that one test, never a whole-suite re-run.',
    )
  } else {
    out.push(
      'No pre-existing-failure baseline is configured. If the suite is already red, capture the baseline ONCE — the first full run you do, before your changes land, is the baseline — and compare every later run against those saved results. Never re-run a whole suite just to re-establish what was already failing.',
    )
  }

  return out.join('\n')
}

/** Inspect the target repo root for its JS toolchain markers (IO). */
export function readRepoToolchain(repoPath: string): RepoToolchain {
  const pkgPath = join(repoPath, 'package.json')
  const hasPackageJson = existsSync(pkgPath)
  let packageManagerField: string | undefined
  if (hasPackageJson) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { packageManager?: unknown }
      if (typeof pkg.packageManager === 'string') packageManagerField = pkg.packageManager
    } catch {
      // Unreadable package.json — fall back to lockfile detection alone.
    }
  }
  return {
    hasPackageJson,
    ...(packageManagerField !== undefined ? { packageManagerField } : {}),
    lockfiles: {
      bun: existsSync(join(repoPath, 'bun.lock')) || existsSync(join(repoPath, 'bun.lockb')),
      pnpm: existsSync(join(repoPath, 'pnpm-lock.yaml')),
      yarn: existsSync(join(repoPath, 'yarn.lock')),
      npm: existsSync(join(repoPath, 'package-lock.json')),
    },
  }
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
// Pure unit — burn timing telemetry (where a ticket's wall-clock actually goes)
// ---------------------------------------------------------------------------

/**
 * Where a burn's wall-clock goes. `model` is not a tool — it is the agent
 * thinking/writing between tool calls, and it belongs here because the whole
 * point of the breakdown is to see what share of a ticket ISN'T the model.
 */
export const TOOL_CATEGORIES = [
  'tests',
  'typecheck',
  'build',
  'lint',
  'install',
  'git',
  'file-read',
  'file-edit',
  'search',
  'model',
  'other',
] as const
export type ToolCategory = (typeof TOOL_CATEGORIES)[number]

/**
 * Not followed by a path/extension character — so a tool's name counts only when
 * it is being RUN, not when it names a file. Validating against real burn
 * commands caught this: `grep -n … vite.config.ts vitest.config.ts` was charged
 * to `tests`, because `\bvitest\b` matches happily inside `vitest.config.ts`.
 */
const RUN = String.raw`(?![\w./-])`

/** Ordered dominant-cost-wins patterns for classifying a Bash command line. */
const BASH_PATTERNS: ReadonlyArray<readonly [ToolCategory, RegExp]> = [
  // Tests first: a command that runs a suite is dominated by the suite, however
  // much greping is chained onto it (`pnpm test > log; grep -E ... log`).
  // The second alternative allows flags between the manager and the script
  // (`pnpm --filter web test`, the form this repo actually uses) but never
  // crosses a `&&`/`;`/`|` into the next command.
  ['tests', new RegExp(String.raw`\b(vitest|jest|pytest|go test|cargo test|bun test|playwright|maestro)${RUN}|\b(pnpm|npm|yarn|bun|npx)\b[^&;|]*?\s(run\s+)?test${RUN}|--testPathPatterns`)],
  ['typecheck', /\btsc\b|\btypecheck\b|\bmypy\b|\bcargo check\b/],
  ['build', new RegExp(String.raw`\bbuild${RUN}|\bprisma\s+(generate|migrate)\b|\bcodegen${RUN}`)],
  ['lint', new RegExp(String.raw`\b(eslint|prettier|ruff|biome|lint|format)${RUN}`)],
  ['install', /\b(pnpm|npm|yarn|bun|corepack)\s+\w*\s*install\b|\bnpm ci\b/],
  ['git', /\bgit\b/],
  // Reading/searching the repo THROUGH the shell — the thing the prompt now
  // tells agents to stop doing. Kept distinct from `search` so the two rules
  // (use Read, use Grep) can be measured separately.
  ['search', /\b(grep|rg|ag|find)\b/],
  ['file-read', /\b(cat|sed|head|tail|less|wc|ls)\b/],
  // Rewriting a file by piping a heredoc into an interpreter. Deliberately last:
  // these commands often mention other tools, but the edit is the cost.
  ['file-edit', /<<\s*['"]?(PY|EOF|SH|JS|TS)\b|\bpython3?\s+-\s*<</],
]

/** Non-Bash Claude Code tools, mapped to the same vocabulary. */
const TOOL_NAME_CATEGORY: Readonly<Record<string, ToolCategory>> = {
  Read: 'file-read',
  NotebookRead: 'file-read',
  Grep: 'search',
  Glob: 'search',
  Edit: 'file-edit',
  Write: 'file-edit',
  NotebookEdit: 'file-edit',
}

/**
 * Reduce a shell command to the part that says what it RUNS, by removing
 * heredoc bodies and quoted strings.
 *
 * Without this the classifier reads arguments as commands, and validating
 * against real burn commands showed exactly that: `grep -n "setupFiles|..."
 * vitest.config.ts` was charged to `tests` because a test runner's name
 * appeared inside a grep pattern, and a `python3 <<'PY'` heredoc that happened
 * to write a spec file was charged to whatever its body mentioned. The heredoc
 * marker itself is preserved (it is the signal that a file is being rewritten);
 * only the body between the marker and its terminator goes.
 */
export function normalizeCommandForClassification(command: string): string {
  return command
    .replace(/<<\s*['"]?(\w+)['"]?[\s\S]*?(^|\n)\s*\1\b/gm, '<<$1 ')
    .replace(/<<\s*['"]?(\w+)['"]?[\s\S]*$/, '<<$1 ') // unterminated (log truncation)
    .replace(/'[^']*'/g, ' ')
    .replace(/"[^"]*"/g, ' ')
}

/**
 * Classify one tool call. Pure. Bash is classified from its command line, since
 * `Bash` alone says nothing — and in real burns Bash was 100% of tool calls
 * (1641 of 1641), so a breakdown that stopped at the tool name would say
 * nothing at all.
 *
 * Patterns are ordered by DOMINANT cost, not by position in the command: burn
 * agents chain aggressively (`pnpm test > log 2>&1; grep -E ... log`), and the
 * suite is what that line costs, not the grep.
 */
export function classifyToolCall(name: string, args: string): ToolCategory {
  const byName = TOOL_NAME_CATEGORY[name]
  if (byName) return byName
  if (name !== 'Bash') return 'other'
  const normalized = normalizeCommandForClassification(args)
  for (const [category, pattern] of BASH_PATTERNS) {
    if (pattern.test(normalized)) return category
  }
  return 'other'
}

/** One category's slice of a burn. */
export interface CategoryTiming {
  calls: number
  ms: number
}
export interface ToolTimingSummary {
  totalMs: number
  calls: number
  /** Only categories that actually occurred, so the event payload stays small. */
  byCategory: Partial<Record<ToolCategory, CategoryTiming>>
}

/**
 * A single gap longer than this is not work — it is a sandbox rebuild, an idle
 * stall, or a clock jump between iterations. Dropped rather than attributed,
 * so one stall cannot swamp the breakdown it is supposed to explain.
 */
const MAX_ATTRIBUTABLE_GAP_MS = 20 * 60_000

/**
 * Accumulate where a burn's time goes, from the sandcastle stream alone.
 *
 * Method, and its honest limit: each event's timestamp closes the PREVIOUS
 * event's interval. A gap after a `toolCall` is charged to that tool's
 * category; a gap after `text` is charged to `model`. A tool gap therefore
 * includes the model's latency in producing the next event, so per-call figures
 * are upper bounds. That is fine for the job this does — comparing category
 * SHARES across burns, before and after a change — and it needs no coupling to
 * Claude Code's stream-json internals.
 *
 * Iteration boundaries reset the accumulator: a new iteration is a new
 * container, and the setup hook between them is not agent time.
 */
export function createToolTimer(): {
  onEvent(event: AgentStreamEvent): void
  summary(): ToolTimingSummary
} {
  const byCategory: Partial<Record<ToolCategory, CategoryTiming>> = {}
  let calls = 0
  let totalMs = 0
  let pending: { category: ToolCategory; at: number } | null = null
  let iteration: number | null = null

  const charge = (category: ToolCategory, ms: number): void => {
    const slot = (byCategory[category] ??= { calls: 0, ms: 0 })
    slot.ms += ms
    totalMs += ms
  }

  const onEvent = (event: AgentStreamEvent): void => {
    if (event.type === 'raw') return
    const at = event.timestamp.getTime()

    // A new container: whatever was open belongs to the dead iteration.
    if (iteration !== null && event.iteration !== iteration) pending = null
    iteration = event.iteration

    if (pending) {
      const gap = at - pending.at
      if (gap > 0 && gap <= MAX_ATTRIBUTABLE_GAP_MS) charge(pending.category, gap)
    }

    if (event.type === 'toolCall') {
      const category = classifyToolCall(event.name, event.formattedArgs ?? '')
      const slot = (byCategory[category] ??= { calls: 0, ms: 0 })
      slot.calls += 1
      calls += 1
      pending = { category, at }
    } else {
      pending = { category: 'model', at }
    }
  }

  return { onEvent, summary: () => ({ totalMs, calls, byCategory }) }
}

/** A one-line `category share%` digest for the timing event's message. */
export function formatTimingSummary(s: ToolTimingSummary): string {
  if (s.totalMs === 0) return `${s.calls} tool call(s), no measurable time`
  const parts = Object.entries(s.byCategory)
    .sort((a, b) => (b[1]?.ms ?? 0) - (a[1]?.ms ?? 0))
    .slice(0, 5)
    .map(([c, t]) => `${c} ${Math.round(((t?.ms ?? 0) / s.totalMs) * 100)}%`)
  return `${Math.round(s.totalMs / 60_000)}min across ${s.calls} tool call(s) — ${parts.join(', ')}`
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

/**
 * The marker that an error is ABOUT a sandcastle burn worktree: its path. Every
 * teardown failure quotes it (git's stderr names the dir it could not delete),
 * and nothing in the agent's own failure modes does.
 */
const BURN_WORKTREE_PATH = /[\\/]\.sandcastle[\\/]worktrees[\\/]/i

/** Phrases git/node produce when a directory removal is blocked, not when a run is. */
const WORKTREE_REMOVAL_FAILURES: RegExp[] = [
  /failed to delete/i,
  /directory not empty|enotempty/i,
  /unable to (unlink|delete)/i,
  /is not a working tree/i,
  /resource busy|ebusy|eperm|eacces/i,
]

/**
 * Did `run()` throw from sandcastle's END-OF-RUN worktree teardown rather than
 * from anything the agent did?
 *
 * Sandcastle removes the worktree in its scope's release step
 * (`cleanupWorktree` → `git worktree remove --force`) and wires that with
 * `Effect.orDie`, so a failure there becomes a defect and rejects `run()` —
 * even though the agent had already finished and its commits were collected.
 * On Windows this is a routine flake: the container is torn down first, but its
 * bind mount can still hold a handle for a moment, and git reports
 * `failed to delete '<path>': Directory not empty`.
 *
 * Recognizing it lets the burner land work that is already done instead of
 * failing the ticket on a cleanup error (and burning a whole agent re-run to
 * recover it). Callers MUST also require that the attempt's temp branch holds
 * commits: creation-time worktree errors quote the same path, and only commits
 * prove the agent actually got to work.
 */
export function isWorktreeTeardownError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : typeof err === 'string' ? err : String(err)
  if (!BURN_WORKTREE_PATH.test(msg)) return false
  return WORKTREE_REMOVAL_FAILURES.some((p) => p.test(msg))
}

/** Heuristic: did `run()` throw because a branch merge conflicted? */
export function isMergeConflictError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : typeof err === 'string' ? err : ''
  return (
    /conflict/i.test(msg) || /git branch -D/i.test(msg) || /automatic merge failed/i.test(msg)
  )
}

// ---------------------------------------------------------------------------
// Pure unit — transient-error classification + retry pacing
// ---------------------------------------------------------------------------

/**
 * Errors where a retry can only fail the same way — bad credentials, a model
 * the account cannot use, a broken resume. Checked BEFORE the retryable
 * patterns so "exited with code 1: Invalid API key" stays fatal.
 *
 * Runtime-neutral entries plus each provider's own wording. The runtime-specific
 * lists are tagged rather than merged so it stays visible which provider a
 * pattern was written for — an OpenAI `insufficient_quota` and an Anthropic
 * `credit balance` are the same fact spelled two ways, and neither CLI emits
 * the other's string.
 */
const FATAL_ERROR_PATTERNS: RegExp[] = [
  /invalid (api key|x-api-key)/i,
  /authentication|unauthorized|permission denied/i,
  /credit balance|billing/i,
  /oauth token|setup-token/i,
  /issue with the selected model|model not found|unknown model/i,
  /does not support resumeSession|resumeSession .* not found/i,
]

/**
 * Per-runtime fatal wording. OpenAI reports auth as a 401 with an
 * `invalid_api_key` code, an exhausted account as `insufficient_quota` (a
 * billing fact no retry fixes, despite arriving as a 429), and an unusable
 * model as `model_not_found`.
 *
 * A container burn runs on the operator's borrowed `codex login`, so the auth
 * wording it fails with is the CLI's own — "not logged in", a refused refresh
 * token — and none of it is worth a retry: the fix is `codex login` on the
 * host, which no attempt of ours can perform.
 */
const RUNTIME_FATAL_ERROR_PATTERNS: Record<AgentRuntime, RegExp[]> = {
  'claude-code': [],
  codex: [
    /invalid_api_key|invalid_request_error/i,
    /\b401\b|\b403\b/,
    /insufficient_quota|exceeded your current quota/i,
    /model_not_found|does not exist or you do not have access/i,
    /CODEX_API_KEY/,
    // "unauthorized" and "authentication …" are already fatal for every runtime
    // (see FATAL_ERROR_PATTERNS); these are the login wordings that are not.
    /not logged in/i,
    /\bauth (failed|required)\b/i,
    /refresh token/i,
  ],
}

/**
 * Transient infrastructure failures a fresh attempt has a real chance of
 * surviving. The broad `exited with code N` entry is sandcastle's `AgentError`
 * for ANY nonzero `claude --print` exit — in practice a dropped API stream,
 * an OOM-killed process, or a CLI crash, none of which say anything about the
 * ticket itself (a genuinely wrong ticket fails via zero commits or BLOCKED.md,
 * which are outcomes, not throws — they never reach this classifier).
 */
const RETRYABLE_ERROR_PATTERNS: RegExp[] = [
  /exited with code \d+/i,
  /idle timeout|AgentIdleTimeout/i,
  /connection (closed|error|refused|reset)|socket hang up|fetch failed/i,
  /econnreset|etimedout|econnrefused|epipe|eai_again/i,
  /overloaded|rate.?limit|too many requests/i,
  /internal server error|service unavailable|bad gateway|gateway timeout/i,
  /\bapi error\b/i,
  /session capture failed/i,
]

/**
 * Per-runtime transient wording. OpenAI's plain rate limit is a 429 with
 * `rate_limit_exceeded` — worth another attempt, unlike the `insufficient_quota`
 * that shares its status code and is classified fatal above.
 */
const RUNTIME_RETRYABLE_ERROR_PATTERNS: Record<AgentRuntime, RegExp[]> = {
  'claude-code': [],
  codex: [/rate_limit_exceeded/i, /\b429\b/, /server_error/i, /stream (disconnected|interrupted)/i],
}

/**
 * Should a failed sandcastle attempt be retried? Fatal patterns win over
 * retryable ones; anything unrecognized is fatal — an unknown throw (git
 * worktree setup, sandbox creation) could compound if blindly retried, and the
 * manual per-ticket retry tools cover it.
 *
 * `runtime` narrows the provider-specific patterns to the CLI that actually
 * produced the message. Omitting it considers every runtime's, which is what a
 * caller with no model in hand wants: the strings do not collide, so the union
 * classifies correctly either way.
 */
export function classifyTicketRunError(
  err: unknown,
  runtime?: AgentRuntime,
): 'retryable' | 'fatal' {
  const msg = err instanceof Error ? err.message : typeof err === 'string' ? err : String(err)
  const runtimes: AgentRuntime[] = runtime ? [runtime] : ['claude-code', 'codex']
  const forRuntimes = (table: Record<AgentRuntime, RegExp[]>): RegExp[] =>
    runtimes.flatMap((r) => table[r])

  if ([...FATAL_ERROR_PATTERNS, ...forRuntimes(RUNTIME_FATAL_ERROR_PATTERNS)].some((p) => p.test(msg)))
    return 'fatal'
  if (
    [...RETRYABLE_ERROR_PATTERNS, ...forRuntimes(RUNTIME_RETRYABLE_ERROR_PATTERNS)].some((p) =>
      p.test(msg),
    )
  )
    return 'retryable'
  return 'fatal'
}

/** Backoff before retry attempt `attempt + 1`: 5s, 10s, 20s, capped at 30s. */
export function retryDelayMs(attempt: number): number {
  return Math.min(30_000, 5_000 * 2 ** (attempt - 1))
}

/**
 * The prompt block appended when an attempt continues interrupted work — a
 * fresh agent has no memory of the dead one, so it must be told the history is
 * on its branch and that redoing (or reverting) it would burn the ticket.
 */
export function buildRetryNotes(input: { error?: string; commitCount: number }): string {
  const cause = input.error ? ` (${input.error})` : ''
  const commits =
    input.commitCount > 0
      ? `${input.commitCount} commit(s) from the previous attempt(s) are already on your branch — completed work, not noise.`
      : 'The previous attempt had not committed anything yet, so you are effectively starting clean.'
  return [
    '## Recovery context — a previous attempt was interrupted',
    '',
    `A previous agent working THIS SAME ticket was killed by a transient infrastructure error${cause} — not by anything it did wrong, and not by a human decision. You are picking up where it left off.`,
    '',
    commits,
    '',
    'Before doing anything else, run `git log --oneline -15` and `git status` to see what was already completed. Build on that work — do NOT revert or redo existing commits. Uncommitted changes from the previous attempt were lost; only commits survived. If the ticket turns out to be fully implemented already, verify the acceptance criteria and finish normally.',
  ].join('\n')
}

/** Resolves after `ms`, or EARLY (never rejects) when `signal` aborts — callers re-check their abort flags after. */
export function delayUnlessAborted(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve()
      return
    }
    const onAbort = (): void => {
      clearTimeout(t)
      resolve()
    }
    const t = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

// ---------------------------------------------------------------------------
// Per-ticket stop — abort ONE burning ticket's agent without killing the run
// ---------------------------------------------------------------------------

const activeTicketAborts = new Map<string, AbortController>()

/**
 * Stop a single burning ticket's agent (UI "Stop ticket"). The ticket lands as
 * `failed` with its committed work preserved on its temp branch (retryable),
 * while every other lane in the run keeps burning. Returns false when the
 * ticket has no live agent in this process.
 */
export function stopTicketRun(ticketId: string): boolean {
  const controller = activeTicketAborts.get(ticketId)
  if (!controller) return false
  controller.abort(new Error('ticket stopped by user'))
  return true
}

/**
 * Make a ticket's agent stoppable for as long as it is running — every
 * execution kind registers here, so "Stop ticket" reaches the review agent on
 * the host exactly as it reaches an implementer in its container.
 */
export function registerTicketAbort(ticketId: string): AbortController {
  const controller = new AbortController()
  activeTicketAborts.set(ticketId, controller)
  return controller
}

/** Drop a finished ticket's stop control (always paired, in a `finally`). */
export function releaseTicketAbort(ticketId: string): void {
  activeTicketAborts.delete(ticketId)
}

// ---------------------------------------------------------------------------
// Pure unit — serial queue (one merge lands at a time)
// ---------------------------------------------------------------------------

/**
 * A promise-chain serializer: tasks run strictly one at a time in submission
 * order. A rejection propagates to ITS submitter only — the chain itself never
 * breaks, so later tasks still run. The burner creates one per run and lands
 * every ticket's temp-branch merge through it, because concurrent merges into
 * the same feature branch would race on the ref/checkout.
 */
export function createSerialQueue(): <T>(task: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve()
  return <T>(task: () => Promise<T>): Promise<T> => {
    const next = tail.then(task)
    // Keep the chain alive past a rejection; the submitter still sees it via `next`.
    tail = next.catch(() => undefined)
    return next
  }
}

// ---------------------------------------------------------------------------
// Pure unit — the landing loop (merge → resolve conflict with an agent → merge)
// ---------------------------------------------------------------------------

/** Where a ticket's branch ended up after the landing loop gave up or won. */
export type LandOutcome =
  /** Merged into the feature branch. `branch` is what actually landed. */
  | { status: 'landed'; branch: string }
  /** Still conflicting after the resolver budget ran out (or with it disabled). */
  | { status: 'conflict'; branch: string; files: string[]; error: string }
  /** Landing failed for a non-conflict reason (lock contention, fs hiccup). */
  | { status: 'failed'; branch: string; error: string }

/** What one resolver pass produced: the best tip to keep, and whether it merged. */
export interface ResolveAttemptResult {
  ok: boolean
  /**
   * The branch to carry forward — the resolver's own branch when it committed
   * anything, else the branch it was given. Always the tip holding the most
   * work, so a failed resolve still never loses commits.
   */
  branch: string
  error?: string
}

export interface LandDeps {
  /** Merge `branch` into the feature branch (serialized through the run's queue). */
  merge(branch: string): Promise<TempBranchMergeResult>
  /** Run a resolver agent that merges the feature branch INTO `branch`. */
  resolve(input: {
    branch: string
    files: string[]
    attempt: number
    maxAttempts: number
  }): Promise<ResolveAttemptResult>
  /** Resolver passes allowed per landing (`config.burnConflictAttempts`; 0 = off). */
  maxResolveAttempts: number
  /** Event sink (the caller tags events with the ticket id). */
  emit(e: { type: string; message: string; data?: unknown }): void
  /** Human label for messages, e.g. `ticket 3`. */
  label: string
  /** The branch being landed on, for messages. */
  featureBranch: string
}

/**
 * Land a ticket's branch, resolving landing conflicts in-loop instead of handing
 * the human a git command.
 *
 * A conflict here is the NORMAL shape of burn concurrency — a sibling ticket
 * landed first and touched the same files — so it is treated as a step in the
 * landing, not as a ticket failure. On conflict we hand the branch to a resolver
 * agent which merges the feature branch IN and resolves there (see
 * `resolve-conflict.md`); the feature branch is never left mid-merge, and the
 * next `merge` is a fast-forward. The loop repeats only when the feature tip
 * moved again while the resolver worked, and is bounded by `maxResolveAttempts`
 * — after which the conflict is reported for a human, with the branch preserved.
 *
 * The resolver deliberately runs OUTSIDE the caller's serial merge queue: it
 * takes agent-minutes, and holding the queue would stall every other lane's
 * landing behind one conflicted ticket.
 */
export async function landWithResolve(branch: string, deps: LandDeps): Promise<LandOutcome> {
  let current = branch
  for (let attempt = 1; ; attempt++) {
    const merge = await deps.merge(current)
    if (merge.ok) return { status: 'landed', branch: current }

    const detail = merge.error ?? 'merge failed'
    if (!merge.conflict) return { status: 'failed', branch: current, error: detail }

    const files = merge.files ?? []
    if (attempt > deps.maxResolveAttempts) {
      return { status: 'conflict', branch: current, files, error: detail }
    }

    const where = files.length > 0 ? `${files.length} file(s)` : 'the merge'
    deps.emit({
      type: 'merge.conflict.resolving',
      message: `${deps.label}: conflicts with ${deps.featureBranch} on ${where} — resolving with an agent (pass ${attempt}/${deps.maxResolveAttempts})`,
      data: { branch: current, files, attempt, maxAttempts: deps.maxResolveAttempts },
    })

    const resolved = await deps.resolve({
      branch: current,
      files,
      attempt,
      maxAttempts: deps.maxResolveAttempts,
    })
    current = resolved.branch
    if (!resolved.ok) {
      return { status: 'conflict', branch: current, files, error: resolved.error ?? detail }
    }
    deps.emit({
      type: 'merge.conflict.resolved',
      message: `${deps.label}: conflict resolved on ${current} — landing`,
      data: { branch: current, files, attempt },
    })
  }
}

// ---------------------------------------------------------------------------
// Scheduler — worker pool over the ready queue (width = deps.concurrency)
// ---------------------------------------------------------------------------

type ReadyState = 'ready' | 'wait' | { blockedBy: number; present: boolean }

/** One ticket's harvested digest, tagged with what it is a digest OF. */
export interface HarvestedDigest {
  readonly seq: number
  readonly title: string
  readonly digest: string
}

/**
 * The most informative single line of a multi-line error. Git buries the cause
 * under progress noise — a failed `worktree add` starts with "Preparing
 * worktree (...)" and only says `fatal: ... Filename too long` lines later —
 * so prefer the LAST `fatal:`/`error:` line over the first line.
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
 * The line a review ticket's run-digest entry opens with when it reviewed a
 * feature some of whose implementation tickets failed (improve-workflow
 * decision 9) — the run digest's own record of what the review was up against,
 * independent of whether the agent's prose remembered to say so.
 */
function failedBlockerNote(seqs: readonly number[]): string {
  const list = [...seqs].sort((a, b) => a - b).join(', ')
  return `> Reviewed with failed implementation ticket(s): ${list}.`
}

/**
 * Drive tickets to terminal states honouring `blockedBy`. A ticket is ready when
 * all its blockers are `done`; a ticket with a `failed`/missing blocker is
 * marked failed (`blocked by failed ticket <seq>`) and cascades to its own
 * dependents. Runs up to `concurrency` at once (min 1). Aborts propagate
 * (thrown by `execute`) so the runner finalizes the run as cancelled — with
 * every other in-flight ticket drained first, so no rejection goes unhandled.
 * Returns the count of tickets in `done` state at the end, plus the digests
 * harvested along the way (the raw material for this run's aggregate).
 *
 * One ticket kind schedules differently: a `review` ticket also waits for every
 * implementation ticket in the run to settle, whatever its declared edges say.
 * It exercises the integrated branch, so starting it beside a still-burning
 * ticket would review a half-landed feature. In exchange it is exempt from the
 * cascade — a blocker that failed still lets it start, and its run-digest entry
 * says which ones did (see {@link failedBlockerNote}).
 */
export async function burnTickets(
  ctx: WorkflowCtx,
  tickets: Ticket[],
  execute: (ctx: WorkflowCtx, ticket: Ticket, run: TicketRunContext) => Promise<TicketOutcome>,
  concurrency = 1,
): Promise<{ done: number; digests: HarvestedDigest[] }> {
  const width = Math.max(1, Math.floor(concurrency))
  const bySeq = indexBySeq(tickets)
  const status = new Map<number, TicketStatus>(tickets.map((t) => [t.seq, t.status]))
  const pending = new Set<number>(tickets.filter((t) => t.status === 'pending').map((t) => t.seq))
  const inFlight = new Map<number, Promise<void>>()
  const digests: HarvestedDigest[] = []

  // A blocker is satisfied when `done` OR `cancelled` — a human cancelled it
  // because the work is unnecessary, so dependents proceed without it. For a
  // review ticket `failed` counts too (improve-workflow decision 9): its
  // blockers are every implementation ticket in the batch, so the generic
  // cascade would let one flaky ticket cancel the whole review — and reviewing
  // a partially-failed feature is the review's most valuable case, not its
  // least. Implementation tickets keep the cascade untouched.
  const satisfied = (t: Ticket, s: TicketStatus | undefined): boolean =>
    s === 'done' || s === 'cancelled' || (isReviewTicket(t) && s === 'failed')

  /**
   * The review precondition, held defensively rather than trusted to the
   * emitting session's `blockedBy`: no implementation ticket is still waiting or
   * still burning. Read off the scheduler's own sets, not off statuses, so a row
   * left `burning` by a dead earlier run — which this schedule will never move —
   * does not strand the review behind it forever.
   */
  const implementationsSettled = (): boolean =>
    tickets.every((t) => isReviewTicket(t) || (!pending.has(t.seq) && !inFlight.has(t.seq)))

  const readyState = (seq: number): ReadyState => {
    const t = bySeq.get(seq)
    if (!t) return 'wait'
    for (const b of t.blockedBy) {
      const present = bySeq.has(b)
      const bs = present ? status.get(b) : undefined
      // A blocker missing from the run is a malformed graph, not a failed
      // ticket — that cascades whatever the kind; a failed one cascades only
      // where it does not already satisfy this ticket.
      if (!present || (bs === 'failed' && !satisfied(t, bs))) return { blockedBy: b, present }
    }
    if (isReviewTicket(t) && !implementationsSettled()) return 'wait'
    return t.blockedBy.every((b) => satisfied(t, status.get(b))) ? 'ready' : 'wait'
  }

  /**
   * Keep a ticket's digest for the run aggregate. A review ticket that ran
   * anyway because its blockers were merely terminal says which of them failed —
   * the account of a partially-failed feature is worth nothing if the reader
   * cannot tell it was one. Read off the run's own tickets rather than the
   * declared edges, for the same reason `implementationsSettled` is: a session
   * that emitted the review ticket without edges still reviewed what failed.
   * Only the run digest is annotated; `ticket.digest` stays the agent's own
   * words, because which sibling tickets failed is a fact about the run.
   */
  const harvestDigest = (t: Ticket, digest: string | undefined): void => {
    const failed = isReviewTicket(t)
      ? tickets.filter((x) => !isReviewTicket(x) && status.get(x.seq) === 'failed').map((x) => x.seq)
      : []
    const body = [failed.length > 0 ? failedBlockerNote(failed) : undefined, digest]
      .filter(Boolean)
      .join('\n\n')
    if (body) digests.push({ seq: t.seq, title: t.title, digest: body })
  }

  const failTicket = (
    seq: number,
    error: string,
    extra?: { type: string; message: string },
    digest?: string,
  ) => {
    const t = bySeq.get(seq)
    status.set(seq, 'failed')
    if (!t) return
    ctx.updateTicket(t.id, { status: 'failed', error, ...(digest ? { digest } : {}) })
    harvestDigest(t, digest)
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

    // Snapshotted, not aliased: `digests` keeps growing as sibling lanes finish,
    // and a ticket's prompt must be built from what had landed when it started.
    const outcome = await execute(ctx, t, { digests: [...digests] }) // throws on abort — propagates
    if (outcome.status === 'done') {
      status.set(seq, 'done')
      ctx.updateTicket(t.id, { status: 'done', commits: outcome.commits, digest: outcome.digest })
      ctx.emitEvent({
        type: 'ticket.done',
        message: `ticket ${t.seq} done — ${outcome.commits.length} commit(s)`,
        ticketId: t.id,
        data: { commits: outcome.commits },
      })
      // Never blocks `done` (commits are the ground truth), but the gap belongs
      // in the timeline: the work record is thinner than it should be.
      if (outcome.digest === undefined) {
        ctx.emitEvent({
          type: 'digest.missing',
          message: `ticket ${t.seq} done without DIGEST.md`,
          ticketId: t.id,
        })
      }
      harvestDigest(t, outcome.digest)
    } else {
      failTicket(seq, outcome.error, outcome.event, outcome.digest)
      ctx.emitEvent({
        type: 'ticket.failed',
        message: `ticket ${t.seq} failed: ${errorHeadline(outcome.error)}`,
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
    while (inFlight.size < width) {
      const readySeq = [...pending].find((seq) => readyState(seq) === 'ready')
      if (readySeq === undefined) break
      pending.delete(readySeq)
      const p = runOne(readySeq).finally(() => {
        inFlight.delete(readySeq)
      })
      inFlight.set(readySeq, p)
    }

    if (inFlight.size > 0) {
      try {
        await Promise.race(inFlight.values())
      } catch (err) {
        // Abort (or an unexpected execute throw): the same AbortSignal is
        // killing every in-flight agent — drain them all so none rejects
        // unobserved, then rethrow so the runner finalizes the run.
        await Promise.allSettled([...inFlight.values()])
        throw err
      }
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
  return { done, digests }
}

// ---------------------------------------------------------------------------
// Workflow entry — auth precheck, cycle guard, schedule, summarise
// ---------------------------------------------------------------------------

/**
 * This run's aggregate: the digests it harvested, in seq order, each under a
 * header naming the ticket it came from. Strictly mechanical — the server makes
 * no model calls (decision 5) — and null when the run harvested nothing, so a
 * run without digests leaves the column alone rather than storing an empty doc.
 */
export function composeRunDigest(entries: readonly HarvestedDigest[]): string | null {
  if (entries.length === 0) return null
  return [...entries]
    .sort((a, b) => a.seq - b.seq)
    .map((e) => `## ticket ${e.seq} — ${e.title}\n\n${e.digest.trim()}`)
    .join('\n\n')
}

/**
 * The run-level precheck, per ticket: a ticket assigned to the other runtime
 * fails with the same `auth.missing` event rather than spending a container to
 * find out it cannot authenticate. Nothing wraps the executor when there is no
 * container to save or no per-ticket answer to give.
 */
function gateTicketAuth(deps: BurnDeps): BurnDeps['executeTicketRun'] {
  const authMissing = deps.ticketAuthMissing
  if (!authMissing || deps.config.sandbox === 'noSandbox') return deps.executeTicketRun
  return async (ctx, ticket, run) => {
    const runtime = authMissing(ticket)
    if (!runtime) return deps.executeTicketRun(ctx, ticket, run)
    const hint = `${runtime} is not authenticated — ${RUNTIME_AUTH_SETUP_HINT[runtime]}`
    ctx.emitEvent({ type: AUTH_MISSING_EVENT, message: hint, ticketId: ticket.id })
    return { status: 'failed', error: hint }
  }
}

/**
 * The testable core of the burner: everything except how `BurnDeps` are
 * resolved (config load, token read, real sandcastle call). Tests pass a fake
 * `executeTicketRun` + config to exercise success/failure/conflict/zero-commit,
 * the blocked-by-failed cascade, cycle detection and the auth precheck.
 */
export async function burnRun(
  ctx: WorkflowCtx,
  deps: BurnDeps,
): Promise<{ status: 'succeeded' | 'failed'; summary: string; digest?: string }> {
  const tickets = ctx.tickets
  // Cancelled tickets never burn and never count against success — but they DO
  // stay in the scheduler's ticket set so dependents can see their blocker is
  // satisfied (`burnTickets` receives the full list).
  const burnable = tickets.filter((t) => t.status !== 'cancelled')
  const cancelled = tickets.length - burnable.length
  const total = burnable.length

  // Auth precheck: container sandboxes (docker/podman) need credentials before
  // we start any container; noSandbox runs the CLI on the already-authed host.
  // The message names the fix for THIS run's runtime — a Codex burn that aborts
  // pointing at `claude setup-token` sends the human to the wrong provider.
  if (deps.config.sandbox !== 'noSandbox' && !deps.hasAuthToken) {
    ctx.emitEvent({ type: AUTH_MISSING_EVENT, message: RUNTIME_AUTH_SETUP_HINT[deps.runtime] })
    return { status: 'failed', summary: 'burn aborted: auth token missing' }
  }

  // Cycle guard: fail the whole run before touching any ticket. Cancelled
  // tickets are excluded — they never run, so their edges cannot deadlock the
  // schedule (edges pointing at them from burnable tickets resolve as satisfied).
  const cycle = detectCycle(burnable)
  if (cycle) {
    const path = cycle.join(' → ')
    ctx.emitEvent({
      type: 'burn.cycle',
      message: `dependency cycle detected: ${path}`,
      data: { cycle },
    })
    return { status: 'failed', summary: `dependency cycle: ${path}` }
  }

  const { done, digests } = await burnTickets(ctx, tickets, gateTicketAuth(deps), deps.concurrency)
  const summary =
    cancelled > 0 ? `${done}/${total} tickets done (${cancelled} cancelled)` : `${done}/${total} tickets done`
  ctx.emitEvent({ type: 'burn.summary', message: summary, data: { done, total, cancelled } })
  // The one-liner `summary` stays the run's headline (lists, timelines); the
  // aggregate rides beside it for the run view. A partially-failed run still
  // carries the digests of the tickets that did land.
  const digest = composeRunDigest(digests)
  return { status: done === total ? 'succeeded' : 'failed', summary, ...(digest ? { digest } : {}) }
}

// ---------------------------------------------------------------------------
// Real sandcastle boundary (IO) — not exercised by unit tests
// ---------------------------------------------------------------------------

/**
 * Absolute path to the burner prompt template. Resolves the skills root the
 * same way everywhere (workspace `packages/skills`, or the vendored root via
 * `RUNCASTLE_SKILLS_DIR` in a published install — issue #51).
 */
export function burnerTemplatePath(): string {
  return burnerAssetPath('implement-ticket.md')
}

/** Absolute path to the conflict-resolver prompt template (same skills root). */
export function resolverTemplatePath(): string {
  return burnerAssetPath('resolve-conflict.md')
}

/**
 * Absolute path to one burner asset, resolving the skills root the same way for
 * every prompt template the burn renders — the implementer's, the conflict
 * resolver's, and the review agent's.
 */
export function burnerAssetPath(file: string): string {
  const here = dirname(fileURLToPath(import.meta.url))
  return join(resolveSkillsRoot(here), 'burner', file)
}

/**
 * Every `.md` under a feature's docs dir, as paths relative to it — one level of
 * recursion, so `research/3-auth.md` is nameable in the index even though it is
 * never inlined.
 */
function listFeatureDocs(docsDir: string, prefix = ''): string[] {
  const out: string[] = []
  for (const e of readdirSync(docsDir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${e.name}` : e.name
    if (e.isFile() && e.name.endsWith('.md')) out.push(rel)
    else if (e.isDirectory() && !prefix) out.push(...listFeatureDocs(join(docsDir, e.name), rel))
  }
  return out
}

/**
 * Build the burn's docs digest off the talk worktree, honouring the shared
 * allowlist in `@runcastle/core`'s `docs.ts`.
 *
 * This used to glob every `.md` in the directory and inline all of it, with no
 * allowlist and no cap — an independent reimplementation of the same bug the MCP
 * `get_feature_context` tool had. On this repo's own runs that shipped 97 KB
 * (~25k tokens) to EVERY coder in a 12-ticket burn, of which `outcome.md` (52 KB)
 * and `test-notes.md` (27 KB) were the bulk: the previous lap's human-facing
 * postmortem and its already-triaged bug notes, re-sent up to nine times per
 * ticket across iterations and attempts.
 *
 * Now: the four canonical docs in canonical order, `map.md` trimmed of its
 * negative-space sections, and everything else NAMED with a reason and a path.
 */
export function readDocsDigest(projectId: string, slug: string): DocsDigestResult {
  const docsRel = featureDocsRel(slug)
  const done = (text: string, missing: DocsDigestResult['missing']): DocsDigestResult => ({
    text,
    bytes: text.length,
    included: [],
    withheld: [],
    ...(missing ? { missing } : {}),
  })

  const worktree = worktreeDir(projectId, slug)
  if (!existsSync(worktree)) {
    return done('_No talk worktree on disk — docs digest skipped._', 'no-worktree')
  }
  const docsDir = join(worktree, ...docsRel.split('/'))
  if (!existsSync(docsDir)) {
    return done('_No docs/features dir in the talk worktree — docs digest skipped._', 'no-docs-dir')
  }

  const names = listFeatureDocs(docsDir).sort(
    (a, b) => agentDigestDocOrder(a) - agentDigestDocOrder(b) || a.localeCompare(b),
  )
  const files: { name: string; content: string }[] = []
  const withheld: WithheldDoc[] = []
  for (const name of names) {
    if (!isAgentDigestDoc(name)) {
      withheld.push({
        name,
        reason:
          WITHHELD_FEATURE_DOCS[name.toLowerCase()] ??
          'not one of the canonical feature docs — read it only if a ticket points at it',
      })
      continue
    }
    let content: string
    try {
      content = readFileSync(join(docsDir, ...name.split('/')), 'utf8')
    } catch {
      continue // an unreadable doc is one fewer doc, never a failed burn
    }
    if (name.toLowerCase() === 'map.md') content = trimMapDoc(content, `${docsRel}/${name}`)
    files.push({ name, content })
  }

  const text = buildDocsDigest(files, withheld, docsRel)
  return {
    text,
    bytes: text.length,
    included: files.map((f) => f.name),
    withheld,
    ...(files.length === 0 ? { missing: 'no-canonical-docs' as const } : {}),
  }
}

/** {@link readDocsDigest}, rendered — the block a prompt placeholder takes. */
export function readDocsDigestFromDisk(projectId: string, slug: string): string {
  return readDocsDigest(projectId, slug).text
}

/**
 * Put the cost — and the absence — of the spec on the run's timeline.
 *
 * A spec-less burn used to be traceable only to one italic line inside a
 * container's prompt, which nothing outside that container ever read; and the
 * runner *detaches* the talk worktree for exactly the runs that hit it, so a
 * 12-ticket burn could proceed against no spec at all in complete silence. The
 * happy path emits too: the digest's byte count is paid once per ticket per
 * iteration, and it belongs where the rest of the run's cost is visible.
 */
export function emitDocsDigestEvent(ctx: WorkflowCtx, docs: DocsDigestResult): void {
  const data = {
    bytes: docs.bytes,
    included: [...docs.included],
    withheld: docs.withheld.map((w) => w.name),
    ...(docs.missing ? { missing: docs.missing } : {}),
  }
  if (docs.missing) {
    const why =
      docs.missing === 'no-worktree'
        ? 'there is no talk worktree on disk'
        : docs.missing === 'no-docs-dir'
          ? 'the talk worktree has no docs dir for this feature'
          : 'the docs dir holds none of brief/map/decisions/spec'
    ctx.emitEvent({
      type: 'burn.docs.missing',
      message: `burning with NO feature spec — ${why}; every ticket runs on its own text alone`,
      data,
    })
    return
  }
  ctx.emitEvent({
    type: 'burn.docs.digest',
    message: `docs digest: ${docs.bytes} bytes to every ticket (${docs.included.join(', ')}${docs.withheld.length > 0 ? `; ${docs.withheld.length} named, not inlined` : ''})`,
    data,
  })
}

/** First-found `file` across candidate dirs (worktree first, then repo). */
export function readAgentFile(dirs: (string | undefined)[], file: string): string | undefined {
  for (const dir of dirs) {
    if (!dir) continue
    const p = join(dir, file)
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
 * The agent's own account of the ticket, from the `DIGEST.md` it writes just
 * before signalling COMPLETE. Best-effort by contract: a missing file — or one
 * holding nothing but whitespace — reads as no digest, never as a failure.
 */
export function harvestDigest(dirs: (string | undefined)[]): string | undefined {
  const trimmed = readAgentFile(dirs, 'DIGEST.md')?.trim()
  return trimmed ? trimmed : undefined
}

/**
 * The environment the spawned agent gets, as sandcastle's agent-provider env.
 *
 * ON THE HOST it must be the host's own environment plus our overrides, never a
 * bare `{ CLAUDE_CODE_OAUTH_TOKEN }`: a replacement env drops HOME/USERPROFILE,
 * and a `claude` with no home writes its state to a LITERAL `~/` under its cwd —
 * which is how a 284 KB transcript for someone else's project ended up committed
 * at `packages/server/~/.claude/`.
 *
 * IN A CONTAINER the host env must not cross the boundary at all. Both container
 * providers turn this map into one `-e KEY=VALUE` per entry, so handing them
 * `process.env` would push a Windows PATH (and TEMP, and SystemRoot) into a Linux
 * image and break every tool in it. They set HOME themselves, so the `~` failure
 * this exists to prevent cannot happen there.
 *
 * The token is whatever `runtime` authenticates with — an OAuth token for Claude
 * Code, an OpenAI API key for Codex — and lands under that runtime's own key. A
 * container's env starts empty, so a Codex burn that is never handed
 * `CODEX_API_KEY` has no auth at all; this is the only place it gets one.
 */
function buildAgentEnv(
  onHost: boolean,
  token: string | undefined,
  runtime: AgentRuntime,
): Record<string, string> {
  const env: Record<string, string> = {}
  if (onHost) {
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined) env[key] = value
    }
  }
  if (token) env[RUNTIME_AUTH_KEY[runtime]] = token
  return env
}

/**
 * The runcastle MCP server, in both the forms a runtime can take it: Claude Code
 * reads the JSON file, Codex takes the same values as `-c` config overrides. One
 * source (`renderRunMcpConfig`), two injections — a Codex review agent must end
 * up on the same run-scoped connection, header and all, or its runcastle tools
 * resolve to nothing.
 */
export interface BurnAgentMcp {
  /** The rendered `mcp.json` already on disk, for `--mcp-config`. */
  readonly path: string
  /** The same server as values, for runtimes configured by flag rather than file. */
  readonly config: McpConfig
}

export interface BurnAgentOptions {
  /**
   * Force the host build regardless of `config.sandbox`. The review ticket runs
   * on the host whatever the burn is configured to do with implementation
   * tickets (it has to — the app and its database only exist there), so it needs
   * the host env and the host permission mode from a docker-configured burn too.
   */
  onHost?: boolean
  /**
   * Give the agent the runcastle MCP server. sandcastle 0.12.0 has no MCP field
   * on either agent's options, so it rides the print command — the same seam the
   * Windows model de-quote already uses.
   */
  mcp?: BurnAgentMcp
  /**
   * We installed the burn guard into this sandbox's Codex home. Codex ignores a
   * `hooks.json` it has no persisted trust for — even one in `$CODEX_HOME` —
   * so without `--dangerously-bypass-hook-trust` the guard we just wrote is
   * silently inert (verified against codex-rs `engine/discovery.rs`, whose own
   * exec integration test needs the flag for exactly this file). Set only where
   * we authored the hooks: never on the host, where it would also un-gate the
   * human's own.
   */
  bypassHookTrust?: boolean
}

/**
 * THE burn chokepoint: every headless agent runcastle runs — ticket burns,
 * conflict resolution, review tickets, research — is constructed here, so this
 * is the one place a runtime is chosen. The model's `runtime` decides it
 * (decision 2: runtime is a property of the model, never a separate knob), and
 * everything downstream — sandbox, prompt, completion, merge queue — is
 * runtime-neutral and untouched.
 *
 * Both providers need the same two host/Windows workarounds for
 * `@ai-hero/sandcastle` 0.12.0's `noSandbox` provider (the container providers
 * docker/podman are unaffected — they run inside a Linux container with a POSIX
 * shell):
 *
 * 1. **Permissions.** For `noSandbox`, sandcastle forces
 *    `dangerouslySkipPermissions=false` (never auto-skip on the host) and passes
 *    NO `--permission-mode`, so the `claude --print` agent runs in the default
 *    mode and cannot apply edits — every ticket makes zero commits. We pass
 *    `permissionMode: 'bypassPermissions'` for noSandbox (the same effect docker
 *    gets from `--dangerously-skip-permissions` inside its container) so the AFK
 *    agent can actually write files; the noSandbox user has opted into host
 *    execution. Docker keeps sandcastle's default. Codex needs no equivalent:
 *    its provider passes `--dangerously-bypass-approvals-and-sandbox` on every
 *    print command, host or container, and `CodexOptions` has no permission knob.
 * 2. **Model quoting on Windows.** sandcastle POSIX-single-quotes the model
 *    value (`shellEscape`) for BOTH providers — `--model 'x'` for claude,
 *    `-m 'x'` for codex — but its noSandbox exec runs through `cmd.exe /d /s /c`
 *    with verbatim args on Windows, and cmd.exe does NOT strip single quotes, so
 *    the CLI receives a quoted, invalid model name ("issue with the selected
 *    model"). We de-quote the (shell-safe) model in the print command on
 *    win32+noSandbox — per runtime, because the flag spelling differs.
 */
export function buildBurnAgent(
  config: RuncastleConfig,
  token: string | undefined,
  model: ModelEntry,
  options: BurnAgentOptions = {},
): AgentProvider {
  const onHost = options.onHost ?? config.sandbox === 'noSandbox'
  const env = buildAgentEnv(onHost, token, model.runtime)
  const agent =
    model.runtime === 'codex'
      ? codex(model.id, { env } satisfies CodexOptions)
      : claudeCode(model.id, {
          env,
          ...(onHost ? { permissionMode: 'bypassPermissions' as const } : {}),
        } satisfies ClaudeCodeOptions)

  const extraArgs = buildAgentExtraArgs(model.runtime, options)
  const dequoteModel = onHost && process.platform === 'win32'
  if (!dequoteModel && extraArgs.length === 0) return agent

  const quotedModelFlag = model.runtime === 'codex' ? `-m '${model.id}'` : `--model '${model.id}'`
  const bareModelFlag = model.runtime === 'codex' ? `-m ${model.id}` : `--model ${model.id}`

  return {
    ...agent,
    buildPrintCommand: (o: AgentCommandOptions): PrintCommand => {
      const built = agent.buildPrintCommand(o)
      let command = built.command
      if (dequoteModel) command = command.split(quotedModelFlag).join(bareModelFlag)
      for (const arg of extraArgs) command += ` ${arg}`
      return { ...built, command }
    },
  }
}

/**
 * The arguments neither provider builds for us, in that runtime's own spelling.
 * Claude Code takes a `--mcp-config` FILE; Codex has no such flag and instead
 * takes `-c` dotted config overrides, so the same server is spelled out as
 * values. Codex parses each `-c` value as TOML and falls back to the raw string,
 * and the double quotes are deliberately left unquoted at the shell level: a
 * POSIX shell strips them (raw-string fallback, right value) and cmd.exe keeps
 * them (TOML string, right value), so one rendering is correct on both — which
 * matters because the review path runs on the host, Windows included.
 */
function buildAgentExtraArgs(runtime: AgentRuntime, options: BurnAgentOptions): string[] {
  const args: string[] = []
  if (runtime === 'codex') {
    // Ordered so a burn's command is stable across runs (tests read it).
    if (options.bypassHookTrust) args.push('--dangerously-bypass-hook-trust')
    for (const [name, server] of Object.entries(options.mcp?.config.mcpServers ?? {})) {
      args.push(`-c mcp_servers.${name}.url="${server.url}"`)
      for (const [header, value] of Object.entries(server.headers)) {
        args.push(`-c mcp_servers.${name}.http_headers.${header}="${value}"`)
      }
    }
    return args
  }
  if (options.mcp) args.push(`--mcp-config ${quoteArg(options.mcp.path)}`)
  return args
}

/**
 * Quote one path for the shell the print command runs in — double quotes,
 * because the only place a burn path contains a space is a Windows home
 * directory and `cmd.exe` understands nothing else.
 */
function quoteArg(value: string): string {
  return `"${value}"`
}

/**
 * Pick the sandcastle sandbox provider for the configured `sandbox`. The two
 * container providers (docker/podman) take an explicit `imageName` — always
 * `resolveSandboxImage(config)`, never sandcastle's `sandcastle:<repo-dir-name>`
 * fallback, so the tag matches what build-image/doctor built (SPEC §8; the
 * "Image not found locally" mismatch). podman keeps sandcastle's rootless
 * defaults (SELinux `:z` relabel + `keep-id` userns) — runcastle passes no
 * volume-label/userns flags of its own. `mounts` (package-manager cache dirs)
 * apply to the container providers only — noSandbox runs on the host, where the
 * real cache is already in place.
 *
 * `config.burnCpus`, when set, becomes `--cpus` on both container providers: at
 * width N every container otherwise sees the host's full core count and sizes
 * its install/test worker pools from it, oversubscribing the box N-fold. There
 * is no memory equivalent — sandcastle's provider options do not expose
 * `--memory` (see the `burnCpus` config doc for why that is the right call
 * anyway). noSandbox ignores it: no container, nothing to constrain.
 */
export function selectSandbox(config: RuncastleConfig, mounts: readonly CacheMount[] = []) {
  const imageOpts = buildSandboxOptions(config, mounts)
  switch (config.sandbox) {
    case 'docker':
      return docker(imageOpts)
    case 'podman':
      return podman(imageOpts)
    case 'noSandbox':
      return noSandbox()
    default:
      // Only reachable when a sandbox choice gains a config value before it
      // gains a provider here. Refusing loudly is the point: the old `default:
      // noSandbox()` turned "I asked for a container" into "the agent ran on
      // your machine", with nothing said either way.
      throw new Error(
        `no sandbox provider for sandbox "${config.sandbox}" — refusing to run the agent unsandboxed`,
      )
  }
}

/**
 * The option object handed to the docker/podman providers — split out as a pure
 * unit because the providers close over their options and expose nothing, so
 * this is the only place the wiring is observable to a test. Optional keys are
 * omitted rather than set to `undefined` so a provider's own defaults apply.
 */
export function buildSandboxOptions(
  config: Pick<RuncastleConfig, 'sandboxImage' | 'burnCpus'>,
  mounts: readonly CacheMount[] = [],
): { imageName: string; mounts?: readonly CacheMount[]; cpus?: number } {
  return {
    imageName: resolveSandboxImage(config),
    ...(mounts.length > 0 ? { mounts } : {}),
    ...(config.burnCpus !== undefined ? { cpus: config.burnCpus } : {}),
  }
}

/**
 * Generous ceiling for the pre-agent dependency install
 * (`sandbox.onSandboxReady`): sandcastle's default hook timeout is 60s, which a
 * cold monorepo install blows through easily. 15 minutes; cache mounts make the
 * warm path far faster.
 */
const SETUP_HOOK_TIMEOUT_MS = 15 * 60_000

/**
 * Run one ticket through sandcastle (M2). Renders the prompt, builds the
 * `run()` options (branch strategy targeting a per-ticket temp branch based on
 * `feature/<slug>`, throttled stream forwarding, abort wiring), interprets
 * commits/BLOCKED.md, then lands the temp branch on the feature branch through
 * `land` — the per-run serial merge queue, so concurrent tickets never merge at
 * once. Aborts of the RUN are rethrown; a per-ticket stop (`stopTicketRun`)
 * fails only this ticket.
 *
 * Landing conflicts (parallel tickets touched the same files) are resolved
 * in-loop by a second agent rather than failing the ticket — see
 * {@link landWithResolve}. Only when its budget runs out does the ticket fail,
 * and it then carries `attemptBranch` + `conflictFiles`, which is exactly the
 * state that makes the NEXT burn of this ticket (Retry, or a whole-feature
 * re-burn) skip implementation and go straight back to resolving.
 *
 * Robustness (attempt chaining): a transient infrastructure death (API stream
 * drop, network, overload, idle timeout — see `classifyTicketRunError`) does
 * not fail the ticket. Whatever the dead attempt committed survives on its
 * temp branch in EVERY workspace mode (the post-commit sync hook in isolated
 * mode; the host worktree ref in mounted/noSandbox), so the next attempt runs
 * on a fresh temp branch BASED ON the dead one, with `buildRetryNotes`
 * appended so the new agent continues instead of starting over. Up to
 * `config.burnAttempts` attempts per run; a ticket that still fails persists
 * its chain tip in `ticket.attemptBranch`, which the NEXT run (re-burn or
 * manual retry) resumes from the same way. A successful landing clears it.
 */
async function realExecuteTicketRun(
  ctx: WorkflowCtx,
  ticket: Ticket,
  config: RuncastleConfig,
  token: string | undefined,
  model: ModelEntry,
  land: <T>(task: () => Promise<T>) => Promise<T>,
  ensureIsolatedPushTarget: () => Promise<void>,
  blocks: BurnPromptBlocks,
  runCtx: TicketRunContext,
): Promise<TicketOutcome> {
  const { project, feature } = ctx

  // Where the agent's hot path lives (ADR-0005): on win32/darwin container
  // hosts the bind-mounted worktree pays Docker Desktop's per-file translation
  // tax, so `auto` isolates the working tree onto the container's native FS.
  const workspaceMode = resolveBurnWorkspaceMode(config)

  // Isolated mode pushes commits back into the mounted worktree, which the
  // parent repo's config must permit. Host-side and shared across tickets —
  // in-sandbox this write raced N containers on the shared `config.lock`.
  if (workspaceMode === 'isolated') await ensureIsolatedPushTarget()

  // Screenshots the promoted note carried in (spec.md "Riding into the burn").
  const attachments = attachmentSources(ticket.context)
  const attachmentCommands = buildAttachmentCopyCommands(attachments)
  // The exclude goes in BEFORE the first copy and covers every worktree of this
  // repo at once (git resolves `info/exclude` against the common git dir), so
  // the images are unstageable from the moment they exist — no commit of the
  // agent's can pick them up, and sandcastle's end-of-run dirty check still
  // sees a clean tree. Bracketed by `clearAttachmentsFor`, so the line lives
  // exactly as long as the run it protects: it reaches the human's own checkout
  // too, which is why it may not outlive the burn.
  const excludeAttachments = async () => {
    if (attachments.length > 0) await excludePath(project.repoPath, `${ATTACHMENTS_DIR}/`)
  }
  const clearAttachmentsFor = async (branch: string) => {
    if (attachments.length > 0) {
      await clearAttachments(burnWorktreePath(project.repoPath, branch), project.repoPath)
    }
  }

  // Shared by both prompts: a resolver spawned after the fact gets the SAME
  // ticket + feature + docs context the implementer had (the whole point — it
  // must resolve by intent, which only the ticket and the feature docs carry).
  const ticketJson = buildTicketJson(ticket)
  const featureBrief = buildFeatureBrief(feature)
  const docsDigest = blocks.docsDigest
  const workspaceNotes = buildWorkspaceNotes(workspaceMode)
  // Whether the deny hook will actually be installed below — the prompt states
  // the rules either way, but only claims enforcement when it is true.
  const guardInstalled = config.burnGuard && config.sandbox !== 'noSandbox'
  // The prepared repo facts (verify commands, test baseline, install command),
  // resolved project-first. They describe THIS repo, so a project's own value —
  // normally established by a preparation run — always wins over the machine
  // -wide config value, which survives only as the inherited fallback.
  const prepared = resolvePreparedSettings(config, project)

  // Also shared: the resolver runs the same suites on the merge result, and
  // guessed filter names / re-derived baselines cost it exactly what they cost
  // the implementer.
  const verifyNotes = buildVerifyNotes(prepared)

  // Order matters only in the TEMPLATE, not here — but every value below is
  // either run-constant or explicitly ticket-specific, and `PLACEHOLDERS`
  // records which is which.
  const basePrompt = renderTicketPrompt(readFileSync(burnerTemplatePath(), 'utf8'), {
    WORKSPACE_NOTES: workspaceNotes,
    PROJECT_STANDARDS: blocks.projectStandards,
    FEATURE_BRIEF: featureBrief,
    DOCS_DIGEST: docsDigest,
    VERIFY_NOTES: verifyNotes,
    DRIVE_NOTES: blocks.driveNotes,
    GUARD_NOTES: buildGuardNotes(guardInstalled),
    TICKET_JSON: ticketJson,
    BLOCKERS: buildBlockersBlock(ticket.blockedBy, runCtx.digests),
  })

  // Dependency setup: detect the repo's install command (or take the config
  // override) and run it as a sandbox-side onSandboxReady hook, so the agent
  // never spends its iterations bootstrapping node_modules — the exact failure
  // mode that burned whole runs before (agent backgrounds an install, ends its
  // turn "waiting for a notification" that print mode can never deliver). For
  // managers with a download cache, a persistent host dir is mounted so later
  // installs skip the network; pnpm opts out (`cacheMountFor` → undefined)
  // because a mounted store cannot hardlink — see PM_CACHE_SANDBOX_PATHS.
  const toolchain = readRepoToolchain(project.repoPath)
  const pm = detectPackageManager(toolchain)
  const setupCommand = resolveSetupCommand(toolchain, prepared.setupCommand)
  const mounts: CacheMount[] = []
  if (config.sandbox !== 'noSandbox' && pm) {
    const mount = cacheMountFor(pm, burnCacheDir(pm))
    if (mount) {
      mkdirSync(mount.hostPath, { recursive: true }) // a missing hostPath fails sandbox creation
      mounts.push(mount)
    }
  }
  // A container Codex burn runs on the operator's ChatGPT login: the host Codex
  // home rides in as a read-only mount, and the sandbox-ready hook copies
  // `auth.json` out of it before anything else runs.
  const codexAuthMount = codexAuthMountFor(model.runtime, config.sandbox)
  if (codexAuthMount) mounts.push(codexAuthMount)
  // The burn guard (PreToolUse deny hook) is installed by the same
  // onSandboxReady hook that installs deps, so it is armed before the agent's
  // first tool call. Container sandboxes only: under `noSandbox` the agent runs
  // as the human on the host, where writing `~/.claude/settings.json` (or
  // `~/.codex/hooks.json`) would clobber their own. In mounted mode with nothing
  // to install this makes the hook run where it previously did not — intended.
  // Installed for the runtime that is about to run, into that runtime's home.
  const guardInstall = guardInstalled ? buildGuardInstallCommand(model.runtime) : undefined
  const withPrelude = (setup: string | undefined): string | undefined =>
    chainSetupCommands(
      codexAuthMount ? buildCodexAuthCopyCommand() : undefined,
      guardInstall,
      setup,
    )
  // Codex runs no hooks it has no persisted trust for; the flag is what makes
  // the file we just wrote bind. Paired with the install so it is never passed
  // when there is no guard of ours to un-gate.
  const agentOptions: BurnAgentOptions = guardInstalled ? { bypassHookTrust: true } : {}

  mkdirSync(logsDir(), { recursive: true })
  const logFilePath = join(logsDir(), `burn-${feature.id}-${ticket.seq}.log`)
  const throttle = createStreamThrottle((e) => ctx.emitEvent({ ...e, ticketId: ticket.id }))

  // Two consumers of the agent stream: the throttle (coarse timeline events for
  // the DB) and the in-memory transcript (UNTHROTTLED — the live Claude Code
  // style view in the UI polls it). begin() resets any previous attempt's
  // transcript so a re-burn starts clean.
  beginTranscript(ticket.id)
  // Third consumer: the timing accumulator. Burn logs carry no per-line
  // timestamps, so before this the only way to learn where a ticket's hours
  // went was to reconstruct it forensically from captured sessions. The
  // sandcastle stream already carries a timestamp on every event; this just
  // stops throwing it away.
  const timer = createToolTimer()
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

  // Per-ticket stop control: `signal` kills THIS ticket's agent on either the
  // run's abort (cancel run) or a targeted `stopTicketRun` (Stop ticket).
  const ticketAbort = registerTicketAbort(ticket.id)
  const signal = AbortSignal.any([ctx.signal, ticketAbort.signal])

  const maxAttempts = Math.max(1, config.burnAttempts)

  // Two different resumes, distinguished by `conflictFiles`:
  //
  // - CONFLICT resume — the ticket was implemented and its branch is complete;
  //   it only failed to LAND. Re-running the implementer would be worse than
  //   useless (it would find the ticket already done, commit nothing, and hit
  //   the same conflict), so this path skips implementation entirely and goes
  //   straight back into the landing loop, which re-detects the conflict
  //   against the CURRENT tip and hands it to a resolver.
  // - ATTEMPT resume (below) — the implementer itself was interrupted, so the
  //   next attempt continues the unfinished work.
  const conflictResume = ticket.conflictFiles !== undefined && !!ticket.attemptBranch

  // Cross-run resume: an earlier run (or a stopped/exhausted attempt chain)
  // left committed work on `ticket.attemptBranch` — base the first attempt on
  // it and tell the agent to continue. A stale pointer (branch deleted, or
  // everything already landed) is silently ignored.
  let baseBranch = feature.branch
  let retryNotes: string | undefined
  if (ticket.attemptBranch && !conflictResume) {
    const preserved = await branchCommitsAhead(project.repoPath, feature.branch, ticket.attemptBranch)
    if (preserved.length > 0) {
      baseBranch = ticket.attemptBranch
      retryNotes = buildRetryNotes({
        ...(ticket.error ? { error: errorHeadline(ticket.error) } : {}),
        commitCount: preserved.length,
      })
      ctx.emitEvent({
        type: 'ticket.resuming',
        message: `ticket ${ticket.seq}: resuming from ${preserved.length} preserved commit(s) of a previous attempt`,
        ticketId: ticket.id,
        data: { attemptBranch: ticket.attemptBranch, preservedCommits: preserved.length },
      })
    }
  }

  /** Persist the chain tip so the NEXT burn of this ticket continues from it. */
  const preserveChain = (branch: string): void => {
    ctx.updateTicket(ticket.id, { attemptBranch: branch })
  }

  /**
   * One conflict-resolver pass: an agent on a fresh branch off `branch` that
   * merges the feature branch IN and resolves. Same sandbox, model, workspace
   * mode and stream wiring as the implementer — and the same ticket/feature/docs
   * context, plus the conflicting paths and the sibling commits it is
   * reconciling against.
   *
   * Success is verified against git, not against what the agent says: the
   * feature branch must be fully contained in the resulting branch (nothing
   * reachable from it that the branch lacks). An agent that declared victory
   * without completing the merge therefore fails the pass, and the branch is
   * still carried forward whenever it holds commits — a failed resolve never
   * loses work.
   */
  const runResolver = async (input: {
    branch: string
    files: string[]
    attempt: number
    maxAttempts: number
  }): Promise<ResolveAttemptResult> => {
    const resolveBranch = ticketBranchName(feature.slug, ticket.seq, newId('r').slice(2, 10))
    const otherSide = await commitSummaries(project.repoPath, input.branch, feature.branch)
    const prompt = renderTemplate(readFileSync(resolverTemplatePath(), 'utf8'), {
      TICKET_JSON: ticketJson,
      FEATURE_BRIEF: featureBrief,
      DOCS_DIGEST: docsDigest,
      WORKSPACE_NOTES: workspaceNotes,
      VERIFY_NOTES: verifyNotes,
      GUARD_NOTES: buildGuardNotes(guardInstalled),
      FEATURE_BRANCH: feature.branch,
      CONFLICT_FILES: buildConflictFilesBlock(input.files),
      OTHER_SIDE: buildOtherSideBlock(otherSide),
      MERGE_COMMAND: resolveMergeCommand(workspaceMode, feature.branch),
    })
    const hookCommand = withPrelude(
      workspaceMode === 'isolated'
        ? buildIsolatedSetupCommand(resolveBranch, setupCommand, pm)
        : setupCommand,
    )

    appendTranscript(ticket.id, {
      kind: 'text',
      text: `\n— landing conflict on ${feature.branch}; resolver pass ${input.attempt}/${input.maxAttempts} —\n`,
    })

    /** The tip to carry forward: the resolver's branch iff it committed. */
    const bestTip = async (): Promise<string> => {
      const made = await branchCommitsAhead(project.repoPath, input.branch, resolveBranch)
      return made.length > 0 ? resolveBranch : input.branch
    }

    let result: RunResult | undefined
    try {
      result = await run({
        agent: buildBurnAgent(config, token, model, agentOptions),
        sandbox: selectSandbox(config, mounts),
        cwd: project.repoPath,
        prompt,
        branchStrategy: { type: 'branch', branch: resolveBranch, baseBranch: input.branch },
        signal,
        name: `ticket-${ticket.seq}-resolve`,
        maxIterations: config.burnMaxIterations,
        ...(hookCommand
          ? {
              hooks: {
                sandbox: {
                  onSandboxReady: [{ command: hookCommand, timeoutMs: SETUP_HOOK_TIMEOUT_MS }],
                },
              },
            }
          : {}),
        logging: { type: 'file', path: logFilePath, onAgentStreamEvent: onStreamEvent },
      })
    } catch (err) {
      if (ctx.signal.aborted) throw err // run cancelled — the runner finalizes it
      const tip = await bestTip()
      // Teardown-only failure (see `isWorktreeTeardownError`) on a branch that
      // holds the resolver's commits: the merge it was asked to do either
      // happened or did not, and the verification below reads that off git, not
      // off `result`. Fall through instead of reporting a failed pass.
      const teardownOnly =
        !ticketAbort.signal.aborted && isWorktreeTeardownError(err) && tip === resolveBranch
      if (!teardownOnly) {
        return {
          ok: false,
          branch: tip,
          error: ticketAbort.signal.aborted
            ? 'stopped by user during conflict resolution'
            : errorHeadline(err instanceof Error ? err.message : String(err)),
        }
      }
      await cleanupBurnWorktree(project.repoPath, resolveBranch)
    }

    const blocked = readAgentFile([result?.preservedWorktreePath, project.repoPath], 'BLOCKED.md')
    if (blocked !== undefined && blocked.trim().length > 0) {
      return {
        ok: false,
        branch: await bestTip(),
        error: `resolver reported BLOCKED:\n${blocked.trim()}`,
      }
    }
    const missing = await branchCommitsAhead(project.repoPath, resolveBranch, feature.branch)
    if (missing.length > 0) {
      return {
        ok: false,
        branch: await bestTip(),
        error: `resolver did not complete the merge — ${missing.length} commit(s) of ${feature.branch} are still missing from the branch`,
      }
    }
    return { ok: true, branch: resolveBranch }
  }

  /**
   * The commits that landed (snapshotted inside the merge queue, immediately
   * before the merge that consumes them — afterwards they are no longer "ahead"
   * of the feature branch).
   */
  let landedCommits: string[] = []

  const landDeps: LandDeps = {
    merge: (branch) =>
      land(async () => {
        const ahead = await branchCommitsAhead(project.repoPath, feature.branch, branch)
        const res = await mergeTempBranch(project.repoPath, feature.branch, branch)
        if (res.ok) landedCommits = ahead
        return res
      }),
    resolve: runResolver,
    maxResolveAttempts: Math.max(0, config.burnConflictAttempts),
    emit: (e) => ctx.emitEvent({ ...e, ticketId: ticket.id }),
    label: `ticket ${ticket.seq}`,
    featureBranch: feature.branch,
  }

  /**
   * This run's `DIGEST.md`, harvested from the workspace once the agent is done
   * and read back below when the landing resolves — landing sits between the
   * agent finishing and the outcome being returned, so the digest has to
   * survive it. Stays undefined on the conflict-resume path, where no agent
   * ran and there is nothing to harvest.
   */
  let harvestedDigest: string | undefined

  /**
   * Land `branch`, resolving conflicts in-loop, and map the result onto the
   * ticket outcome + the state the next burn needs. Shared by the normal path
   * and the conflict-resume path, so a re-landing behaves identically however
   * the ticket got here.
   */
  const landChain = async (branch: string, commits: string[]): Promise<TicketOutcome> => {
    const landing = await landWithResolve(branch, landDeps)
    if (landing.status === 'landed') {
      // Landed — nothing is pending on a branch any more, so both resume
      // pointers must go or the next burn would resume an already-merged chain.
      ctx.updateTicket(ticket.id, { attemptBranch: null, conflictFiles: null })
      return {
        status: 'done',
        commits: landedCommits.length > 0 ? landedCommits : commits,
        digest: harvestedDigest,
      }
    }

    preserveChain(landing.branch)
    if (landing.status === 'conflict') {
      // The state that makes Retry resolve instead of re-implement, and the
      // file list the run lane's conflict card renders.
      ctx.updateTicket(ticket.id, { conflictFiles: landing.files })
      const where =
        landing.files.length > 0
          ? ` on ${landing.files.length} file(s): ${landing.files.join(', ')}`
          : ''
      // Never claim the resolver failed when it was never allowed to run.
      const why =
        landDeps.maxResolveAttempts === 0
          ? `Automatic resolution is off (burnConflictAttempts = 0): ${errorHeadline(landing.error)}`
          : `The automatic resolver could not finish: ${errorHeadline(landing.error)}`
      return {
        status: 'failed',
        error: `ticket ${ticket.seq} is implemented on ${landing.branch} but conflicts with ${feature.branch}${where}. ${why}`,
        event: {
          type: 'merge.conflict.needs-human',
          message: `ticket ${ticket.seq}: could not auto-resolve the conflict with ${feature.branch} — resolve it from the run lane`,
        },
      }
    }
    // Non-conflict landing failure (lock contention, fs hiccup) — the chain is
    // preserved, so a later retry just re-lands it.
    return {
      status: 'failed',
      error: `ticket ${ticket.seq} committed to ${landing.branch} but landing on ${feature.branch} failed: ${errorHeadline(landing.error)} — the branch is preserved for manual recovery`,
    }
  }

  try {
    // CONFLICT resume: the work exists and is complete; only the landing is
    // outstanding. Skip the implementer entirely.
    if (conflictResume) {
      const branch = ticket.attemptBranch as string
      const pending = await branchCommitsAhead(project.repoPath, feature.branch, branch)
      if (pending.length === 0) {
        // Nothing left to land — the human resolved and merged it by hand
        // between runs. Record that rather than burning an agent on a no-op.
        ctx.updateTicket(ticket.id, { attemptBranch: null, conflictFiles: null })
        ctx.emitEvent({
          type: 'merge.conflict.resolved',
          message: `ticket ${ticket.seq}: ${branch} is already merged into ${feature.branch} — nothing left to land`,
          ticketId: ticket.id,
          data: { branch },
        })
        return { status: 'done', commits: ticket.commits }
      }
      ctx.emitEvent({
        type: 'ticket.resuming',
        message: `ticket ${ticket.seq}: implemented on ${branch} — retrying the landing (${pending.length} commit(s))`,
        ticketId: ticket.id,
        data: { attemptBranch: branch, preservedCommits: pending.length, conflict: true },
      })
      return await landChain(branch, pending)
    }

    let result: RunResult | undefined
    let tempBranch = ''
    for (let attempt = 1; ; attempt++) {
      // Unique per attempt (nanoid alphabet is branch-name-safe) so an attempt
      // never reuses a stale sandcastle worktree or a conflict leftover.
      tempBranch = ticketBranchName(feature.slug, ticket.seq, newId('b').slice(2, 10))
      // In isolated mode the onSandboxReady hook always runs (the clone + sync
      // wiring is needed even with nothing to install) and embeds THIS
      // attempt's temp branch; mounted mode keeps the hook only when there is
      // an install to run.
      const hookCommand = withPrelude(
        workspaceMode === 'isolated'
          ? buildIsolatedSetupCommand(tempBranch, setupCommand, pm)
          : setupCommand,
      )
      if (hookCommand && attempt === 1) {
        ctx.emitEvent({
          type: 'burn.setup',
          message:
            workspaceMode === 'isolated'
              ? `preparing isolated workspace (native-FS clone)${setupCommand ? ` + deps install: ${setupCommand}` : ''}`
              : `installing deps before agent start: ${setupCommand}`,
          ticketId: ticket.id,
        })
      }

      const runOptions: RunOptions = {
        agent: buildBurnAgent(config, token, model, agentOptions),
        sandbox: selectSandbox(config, mounts),
        cwd: project.repoPath,
        prompt: retryNotes ? `${basePrompt}\n\n${retryNotes}` : basePrompt,
        // Temp branch off the chain tip (the feature branch, or the previous
        // attempt's branch when resuming) — its own sandcastle worktree,
        // isolated from every concurrently-burning ticket. Landed below via
        // `land`; landing the final branch lands the whole chain.
        branchStrategy: { type: 'branch', branch: tempBranch, baseBranch },
        signal,
        name: `ticket-${ticket.seq}`,
        // Each iteration is a fresh `claude --print` against the same worktree.
        // It is NOT a cheap resume: sandcastle calls `withSandbox` INSIDE its
        // iteration loop, so every iteration builds a new container and re-runs
        // `onSandboxReady` (measured across real burns: 70–507s of dependency
        // install per iteration, ~2.5min average), and the fresh agent re-reads
        // from scratch everything the dead one had already read. Treat an extra
        // iteration as ~10 minutes of pure overhead, not a free retry — which is
        // why the burner prompt spends so much of its budget on ending turns
        // only when done and committing every green slice.
        //
        // The prompt's `<promise>COMPLETE</promise>` signal stops the loop early
        // on success; the headroom exists so a turn that ends prematurely (idle
        // wait, context cut) resumes instead of failing the ticket with zero
        // commits. Attempts (this loop) are one level up: a whole run() dying.
        maxIterations: config.burnMaxIterations,
        ...(hookCommand || attachmentCommands.length > 0
          ? {
              hooks: {
                // Host-side, after `git worktree add` and before the sandbox:
                // the images land in the workspace the container is about to
                // bind, so docker and noSandbox see them identically.
                ...(attachmentCommands.length > 0
                  ? { host: { onWorktreeReady: attachmentCommands } }
                  : {}),
                ...(hookCommand
                  ? {
                      sandbox: {
                        onSandboxReady: [
                          { command: hookCommand, timeoutMs: SETUP_HOOK_TIMEOUT_MS },
                        ],
                      },
                    }
                  : {}),
              },
            }
          : {}),
        logging: { type: 'file', path: logFilePath, onAgentStreamEvent: onStreamEvent },
      }

      try {
        // Immediately before the host hook that copies them in — a run that
        // never gets here (a conflict resume lands without an agent) must not
        // leave the line behind.
        await excludeAttachments()
        result = await run(runOptions)
        // Before anything lands: a preserved worktree must not keep the images.
        await clearAttachmentsFor(tempBranch)
        break
      } catch (err) {
        await clearAttachmentsFor(tempBranch)
        if (ctx.signal.aborted) throw err // let the runner mark the run cancelled
        const msg = err instanceof Error ? err.message : String(err)
        // Whatever the dead attempt committed survives on its temp branch —
        // chain the next attempt (or a later run) onto it.
        const salvaged = await branchCommitsAhead(project.repoPath, feature.branch, tempBranch)
        if (salvaged.length > 0) baseBranch = tempBranch

        if (ticketAbort.signal.aborted) {
          if (salvaged.length > 0) preserveChain(tempBranch)
          return {
            status: 'failed',
            error: `stopped by user${salvaged.length > 0 ? ` — ${salvaged.length} commit(s) preserved; retry to continue from them` : ''}`,
            event: {
              type: 'ticket.stopped',
              message: `ticket ${ticket.seq} stopped by user${salvaged.length > 0 ? ` — ${salvaged.length} commit(s) preserved for retry` : ''}`,
            },
          }
        }
        // Sandcastle's end-of-run worktree teardown failed (Windows: a handle
        // still open in the bind mount of the container it just removed). That
        // is a defect inside its release step, so `run()` rejects AFTER the
        // agent finished and its commits were collected — and the salvaged
        // commits prove the agent got there. Failing the ticket over a cleanup
        // error would discard finished work and spend another whole agent run
        // rediscovering it, so land the chain and tidy up best-effort instead.
        if (isWorktreeTeardownError(err)) {
          const removed = await cleanupBurnWorktree(project.repoPath, tempBranch)
          if (salvaged.length > 0) {
            ctx.emitEvent({
              type: 'burn.worktree.teardown-failed',
              message: `ticket ${ticket.seq}: agent finished but sandcastle could not remove its worktree (${errorHeadline(msg)})${removed ? ' — cleaned up' : ' — left on disk'}; landing the ${salvaged.length} commit(s) anyway`,
              ticketId: ticket.id,
              data: { branch: tempBranch, error: msg, cleanedUp: removed },
            })
            return await landChain(tempBranch, salvaged)
          }
          // No commits to salvage — the failure says nothing about the ticket
          // either way, so fall through to the normal paths (retry/fatal); the
          // leftover dir is cleaned up regardless.
        }
        if (isMergeConflictError(err)) {
          // Sandcastle itself hit a branch conflict setting the run up, so we
          // never reached our own landing loop and have no file list. Record
          // the conflict shape anyway (empty list) whenever commits survived:
          // that is what routes the next burn through the resolver, which
          // re-derives the conflicting paths from git.
          if (salvaged.length > 0) {
            preserveChain(tempBranch)
            ctx.updateTicket(ticket.id, { conflictFiles: [] })
          }
          return {
            status: 'failed',
            error: `merge conflict landing ticket ${ticket.seq} on ${feature.branch}: ${msg}`,
            event: {
              type: 'merge.conflict.needs-human',
              message: `ticket ${ticket.seq}: merge conflict on ${feature.branch}${salvaged.length > 0 ? ' — resolve it from the run lane' : ' — resolve manually per the error, then re-burn'}`,
            },
          }
        }
        if (classifyTicketRunError(err, model.runtime) === 'retryable' && attempt < maxAttempts) {
          const headline = errorHeadline(msg)
          retryNotes = buildRetryNotes({ error: headline, commitCount: salvaged.length })
          ctx.emitEvent({
            type: 'ticket.retrying',
            message: `ticket ${ticket.seq} attempt ${attempt}/${maxAttempts} died (${headline}) — retrying${salvaged.length > 0 ? ` from ${salvaged.length} preserved commit(s)` : ''}`,
            ticketId: ticket.id,
            data: { attempt, maxAttempts, error: msg, preservedCommits: salvaged.length },
          })
          appendTranscript(ticket.id, {
            kind: 'text',
            text: `\n— attempt ${attempt} interrupted (${headline}); starting attempt ${attempt + 1}${salvaged.length > 0 ? ' with committed work preserved' : ''} —\n`,
          })
          await delayUnlessAborted(retryDelayMs(attempt), signal)
          ctx.signal.throwIfAborted() // run cancelled during backoff
          if (ticketAbort.signal.aborted) {
            if (salvaged.length > 0) preserveChain(tempBranch)
            return {
              status: 'failed',
              error: `stopped by user${salvaged.length > 0 ? ` — ${salvaged.length} commit(s) preserved; retry to continue from them` : ''}`,
              event: {
                type: 'ticket.stopped',
                message: `ticket ${ticket.seq} stopped by user${salvaged.length > 0 ? ` — ${salvaged.length} commit(s) preserved for retry` : ''}`,
              },
            }
          }
          continue
        }
        if (salvaged.length > 0) preserveChain(tempBranch)
        return { status: 'failed', error: msg }
      }
    }

    // Unreachable (the loop exits only via break-after-assign, return, or
    // throw) — the guard just proves assignment to the type checker.
    if (!result) return { status: 'failed', error: 'internal: run loop produced no result' }

    // Interpret over the WHOLE chain (host refs include prior attempts'
    // commits): a resumed agent that only verified and committed nothing new is
    // still done; one that committed nothing new AND wrote BLOCKED.md failed —
    // its preserved chain stays on the ticket for the next retry.
    const agentFileDirs = [result.preservedWorktreePath, project.repoPath]
    const blocked = readAgentFile(agentFileDirs, 'BLOCKED.md')
    // Harvested before the landing, attached after it — see `harvestedDigest`.
    harvestedDigest = harvestDigest(agentFileDirs)
    const chain = await branchCommitsAhead(project.repoPath, feature.branch, tempBranch)
    let outcome: TicketOutcome
    if (result.commits.length === 0 && blocked !== undefined && blocked.trim().length > 0) {
      outcome = { status: 'failed', error: `agent reported BLOCKED:\n${blocked.trim()}` }
    } else if (chain.length > 0) {
      outcome = { status: 'done', commits: chain }
    } else {
      outcome = interpretRunResult(result, blocked)
    }
    if (outcome.status !== 'done') {
      if (chain.length > 0) preserveChain(tempBranch)
      return outcome
    }

    // Land the ticket's commits on the feature branch — serialized per run, so
    // two tickets finishing together never race the ref/checkout, and resolving
    // conflicts in-loop rather than dumping them on the human. The scheduler
    // only marks a ticket done (and readies its dependents) after this resolves,
    // so dependents always fork a tip that includes their blockers' work.
    return await landChain(tempBranch, outcome.commits)
  } finally {
    releaseTicketAbort(ticket.id)
    throttle.flush()
    endTranscript(ticket.id)
    // Emitted on EVERY exit path — a ticket that failed or was stopped is
    // exactly the one whose time breakdown you want.
    const timing = timer.summary()
    if (timing.calls > 0) {
      ctx.emitEvent({
        type: 'ticket.timing',
        message: `ticket ${ticket.seq} spent ${formatTimingSummary(timing)}`,
        ticketId: ticket.id,
        data: timing,
      })
    }
  }
}

/**
 * The model ONE ticket burns on. A ticket the tickets session stamped carries
 * its own assignment (decisions.md #4), and that assignment IS the run override
 * for its burn — the human curated the roster it was chosen from and can still
 * change it on the card. A ticket with no assignment resolves through the
 * unchanged chain, run override (smoke) included.
 *
 * Pure, and exported so the assignment is observable without a container: the
 * runtime it yields is what decides which CLI and which auth key the burn uses.
 */
export function resolveTicketModel(
  config: ModelConfig,
  project: { model?: string | null } | null | undefined,
  runOverride: string | null | undefined,
  ticket: Pick<Ticket, 'model'>,
): ModelEntry {
  return resolveModelEntry('implement', config, project, ticket.model ?? runOverride)
}

/**
 * Resolve production deps: real config, token from `~/.runcastle/.env`, real
 * run. The burner is the `implement` step (issue #48): its model resolves
 * through `resolveModel` — a per-ticket assignment or a per-run override (smoke)
 * wins over the per-project override, the global step override, then the global
 * default. One serial merge queue is created per run and shared by every
 * ticket's execute closure, so landings on the feature branch never overlap.
 *
 * The run-level `model`/`token` are the run's default pair — what the auth
 * precheck reports on and what every unassigned ticket burns with; a ticket that
 * carries its own assignment re-resolves both, because a model on the other
 * runtime authenticates with the other key.
 */
function resolveBurnDeps(ctx: WorkflowCtx): BurnDeps {
  const config = loadConfig()
  const model = resolveModelEntry('implement', config, ctx.project, ctx.modelOverride)
  const token = readTokenFromEnvFile(envPath(), model.runtime)
  const land = createSerialQueue()
  // Memoized so the whole run performs the parent-repo config write exactly
  // once, no matter how many tickets burn in parallel (see git.ts).
  let pushTargetReady: Promise<void> | undefined
  const ensureIsolatedPushTarget = () =>
    (pushTargetReady ??= allowPushToCheckedOutBranches(ctx.project.repoPath))

  // Run-constant, so read once per run and not once per ticket — and the digest
  // read is the one that puts its size (or its absence) on the timeline.
  const docs = readDocsDigest(ctx.project.id, ctx.feature.slug)
  emitDocsDigestEvent(ctx, docs)
  const blocks: BurnPromptBlocks = {
    docsDigest: docs.text,
    projectStandards: buildProjectStandards(ctx.project.repoPath),
    driveNotes: buildDriveNotes({
      repoPath: ctx.project.repoPath,
      driveSetupCommand: ctx.project.driveSetupCommand,
      driveStopCommand: ctx.project.driveStopCommand,
      devCommand: ctx.project.devCommand,
      dbResetCommand: ctx.project.dbResetCommand,
    }),
  }

  /**
   * A ticket's own model and the credential that model burns on — re-read for a
   * ticket assigned to the other runtime, which authenticates with the other
   * key. Resolved in one place so the per-ticket precheck and the executor can
   * never disagree about what this ticket would run with.
   */
  const ticketCredentials = (ticket: Ticket): { model: ModelEntry; token: string | undefined } => {
    const ticketModel = resolveTicketModel(config, ctx.project, ctx.modelOverride, ticket)
    return {
      model: ticketModel,
      token:
        ticketModel.runtime === model.runtime
          ? token
          : readTokenFromEnvFile(envPath(), ticketModel.runtime),
    }
  }

  return {
    config,
    runtime: model.runtime,
    hasAuthToken: burnAuthReady(model.runtime, token),
    ticketAuthMissing: (ticket) => {
      const { model: ticketModel, token: ticketToken } = ticketCredentials(ticket)
      return burnAuthReady(ticketModel.runtime, ticketToken) ? undefined : ticketModel.runtime
    },
    concurrency: config.burnConcurrency,
    executeTicketRun: (c, ticket, run) => {
      const { model: ticketModel, token: ticketToken } = ticketCredentials(ticket)
      return isReviewTicket(ticket)
        ? executeReviewTicket(c, ticket, {
            config,
            token: ticketToken,
            model: ticketModel,
            docsDigest: docs.text,
            lapDigests: run.digests,
          })
        : realExecuteTicketRun(
            c,
            ticket,
            config,
            ticketToken,
            ticketModel,
            land,
            ensureIsolatedPushTarget,
            blocks,
            run,
          )
    },
  }
}

/**
 * Read a runtime's AFK auth value from the .env file, falling back to process
 * env. Which key that is belongs to the runtime, not to this reader — Claude
 * Code burns on `CLAUDE_CODE_OAUTH_TOKEN`, Codex burns on `CODEX_API_KEY`.
 */
export function readTokenFromEnvFile(path: string, runtime: AgentRuntime): string | undefined {
  const key = RUNTIME_AUTH_KEY[runtime]
  let fromFile: string | undefined
  if (existsSync(path)) {
    try {
      fromFile = parseEnvFile(readFileSync(path, 'utf8'))[key]
    } catch {
      fromFile = undefined
    }
  }
  const token = fromFile && fromFile.length > 0 ? fromFile : process.env[key]
  return token && token.length > 0 ? token : undefined
}

export const ticketBurner: WorkflowDef = {
  id: 'ticket-burner',
  run: (ctx) => burnRun(ctx, resolveBurnDeps(ctx)),
}
