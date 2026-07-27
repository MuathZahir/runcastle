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
import {
  allowPushToCheckedOutBranches,
  branchCommitsAhead,
  cleanupBurnWorktree,
  commitSummaries,
  mergeTempBranch,
  ticketBranchName,
} from '../services/git'
import type { TempBranchMergeResult } from '../services/git'
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
import { buildGuardInstallCommand } from './burn-guard'
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
  'VERIFY_NOTES',
] as const
type PlaceholderKey = (typeof PLACEHOLDERS)[number]

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
 * via `sh -c`, cwd = the mounted workspace). Six steps:
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
 * 4. For corepack-managed managers (pnpm/yarn), shim the bare binary onto
 *    `~/.local/bin` (on PATH in the node:22 image). Neither manager is
 *    preinstalled — only `corepack` is — and in real burns every agent
 *    independently burned iterations rediscovering `pnpm: command not found`
 *    and hand-writing this exact shim.
 * 5. Run the deps install inside the clone, where pnpm's hardlinks actually
 *    work (ADR-0004) and node_modules materializes on native FS.
 * 6. LAST, re-pin `core.hooksPath` to the clone's `.git/hooks`. A husky
 *    `prepare` script run by the install sets `core.hooksPath=.husky/_`, which
 *    makes git ignore `.git/hooks/` entirely — silently disarming the sync
 *    hook from step 3, so every commit stays trapped in the clone and the
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
  const parts = [
    `git config --global --add safe.directory '*'`,
    `git clone ${SANDBOX_WORKSPACE_PATH} ${ISOLATED_REPO_PATH}`,
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
    `The directory you start in (\`${SANDBOX_WORKSPACE_PATH}\`) is a slow mounted mirror used only to collect your commits — never edit files, install, or run tests there. Your commits sync back automatically (a post-commit hook pushes them); just commit as normal. If you re-run the dependency install and it reconfigures git hooks (husky), run \`git -C ${ISOLATED_REPO_PATH} config core.hooksPath ${ISOLATED_REPO_PATH}/.git/hooks\` afterwards so the sync hook stays armed.`,
    '',
    `If you are blocked and write \`BLOCKED.md\`, write it at \`${ISOLATED_REPO_PATH}/BLOCKED.md\` AND copy it to \`${SANDBOX_WORKSPACE_PATH}/BLOCKED.md\` so the orchestrator can see it.`,
  ].join('\n')
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
 * Should a failed sandcastle attempt be retried? Fatal patterns win over
 * retryable ones; anything unrecognized is fatal — an unknown throw (git
 * worktree setup, sandbox creation) could compound if blindly retried, and the
 * manual per-ticket retry tools cover it.
 */
export function classifyTicketRunError(err: unknown): 'retryable' | 'fatal' {
  const msg = err instanceof Error ? err.message : typeof err === 'string' ? err : String(err)
  if (FATAL_ERROR_PATTERNS.some((p) => p.test(msg))) return 'fatal'
  if (RETRYABLE_ERROR_PATTERNS.some((p) => p.test(msg))) return 'retryable'
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
  return burnerAssetPath('implement-ticket.md')
}

/** Absolute path to the conflict-resolver prompt template (same skills root). */
export function resolverTemplatePath(): string {
  return burnerAssetPath('resolve-conflict.md')
}

function burnerAssetPath(file: string): string {
  const here = dirname(fileURLToPath(import.meta.url))
  return join(resolveSkillsRoot(here), 'burner', file)
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
    default:
      return noSandbox()
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
  model: string,
  land: <T>(task: () => Promise<T>) => Promise<T>,
  ensureIsolatedPushTarget: () => Promise<void>,
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

  // Shared by both prompts: a resolver spawned after the fact gets the SAME
  // ticket + feature + docs context the implementer had (the whole point — it
  // must resolve by intent, which only the ticket and the feature docs carry).
  const ticketJson = buildTicketJson(ticket)
  const featureBrief = buildFeatureBrief(feature)
  const docsDigest = readDocsDigestFromDisk(project.id, feature.slug)
  const workspaceNotes = buildWorkspaceNotes(workspaceMode)
  // Also shared: the resolver runs the same suites on the merge result, and
  // guessed filter names / re-derived baselines cost it exactly what they cost
  // the implementer.
  const verifyNotes = buildVerifyNotes(config)

  const basePrompt = renderTicketPrompt(readFileSync(burnerTemplatePath(), 'utf8'), {
    TICKET_JSON: ticketJson,
    FEATURE_BRIEF: featureBrief,
    DOCS_DIGEST: docsDigest,
    COMMIT_CONVENTION: `ticket(${ticket.seq}): <summary>`,
    VERIFY_NOTES: verifyNotes,
    WORKSPACE_NOTES: workspaceNotes,
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
  // The burn guard (PreToolUse deny hook) is installed by the same
  // onSandboxReady hook that installs deps, so it is armed before the agent's
  // first tool call. Container sandboxes only: under `noSandbox` the agent runs
  // as the human on the host, where writing `~/.claude/settings.json` would
  // clobber their own. In mounted mode with nothing to install this makes the
  // hook run where it previously did not — intended.
  const guardInstall =
    config.burnGuard && config.sandbox !== 'noSandbox' ? buildGuardInstallCommand() : undefined
  const withGuard = (setup: string | undefined): string | undefined =>
    guardInstall === undefined ? setup : setup ? `${guardInstall} && ${setup}` : guardInstall

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
  const ticketAbort = new AbortController()
  activeTicketAborts.set(ticket.id, ticketAbort)
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
      FEATURE_BRANCH: feature.branch,
      CONFLICT_FILES: buildConflictFilesBlock(input.files),
      OTHER_SIDE: buildOtherSideBlock(otherSide),
      MERGE_COMMAND: resolveMergeCommand(workspaceMode, feature.branch),
    })
    const hookCommand = withGuard(
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
        agent: buildBurnAgent(config, token, model),
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

    const blocked = readBlockedFile([result?.preservedWorktreePath, project.repoPath])
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
      return { status: 'done', commits: landedCommits.length > 0 ? landedCommits : commits }
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
      const hookCommand = withGuard(
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
        agent: buildBurnAgent(config, token, model),
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

      try {
        result = await run(runOptions)
        break
      } catch (err) {
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
        if (classifyTicketRunError(err) === 'retryable' && attempt < maxAttempts) {
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
    const blocked = readBlockedFile([result.preservedWorktreePath, project.repoPath])
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
    activeTicketAborts.delete(ticket.id)
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
