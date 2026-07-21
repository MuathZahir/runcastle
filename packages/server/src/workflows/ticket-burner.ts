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
import { newId, resolveModel, resolveSandboxImage } from '@runcastle/core'
import { loadConfig } from '@runcastle/core/config-load'
import { burnCacheDir, envPath, featureDocsRel, logsDir, worktreeDir } from '@runcastle/core/paths'
import { resolveSkillsRoot } from '../launcher/skills-root'
import {
  appendTranscript,
  beginTranscript,
  endTranscript,
} from '../services/agent-stream'
import { allowPushToCheckedOutBranches, mergeTempBranch, ticketBranchName } from '../services/git'
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
 */

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
  /** Whether a CLAUDE_CODE_OAUTH_TOKEN is available (container sandboxes require it). */
  hasAuthToken: boolean
  /** Worker-pool width — how many tickets burn in parallel (`config.burnConcurrency`). */
  concurrency: number
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

const PLACEHOLDERS = [
  'TICKET_JSON',
  'FEATURE_BRIEF',
  'DOCS_DIGEST',
  'COMMIT_CONVENTION',
  'WORKSPACE_NOTES',
] as const
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
 */
export function resolveSetupCommand(tc: RepoToolchain, override?: string): string | undefined {
  const trimmed = override?.trim()
  if (trimmed) return trimmed
  const pm = detectPackageManager(tc)
  if (!pm) return undefined
  switch (pm) {
    case 'bun':
      return tc.lockfiles.bun ? 'bun install --frozen-lockfile' : 'bun install'
    case 'pnpm':
      return tc.lockfiles.pnpm ? 'corepack pnpm install --frozen-lockfile' : 'corepack pnpm install'
    case 'yarn':
      return tc.lockfiles.yarn ? 'corepack yarn install --frozen-lockfile' : 'corepack yarn install'
    case 'npm':
      return tc.lockfiles.npm ? 'npm ci' : 'npm install'
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
 * via `sh -c`, cwd = the mounted workspace). Four steps:
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
 * 3. Install a `post-commit` hook in the clone that, on every commit, pushes
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
 * 4. Run the deps install inside the clone, where pnpm's hardlinks actually
 *    work (ADR-0004) and node_modules materializes on native FS.
 *
 * The `receive.denyCurrentBranch` write must NOT happen here: a worktree
 * shares its parent repo's `.git/config`, so N sandboxes running it
 * concurrently race on the shared `config.lock`.
 */
export function buildIsolatedSetupCommand(
  tempBranch: string,
  setupCommand: string | undefined,
): string {
  const hookFile = `${ISOLATED_REPO_PATH}/.git/hooks/post-commit`
  const parts = [
    `git config --global --add safe.directory '*'`,
    `git clone ${SANDBOX_WORKSPACE_PATH} ${ISOLATED_REPO_PATH}`,
    `printf '#!/bin/sh\\nunset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE\\ngit push --quiet origin HEAD:%s && exec git -C ${SANDBOX_WORKSPACE_PATH} reset --hard --quiet %s\\n' '${tempBranch}' '${tempBranch}' > ${hookFile}`,
    `chmod +x ${hookFile}`,
  ]
  if (setupCommand) parts.push(`cd ${ISOLATED_REPO_PATH} && ${setupCommand}`)
  return parts.join(' && ')
}

/**
 * The `{{WORKSPACE_NOTES}}` block for the burner prompt: where the agent must
 * work. Isolated mode redirects it into the native-FS clone and covers the two
 * places the redirect could otherwise leak (edits in the mounted mirror, a
 * BLOCKED.md the host would never see). Worst case if the agent ignores this
 * and works in the workspace anyway: today's mounted behavior — slow, but
 * correct.
 */
export function buildWorkspaceNotes(mode: BurnWorkspaceMode): string {
  if (mode === 'mounted') {
    return 'Work in the current directory — it is the repo checkout on your branch.'
  }
  return [
    `Your working repository is \`${ISOLATED_REPO_PATH}\` — a clone on the container's fast native filesystem, with dependencies already installed. Do ALL work there: \`cd ${ISOLATED_REPO_PATH}\` first; every file you read, edit, test, and commit lives under it.`,
    '',
    `The directory you start in (\`${SANDBOX_WORKSPACE_PATH}\`) is a slow mounted mirror used only to collect your commits — never edit files, install, or run tests there. Your commits sync back automatically (a post-commit hook pushes them); just commit as normal.`,
    '',
    `If you are blocked and write \`BLOCKED.md\`, write it at \`${ISOLATED_REPO_PATH}/BLOCKED.md\` AND copy it to \`${SANDBOX_WORKSPACE_PATH}/BLOCKED.md\` so the orchestrator can see it.`,
  ].join('\n')
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
// Scheduler — worker pool over the ready queue (width = deps.concurrency)
// ---------------------------------------------------------------------------

type ReadyState = 'ready' | 'wait' | { blockedBy: number; present: boolean }

/**
 * The most informative single line of a multi-line error. Git buries the cause
 * under progress noise — a failed `worktree add` starts with "Preparing
 * worktree (...)" and only says `fatal: ... Filename too long` lines later —
 * so prefer the LAST `fatal:`/`error:` line over the first line.
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
 * Drive tickets to terminal states honouring `blockedBy`. A ticket is ready when
 * all its blockers are `done`; a ticket with a `failed`/missing blocker is
 * marked failed (`blocked by failed ticket <seq>`) and cascades to its own
 * dependents. Runs up to `concurrency` at once (min 1). Aborts propagate
 * (thrown by `execute`) so the runner finalizes the run as cancelled — with
 * every other in-flight ticket drained first, so no rejection goes unhandled.
 * Returns the count of tickets in `done` state at the end.
 */
export async function burnTickets(
  ctx: WorkflowCtx,
  tickets: Ticket[],
  execute: (ctx: WorkflowCtx, ticket: Ticket) => Promise<TicketOutcome>,
  concurrency = 1,
): Promise<number> {
  const width = Math.max(1, Math.floor(concurrency))
  const bySeq = indexBySeq(tickets)
  const status = new Map<number, TicketStatus>(tickets.map((t) => [t.seq, t.status]))
  const pending = new Set<number>(tickets.filter((t) => t.status === 'pending').map((t) => t.seq))
  const inFlight = new Map<number, Promise<void>>()

  // A blocker is satisfied when `done` OR `cancelled` — a human cancelled it
  // because the work is unnecessary, so dependents proceed without it.
  const satisfied = (s: TicketStatus | undefined): boolean => s === 'done' || s === 'cancelled'

  const readyState = (seq: number): ReadyState => {
    const t = bySeq.get(seq)
    if (!t) return 'wait'
    for (const b of t.blockedBy) {
      const present = bySeq.has(b)
      const bs = present ? status.get(b) : undefined
      if (!present || bs === 'failed') return { blockedBy: b, present }
    }
    return t.blockedBy.every((b) => satisfied(status.get(b))) ? 'ready' : 'wait'
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
  // Cancelled tickets never burn and never count against success — but they DO
  // stay in the scheduler's ticket set so dependents can see their blocker is
  // satisfied (`burnTickets` receives the full list).
  const burnable = tickets.filter((t) => t.status !== 'cancelled')
  const cancelled = tickets.length - burnable.length
  const total = burnable.length

  // Auth precheck: container sandboxes (docker/podman) need a token before we
  // start any container; noSandbox runs `claude` on the already-authed host.
  if (deps.config.sandbox !== 'noSandbox' && !deps.hasAuthToken) {
    ctx.emitEvent({ type: AUTH_MISSING_EVENT, message: AUTH_MISSING_MESSAGE })
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

  const done = await burnTickets(ctx, tickets, deps.executeTicketRun, deps.concurrency)
  const summary =
    cancelled > 0 ? `${done}/${total} tickets done (${cancelled} cancelled)` : `${done}/${total} tickets done`
  ctx.emitEvent({ type: 'burn.summary', message: summary, data: { done, total, cancelled } })
  return { status: done === total ? 'succeeded' : 'failed', summary }
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
  const here = dirname(fileURLToPath(import.meta.url))
  return join(resolveSkillsRoot(here), 'burner', 'implement-ticket.md')
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
 * gaps in `@ai-hero/sandcastle` 0.12.0's `noSandbox` provider (the container
 * providers docker/podman are unaffected — they run inside a Linux container
 * with a POSIX shell):
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
export function buildBurnAgent(
  config: RuncastleConfig,
  token: string | undefined,
  model: string,
): AgentProvider {
  const onHost = config.sandbox === 'noSandbox'
  const opts: ClaudeCodeOptions = {
    ...(token ? { env: { CLAUDE_CODE_OAUTH_TOKEN: token } } : {}),
    ...(onHost ? { permissionMode: 'bypassPermissions' as const } : {}),
  }
  const agent = claudeCode(model, opts)

  if (onHost && process.platform === 'win32') {
    const quoted = `--model '${model}'`
    const unquoted = `--model ${model}`
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
 * Pick the sandcastle sandbox provider for the configured `sandbox`. The two
 * container providers (docker/podman) take an explicit `imageName` — always
 * `resolveSandboxImage(config)`, never sandcastle's `sandcastle:<repo-dir-name>`
 * fallback, so the tag matches what build-image/doctor built (SPEC §8; the
 * "Image not found locally" mismatch). podman keeps sandcastle's rootless
 * defaults (SELinux `:z` relabel + `keep-id` userns) — runcastle passes no
 * volume-label/userns flags of its own. `mounts` (package-manager cache dirs)
 * apply to the container providers only — noSandbox runs on the host, where the
 * real cache is already in place.
 */
export function selectSandbox(config: RuncastleConfig, mounts: readonly CacheMount[] = []) {
  const imageOpts = {
    imageName: resolveSandboxImage(config),
    ...(mounts.length > 0 ? { mounts } : {}),
  }
  switch (config.sandbox) {
    case 'docker':
      return docker(imageOpts)
    case 'podman':
      return podman(imageOpts)
    default:
      return noSandbox()
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
 * once. A landing conflict (parallel tickets touched the same files) fails the
 * ticket with `merge.conflict.needs-human`, preserving the temp branch for
 * manual recovery. Aborts are rethrown.
 */
async function realExecuteTicketRun(
  ctx: WorkflowCtx,
  ticket: Ticket,
  config: RuncastleConfig,
  token: string | undefined,
  model: string,
  land: <T>(task: () => Promise<T>) => Promise<T>,
  ensureIsolatedPushTarget: () => Promise<void>,
): Promise<TicketOutcome> {
  const { project, feature } = ctx
  // Unique per attempt (nanoid alphabet is branch-name-safe) so a re-burned
  // ticket never reuses a stale sandcastle worktree or a conflict leftover.
  const tempBranch = ticketBranchName(feature.slug, ticket.seq, newId('b').slice(2, 10))

  // Where the agent's hot path lives (ADR-0005): on win32/darwin container
  // hosts the bind-mounted worktree pays Docker Desktop's per-file translation
  // tax, so `auto` isolates the working tree onto the container's native FS.
  const workspaceMode = resolveBurnWorkspaceMode(config)

  // Isolated mode pushes commits back into the mounted worktree, which the
  // parent repo's config must permit. Host-side and shared across tickets —
  // in-sandbox this write raced N containers on the shared `config.lock`.
  if (workspaceMode === 'isolated') await ensureIsolatedPushTarget()

  const template = readFileSync(burnerTemplatePath(), 'utf8')
  const prompt = renderTicketPrompt(template, {
    TICKET_JSON: buildTicketJson(ticket),
    FEATURE_BRIEF: buildFeatureBrief(feature),
    DOCS_DIGEST: readDocsDigestFromDisk(project.id, feature.slug),
    COMMIT_CONVENTION: `ticket(${ticket.seq}): <summary>`,
    WORKSPACE_NOTES: buildWorkspaceNotes(workspaceMode),
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
  const setupCommand = resolveSetupCommand(toolchain, config.setupCommand)
  const mounts: CacheMount[] = []
  if (config.sandbox !== 'noSandbox' && pm) {
    const mount = cacheMountFor(pm, burnCacheDir(pm))
    if (mount) {
      mkdirSync(mount.hostPath, { recursive: true }) // a missing hostPath fails sandbox creation
      mounts.push(mount)
    }
  }
  // In isolated mode the onSandboxReady hook always runs (the clone + sync
  // wiring is needed even with nothing to install); mounted mode keeps the
  // hook only when there is an install to run.
  const hookCommand =
    workspaceMode === 'isolated'
      ? buildIsolatedSetupCommand(tempBranch, setupCommand)
      : setupCommand
  if (hookCommand) {
    ctx.emitEvent({
      type: 'burn.setup',
      message:
        workspaceMode === 'isolated'
          ? `preparing isolated workspace (native-FS clone)${setupCommand ? ` + deps install: ${setupCommand}` : ''}`
          : `installing deps before agent start: ${setupCommand}`,
      ticketId: ticket.id,
    })
  }

  mkdirSync(logsDir(), { recursive: true })
  const logFilePath = join(logsDir(), `burn-${feature.id}-${ticket.seq}.log`)
  const throttle = createStreamThrottle((e) => ctx.emitEvent({ ...e, ticketId: ticket.id }))

  // Two consumers of the agent stream: the throttle (coarse timeline events for
  // the DB) and the in-memory transcript (UNTHROTTLED — the live Claude Code
  // style view in the UI polls it). begin() resets any previous attempt's
  // transcript so a re-burn starts clean.
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

  const runOptions: RunOptions = {
    agent: buildBurnAgent(config, token, model),
    sandbox: selectSandbox(config, mounts),
    cwd: project.repoPath,
    prompt,
    // Temp branch off the feature branch tip — its own sandcastle worktree,
    // isolated from every concurrently-burning ticket. Landed below via `land`.
    branchStrategy: { type: 'branch', branch: tempBranch, baseBranch: feature.branch },
    signal: ctx.signal,
    name: `ticket-${ticket.seq}`,
    // Each iteration is a fresh `claude --print` against the same worktree (and
    // the same warm container, so the setup hook runs once). The prompt's
    // `<promise>COMPLETE</promise>` signal stops the loop early on success; the
    // headroom exists so a turn that ends prematurely (idle wait, context cut)
    // resumes instead of failing the ticket with zero commits.
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
  }

  let result: RunResult
  try {
    result = await run(runOptions)
  } catch (err) {
    throttle.flush()
    endTranscript(ticket.id)
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
  endTranscript(ticket.id)

  const blocked = readBlockedFile([result.preservedWorktreePath, project.repoPath])
  const outcome = interpretRunResult(result, blocked)
  if (outcome.status !== 'done') return outcome

  // Land the ticket's commits on the feature branch — serialized per run, so
  // two tickets finishing together never race the ref/checkout. The scheduler
  // only marks a ticket done (and readies its dependents) after this resolves,
  // so dependents always fork a tip that includes their blockers' work.
  const merge = await land(() => mergeTempBranch(project.repoPath, feature.branch, tempBranch))
  if (!merge.ok) {
    const detail = merge.error ?? 'merge failed'
    if (merge.conflict) {
      return {
        status: 'failed',
        error: `ticket ${ticket.seq} committed to ${tempBranch} but landing on ${feature.branch} hit a conflict: ${detail}`,
        event: {
          type: 'merge.conflict.needs-human',
          message: `ticket ${ticket.seq}: ${tempBranch} conflicts with ${feature.branch} — merge it manually (git merge ${tempBranch}; resolve; git branch -D ${tempBranch}), then re-burn`,
        },
      }
    }
    return {
      status: 'failed',
      error: `ticket ${ticket.seq} committed to ${tempBranch} but landing on ${feature.branch} failed: ${errorHeadline(detail)} — the branch is preserved for manual recovery`,
    }
  }

  return outcome
}

/**
 * Resolve production deps: real config, token from `~/.runcastle/.env`, real
 * run. The burner is the `implement` step (issue #48): its model resolves
 * through `resolveModel` — a per-run override (smoke) wins over the step
 * override, the per-project override, then the global default. One serial merge
 * queue is created per run and shared by every ticket's execute closure, so
 * landings on the feature branch never overlap.
 */
function resolveBurnDeps(ctx: WorkflowCtx): BurnDeps {
  const config = loadConfig()
  const token = readTokenFromEnvFile(envPath())
  const model = resolveModel('implement', config, ctx.project, ctx.modelOverride)
  const land = createSerialQueue()
  // Memoized so the whole run performs the parent-repo config write exactly
  // once, no matter how many tickets burn in parallel (see git.ts).
  let pushTargetReady: Promise<void> | undefined
  const ensureIsolatedPushTarget = () =>
    (pushTargetReady ??= allowPushToCheckedOutBranches(ctx.project.repoPath))
  return {
    config,
    hasAuthToken: token !== undefined,
    concurrency: config.burnConcurrency,
    executeTicketRun: (c, ticket) =>
      realExecuteTicketRun(c, ticket, config, token, model, land, ensureIsolatedPushTarget),
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
  run: (ctx) => burnRun(ctx, resolveBurnDeps(ctx)),
}
