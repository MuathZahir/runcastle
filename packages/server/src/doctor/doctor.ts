/**
 * Prerequisite probe library — the honest, injected core of `runcastle doctor`.
 *
 * Every probe takes an injected {@link ExecFn} and returns a {@link ProbeResult}
 * with a precise status and an actionable fix line. Nothing here spawns on its
 * own; the real command runner lives in `system-exec.ts` and is passed in, so
 * tests drive fully-canned environments (missing binary, dead daemon, stopped
 * machine, no git identity) without touching the host.
 *
 * Design follows docs/research/PREREQS-NOTES.md §8: presence (binary resolvable
 * on PATH) is split from health (the thing behind it responds), because for
 * container runtimes those are very different failures that deserve different
 * fixes.
 */

import { existsSync } from 'node:fs'
import {
  AGENT_RUNTIMES,
  DEFAULT_RUNTIME,
  DEFAULT_SANDBOX_IMAGE,
  resolveBurnCacheMode,
  resolveSandboxImage,
  type AgentRuntime,
  type RuncastleConfig,
} from '@runcastle/core'
import { burnerDockerfilePath } from '../launcher/asset-paths'
import { isOlderVersion, minimumCliVersion } from './adapter-requirements'
import {
  type HostAgentVersions,
  parseAgentCliVersion,
  resolveHostAgentVersions,
} from '../services/agent-cli-versions'
import { codexAuthFile } from '../services/codex-auth'
import {
  type BuiltImage,
  describeFreshnessReason,
  type FreshnessReason,
  hashDockerfile,
  imageFreshness,
  imageUidMismatch,
  imageUidMismatchMessage,
  inspectBuiltImage,
  legacyGlobalImage,
  legacyGlobalImageReason,
  parseImageUser,
  projectDockerfilePath,
  projectImageTag,
  type StoredProjectImage,
  unmanagedImage,
  unmanagedImageReason,
} from '../services/sandbox-image'
import type { Runtime } from '../services/setup'
import {
  BURN_CACHE_VOLUME_LABEL,
  burnCacheVolumeName,
  checkBurnCacheAccess,
  inspectBurnCacheVolume,
} from '../workflows/burn-cache'
import {
  type BurnUser,
  burnUserSpec,
  resolveBurnUser,
  ROOT_BURN_REFUSED,
  runningAsRoot,
} from '../workflows/burn-user'
import type { TokenCheck } from './token-check'

/** Outcome of one injected command. `ok:false` = spawn failed (ENOENT / not on PATH). */
export interface ExecOutcome {
  /** The process spawned and ran (regardless of exit code). `false` = not found. */
  ok: boolean
  /** Exit code, or `null` when the spawn itself failed or the command timed out. */
  code: number | null
  stdout: string
  stderr: string
  /** The command never answered and was killed — `ok` stays true, `code` is null. */
  timedOut?: boolean
}

/** The single injected seam: run a command, never throw. */
export type ExecFn = (command: string, args: string[]) => Promise<ExecOutcome>

/**
 * A probe's precise verdict. `ok` is healthy; everything else is a distinct,
 * separately-fixable failure — crucially `missing` (not installed) is never
 * conflated with an installed-but-broken state.
 */
export type ProbeStatus =
  | 'ok'
  | 'stale' // present, but no longer matches the Dockerfile it was built from
  | 'missing' // presence check failed — not installed / not on PATH
  | 'not-built-yet' // the repo asks for an image runcastle has not built yet
  | 'custom' // a resource runcastle does not manage — nothing here to fix
  | 'daemon-dead' // container CLI present, daemon not responding (docker)
  | 'machine-stopped' // container CLI present, VM not initialized/started (podman)
  | 'unhealthy' // present but a generic health probe failed
  | 'unset' // a value (git identity / AFK token) is absent

/**
 * How much a failing probe means. `error` is a genuine problem to fix; `info` is
 * reported for context only and never fails the report — a runtime nothing the
 * operator configured resolves to is reported honestly ("codex not found") but
 * is not a fault of their setup.
 */
export type ProbeSeverity = 'error' | 'info'

/** Which readiness question a per-runtime probe answers. */
export type RuntimeCheck =
  | 'binary' // the CLI is resolvable
  | 'auth' // the CLI reports an interactive login (talk sessions)
  | 'afk-key' // the unattended credential is in the environment (burns)

export interface ProbeResult {
  id: string
  label: string
  /** Tier 1 = required to run runcastle at all; Tier 2 = only for AFK/sandbox burns. */
  tier: 1 | 2
  status: ProbeStatus
  severity: ProbeSeverity
  /** What was actually found — the observed evidence. */
  detail: string
  /** Copy-pasteable next step; omitted only when `status === 'ok'`. */
  fix?: string
  /** Set on the per-runtime probes: whose readiness this reports. */
  runtime?: AgentRuntime
  /** Set on the per-runtime probes: which readiness question this answers. */
  check?: RuntimeCheck
}

export interface DoctorEnv {
  exec: ExecFn
  /** Environment map to read tokens from; defaults to `process.env`. */
  env?: Record<string, string | undefined>
  /** Target platform for fix wording; defaults to the host. */
  platform?: NodeJS.Platform
  /** Directory to resolve git identity in (repo-local overrides honored). */
  cwd?: string
  /**
   * Sandcastle image tag to inspect (defaults to {@link DEFAULT_SANDBOX_IMAGE}),
   * resolved from every layer BELOW a project's own column — see
   * {@link ImageProbeInput.imageName}.
   */
  imageName?: string
  /**
   * The runtimes some configured model resolves to (`configuredRuntimes` from
   * core). Every runtime is still probed; these are the ones whose gaps are
   * `error` rather than `info`. Defaults to the historical single runtime.
   */
  runtimes?: readonly AgentRuntime[]
  /** The oldest CLI version the pinned chat adapter needs; defaults to reading the installed adapter packages. */
  minimumCliVersion?: (runtime: AgentRuntime) => string | null
  /** Injected file-existence check for the auth-file fallback; defaults to real fs. */
  fileExists?: (path: string) => boolean
  /**
   * Injected Dockerfile hash read — null when the file is not there. Defaults to
   * {@link hashDockerfile}, and is how tests drive every staleness state.
   */
  dockerfileHash?: (path: string) => string | null
  /** The bundled burner Dockerfile; defaults to {@link burnerDockerfilePath}. */
  burnerDockerfile?: string
  /** The project whose image row this report drives; absent app-wide. */
  projectImage?: ProjectImageEnv
  /**
   * Every project this install knows, by id — what {@link legacyGlobalImage}
   * measures a machine-wide image against. Absent where the project list is
   * unreachable (the `runcastle doctor` CLI has no database), and the row then
   * says nothing about legacy residue rather than guessing at it.
   */
  knownProjectIds?: readonly string[]
  /** Who burns run as; resolved per engine when omitted. */
  burnUser?: BurnUser
  /** The host is running as root; read from the process when omitted. */
  runningAsRoot?: boolean
  /** Which cache volumes to test. Absent, the report has no volume row. */
  burnCache?: BurnCacheScope
  /** Lines assigning each AFK key in `~/.runcastle/.env`. Absent, not reported. */
  afkKeyLines?: Record<string, number>
  /**
   * Test the Claude Code AFK token with a real call. Only `runcastle doctor` run
   * by hand supplies this (decision 8): a live call spends the human's usage, and
   * the app's doctor query runs on screens the app waits for.
   */
  checkToken?: (token: string) => Promise<TokenCheck>
}

/**
 * The cache volumes a report tests, and the image to test them from: one
 * project's, or, with no `projectId`, every labelled volume on the engine, which
 * is how the CLI answers with no project list to read.
 */
export interface BurnCacheScope {
  imageName: string
  projectId?: string
}

/** Whether burns on this config use a cache volume the doctor can test. */
export function burnsOnDockerCache(
  config: Pick<RuncastleConfig, 'burnCache' | 'sandbox'>,
): boolean {
  return config.sandbox === 'docker' && resolveBurnCacheMode(config) === 'volume'
}

/**
 * The project half of the image question (decisions 5, 6 and 8), injected like
 * everything else the doctor reads: the probe decides whether a repo's own
 * `.runcastle/sandbox/Dockerfile` is built, current and adopted, without
 * reaching for the database itself.
 */
export interface ProjectImageEnv extends StoredProjectImage {
  /** The canonical checkout `.runcastle/sandbox/Dockerfile` would live in. */
  repoPath: string
  /** Drop a machine-written column whose Dockerfile is gone (decision 8). */
  clearStored: () => void
}

export interface DoctorReport {
  results: ProbeResult[]
  /** Every `error`-severity probe is `ok` — `info` probes never fail a report. */
  ok: boolean
  /** Every `error`-severity Tier-1 probe is `ok` (the pre-boot gate condition). */
  tier1Ok: boolean
}

// ---------------------------------------------------------------------------
// Individual probes
// ---------------------------------------------------------------------------

/** Presence == health for self-contained binaries: one `--version` call. */
async function versionProbe(
  exec: ExecFn,
  id: string,
  label: string,
  bin: string,
  fix: string,
): Promise<ProbeResult> {
  const out = await exec(bin, ['--version'])
  if (out.ok && out.code === 0) {
    return {
      id,
      label,
      tier: 1,
      status: 'ok',
      severity: 'error',
      detail: out.stdout.trim() || `${bin} present`,
    }
  }
  return {
    id,
    label,
    tier: 1,
    status: 'missing',
    severity: 'error',
    detail: `${bin} not found on PATH`,
    fix,
  }
}

async function bunProbe(exec: ExecFn): Promise<ProbeResult> {
  return versionProbe(
    exec,
    'bun',
    'Bun runtime',
    'bun',
    'Install Bun: curl -fsSL https://bun.sh/install | bash (Windows: irm bun.sh/install.ps1 | iex)',
  )
}

async function nodeProbe(exec: ExecFn): Promise<ProbeResult> {
  return versionProbe(
    exec,
    'node',
    'Node.js (PTY sidecar backend)',
    'node',
    'Install Node.js 22+ — required on every platform: the embedded terminal runs in a node-hosted PTY sidecar, and without node it exits instantly.',
  )
}

async function gitProbe(exec: ExecFn): Promise<ProbeResult> {
  return versionProbe(
    exec,
    'git',
    'Git',
    'git',
    'Install Git: winget install Git.Git / brew install git / apt install git',
  )
}

// ---------------------------------------------------------------------------
// Per-runtime readiness (decision 6): every runtime probed, conditional severity
// ---------------------------------------------------------------------------

/**
 * What one agent runtime's CLI looks like to the setup and probe surfaces: the
 * binary to resolve, how to ask it whether the human is logged in, the command
 * that logs them in, and the env var carrying the unattended (AFK) credential.
 *
 * One table so onboarding, the doctor, and the AFK card can be written once and
 * read per runtime instead of being spelled out per provider.
 */
export interface RuntimeSpec {
  runtime: AgentRuntime
  /** How the runtime is named to a human. */
  label: string
  /** The CLI binary. */
  bin: string
  /**
   * Probe ids, pinned rather than derived so existing ids stay stable. `afkKey`
   * is absent for a runtime whose unattended burns borrow the interactive login
   * the human already made rather than a credential runcastle asks them for
   * (Codex — decision 4): no id, no AFK-key probe, nothing to paste on the card.
   */
  ids: { binary: string; auth: string; afkKey?: string }
  /** Argv that makes the CLI report its interactive login state (exit 0 = logged in). */
  authStatusArgs: string[]
  /** The command a human runs to log in interactively. */
  loginCommand: string
  /** Argv for that login command, as an embedded terminal runs it. */
  loginArgs: string[]
  /**
   * Env var carrying an unattended credential AFK burns can authenticate with.
   * For Claude Code that IS the AFK credential, minted and pasted in. For Codex
   * it is only the hand-set override an operator can still put in
   * `~/.runcastle/.env` to bill an API key instead of their ChatGPT login
   * (decision 3) — which is why Codex has no `ids.afkKey` to probe for.
   */
  afkKey: string
  /** What that credential is called, for messages ("OAuth token" / "API key"). */
  afkNoun: string
  /** How to obtain the AFK credential. */
  afkFix: string
  /** How to install the CLI. */
  installFix: string
  /** `RUNCASTLE_*_BIN` escape hatch for a PATH the server cannot see. */
  binOverrideEnv: string
  /**
   * Where the CLI stores the credentials its interactive login writes — the file
   * a session or a burn actually borrows, and therefore what decides whether
   * this runtime is logged in (Codex: `codexAuthFile`, the same path
   * `codexLoggedIn` tests). Absent when there is no file to check (Claude Code
   * keeps credentials in the macOS Keychain on darwin, so a missing file there
   * would be a false negative) — those runtimes are judged by the CLI instead.
   */
  authFile?: (env: Record<string, string | undefined>) => string
}

export const RUNTIME_SPECS: Record<AgentRuntime, RuntimeSpec> = {
  'claude-code': {
    runtime: 'claude-code',
    label: 'Claude Code',
    bin: 'claude',
    ids: { binary: 'claude', auth: 'claude-auth', afkKey: 'afk-token' },
    authStatusArgs: ['auth', 'status'],
    loginCommand: 'claude auth login',
    loginArgs: ['auth', 'login'],
    afkKey: 'CLAUDE_CODE_OAUTH_TOKEN',
    afkNoun: 'OAuth token',
    afkFix: 'Run `claude setup-token` on this host and put CLAUDE_CODE_OAUTH_TOKEN in ~/.runcastle/.env',
    installFix:
      'Install Claude Code: curl -fsSL https://claude.ai/install.sh | bash (Windows: irm https://claude.ai/install.ps1 | iex)',
    binOverrideEnv: 'RUNCASTLE_CLAUDE_BIN',
  },
  codex: {
    runtime: 'codex',
    label: 'Codex',
    bin: 'codex',
    // No `ids.afkKey`, so the doctor reports `binary` + `auth` only: a Codex burn
    // borrows the `auth.json` that `codex login` wrote (decision 4), so the login
    // IS the AFK credential and there is nothing separate to probe for.
    ids: { binary: 'codex', auth: 'codex-auth' },
    authStatusArgs: ['login', 'status'],
    loginCommand: 'codex login',
    loginArgs: ['login'],
    afkKey: 'CODEX_API_KEY',
    afkNoun: 'API key',
    afkFix:
      'Set CODEX_API_KEY in ~/.runcastle/.env to bill an OpenAI API key instead of your ChatGPT login',
    installFix: 'Install Codex: npm install -g @openai/codex (or: brew install codex)',
    binOverrideEnv: 'RUNCASTLE_CODEX_BIN',
    authFile: codexAuthFile,
  },
}

/** A CLI old enough not to know the status subcommand — not a logged-out human. */
function statusUnsupported(out: ExecOutcome): boolean {
  return /unknown command|unrecognized subcommand|unexpected argument|invalid subcommand/i.test(
    `${out.stderr} ${out.stdout}`,
  )
}

/** The runtime's CLI is resolvable — the floor for both talk sessions and burns. */
async function runtimeBinaryProbe(
  spec: RuntimeSpec,
  exec: ExecFn,
  severity: ProbeSeverity,
): Promise<ProbeResult> {
  const base = await versionProbe(
    exec,
    spec.ids.binary,
    `${spec.label} CLI`,
    spec.bin,
    spec.installFix,
  )
  return { ...base, severity, runtime: spec.runtime, check: 'binary' }
}

/**
 * The runtime's interactive login — which, for a runtime whose burns borrow it,
 * is also what an unattended burn runs on.
 *
 * Where the runtime keeps that login in a file ({@link RuntimeSpec.authFile}),
 * the file decides: it is the artifact a session and a burn actually copy, so
 * testing for it is the only verdict that can never disagree with what a burn
 * does. `<bin> <status args>` still runs, but only to enrich the detail line —
 * a CLI that says "logged out" over a file that is there, or "logged in" over a
 * file that is not, is a discrepancy worth reporting, not the answer.
 *
 * Where there is no file to check (Claude Code keeps credentials in the macOS
 * Keychain on darwin), the CLI itself is the only place that knows, so its exit
 * code decides — and a CLI too old to answer reports ok rather than inventing a
 * failure out of a question we could not ask.
 */
async function runtimeAuthProbe(
  spec: RuntimeSpec,
  exec: ExecFn,
  env: Record<string, string | undefined>,
  fileExists: (path: string) => boolean,
  severity: ProbeSeverity,
): Promise<ProbeResult> {
  const base = {
    id: spec.ids.auth,
    label: `${spec.label} login (interactive sessions)`,
    tier: 2 as const,
    severity,
    runtime: spec.runtime,
    check: 'auth' as const,
  }
  const loggedOut = {
    ...base,
    status: 'unset' as const,
    detail: `${spec.bin} reports no interactive login — sessions on ${spec.label} would stop to log in`,
    fix: `Run \`${spec.loginCommand}\` (the wizard and Settings can run it for you).`,
  }

  const out = await exec(spec.bin, spec.authStatusArgs)
  if (!out.ok) {
    return {
      ...base,
      status: 'missing',
      detail: `${spec.bin} not found on PATH — nothing to ask about its login`,
      fix: spec.installFix,
    }
  }

  const authFile = spec.authFile?.(env)
  if (authFile) {
    const present = fileExists(authFile)
    const statusCommand = `${spec.bin} ${spec.authStatusArgs.join(' ')}`
    // What the CLI said, as a coda to the file's verdict — spelled out when the
    // two disagree, since that mismatch is what this probe exists to stop hiding.
    let coda: string
    if (statusUnsupported(out)) {
      coda = ` — this ${spec.bin} cannot report login state`
    } else if ((out.code === 0) === present) {
      coda = ` — \`${statusCommand}\` agrees`
    } else if (present) {
      coda = `, but \`${statusCommand}\` reports logged out — burns borrow the file, so this host counts as signed in`
    } else {
      coda = `, but \`${statusCommand}\` reports a login — a burn borrows the file, and it is not there`
    }
    return present
      ? { ...base, status: 'ok', detail: `credentials found at ${authFile}${coda}` }
      : { ...loggedOut, detail: `no credentials at ${authFile}${coda}` }
  }

  if (out.code === 0) return { ...base, status: 'ok', detail: `${spec.bin} reports a login` }
  if (!statusUnsupported(out)) return loggedOut
  return {
    ...base,
    status: 'ok',
    detail: `this ${spec.bin} cannot report login state — it prompts at launch`,
  }
}

/**
 * The runtime's unattended credential — presence only (validity needs a live
 * call, which {@link applyTokenCheck} adds where one is wanted). Read from the
 * injected env; both callers — the CLI and the tRPC doctor query the AFK card
 * reads — merge `~/.runcastle/.env` in before calling.
 *
 * `undefined` for a runtime with no `ids.afkKey`: its burns borrow the human's
 * own login, which the `auth` check already reports, so a second row asking for
 * a credential they need not have would be the setup step this feature removed.
 *
 * Several lines for the key stay `ok` with a note: burns use the last line, so
 * the file may be fine, but only a human can tell which line they meant.
 */
export function runtimeAfkKeyProbe(
  spec: RuntimeSpec,
  env: Record<string, string | undefined>,
  severity: ProbeSeverity = 'error',
  lines: Record<string, number> = {},
): ProbeResult | undefined {
  const id = spec.ids.afkKey
  if (!id) return undefined
  const base = {
    id,
    label: `${spec.label} AFK ${spec.afkNoun} (${spec.afkKey})`,
    tier: 2 as const,
    severity,
    runtime: spec.runtime,
    check: 'afk-key' as const,
  }
  const value = env[spec.afkKey]
  if (value && value.trim().length > 0) {
    const count = lines[spec.afkKey] ?? 0
    const duplicates =
      count > 1 ? ` — ~/.runcastle/.env has ${count} ${spec.afkKey} lines, and burns use the last` : ''
    return { ...base, status: 'ok', detail: `${spec.afkNoun} present${duplicates}` }
  }
  return {
    ...base,
    status: 'unset',
    detail: `no ${spec.afkKey} — AFK burns on ${spec.label} cannot authenticate`,
    fix: spec.afkFix,
  }
}

/**
 * Fold a live token test into the presence row. Only a clear refusal fails the
 * row: a test that could not reach the service says nothing about the token.
 */
async function applyTokenCheck(
  row: ProbeResult,
  spec: RuntimeSpec,
  token: string,
  check: (token: string) => Promise<TokenCheck>,
): Promise<ProbeResult> {
  const result = await check(token)
  switch (result.verdict) {
    case 'ok':
      return { ...row, detail: `${row.detail} — a live call authenticated` }
    case 'unreachable':
      return { ...row, detail: `${row.detail} — not tested: ${result.why}` }
    case 'rejected':
      return {
        ...row,
        status: 'unhealthy',
        detail: `${row.detail} — the service rejected it: ${result.why}`,
        fix: spec.afkFix,
      }
  }
}

/**
 * Every readiness check one runtime answers — `binary` and `auth` always, plus
 * `afk-key` for a runtime that has an unattended credential of its own.
 * `severity` is the whole point: the same missing `codex` binary is an error for
 * an operator who configured a GPT model and mere context for one who never did
 * (decision 6).
 */
export async function runtimeProbes(
  spec: RuntimeSpec,
  deps: {
    exec: ExecFn
    env: Record<string, string | undefined>
    fileExists?: (path: string) => boolean
    severity: ProbeSeverity
    afkKeyLines?: Record<string, number>
    checkToken?: (token: string) => Promise<TokenCheck>
  },
): Promise<ProbeResult[]> {
  const fileExists = deps.fileExists ?? existsSync
  const presence = runtimeAfkKeyProbe(spec, deps.env, deps.severity, deps.afkKeyLines)
  const token = deps.env[spec.afkKey]?.trim()
  const afkKeyProbe =
    presence?.status === 'ok' && token && deps.checkToken
      ? await applyTokenCheck(presence, spec, token, deps.checkToken)
      : presence
  return [
    await runtimeBinaryProbe(spec, deps.exec, deps.severity),
    await runtimeAuthProbe(spec, deps.exec, deps.env, fileExists, deps.severity),
    ...(afkKeyProbe ? [afkKeyProbe] : []),
  ]
}

/**
 * The installed CLI is new enough for the pinned ACP adapter that drives it
 * (ADR-0015). `undefined` — no row — when there is nothing to compare: the CLI
 * is missing (the binary row already says so, as today), prints no readable
 * version, or the adapter's floor could not be read.
 */
export async function adapterVersionProbe(
  spec: RuntimeSpec,
  exec: ExecFn,
  minimum: string | null,
  severity: ProbeSeverity,
): Promise<ProbeResult | undefined> {
  if (!minimum) return undefined
  const out = await exec(spec.bin, ['--version'])
  const installed = out.ok && out.code === 0 ? parseAgentCliVersion(out.stdout) : null
  if (!installed) return undefined
  const base = {
    id: `${spec.ids.binary}-adapter-version`,
    label: `${spec.label} version (chat adapter)`,
    tier: 2 as const,
    severity,
    runtime: spec.runtime,
  }
  if (isOlderVersion(installed, minimum)) {
    return {
      ...base,
      status: 'stale',
      detail: `${spec.label} ${installed} is older than ${minimum}, which the chat adapter needs`,
      fix: `Update ${spec.label} to ${minimum} or newer (${spec.runtime === 'codex' ? '`npm i -g @openai/codex@latest`' : '`claude update`'}, or however you installed it).`,
    }
  }
  return { ...base, status: 'ok', detail: `${spec.label} ${installed} (the chat adapter needs ${minimum} or newer)` }
}

/**
 * Git identity — checked separately from the binary because it fails LATE (mid
 * `commitDocs`, after a session did its work) if unset. `git config --get`
 * resolves local > global > system and exits 1 only when unset everywhere.
 */
export async function gitIdentityProbe(exec: ExecFn, cwd?: string): Promise<ProbeResult> {
  const args = (key: string) => (cwd ? ['-C', cwd, 'config', '--get', key] : ['config', '--get', key])
  const email = await exec('git', args('user.email'))
  const name = await exec('git', args('user.name'))
  const emailSet = email.ok && email.code === 0 && email.stdout.trim().length > 0
  const nameSet = name.ok && name.code === 0 && name.stdout.trim().length > 0
  if (emailSet && nameSet) {
    return {
      id: 'git-identity',
      label: 'Git identity (user.name / user.email)',
      tier: 2,
      status: 'ok',
      severity: 'error',
      detail: `${name.stdout.trim()} <${email.stdout.trim()}>`,
    }
  }
  const missing = [!nameSet && 'user.name', !emailSet && 'user.email'].filter(Boolean).join(' and ')
  return {
    id: 'git-identity',
    label: 'Git identity (user.name / user.email)',
    tier: 2,
    status: 'unset',
    severity: 'error',
    detail: `${missing} not set — commits (docs, merges) would fail`,
    fix: `git config --global user.name "Your Name" && git config --global user.email "you@example.com"`,
  }
}

/**
 * Container runtime — the one probe where presence and health genuinely diverge.
 * Tries docker first, then podman; classifies the exact failure so the fix line
 * is honest: not-installed vs. daemon-dead (docker) vs. machine-stopped (podman).
 *
 * `only` narrows it to one runtime — the burn preflight's, which must judge the
 * runtime the burn is configured for, not whichever one happens to be healthy.
 */
export async function containerRuntimeProbe(
  exec: ExecFn,
  only?: 'docker' | 'podman',
): Promise<ProbeResult> {
  const id = 'container-runtime'
  const label = 'Container runtime (Docker / Podman)'
  const docker = only === 'podman' ? undefined : await exec('docker', ['--version'])
  if (docker?.ok && docker.code === 0) {
    const info = await exec('docker', ['info'])
    if (info.ok && info.code === 0) {
      return {
        id,
        label,
        tier: 2,
        status: 'ok',
        severity: 'error',
        detail: docker.stdout.trim() || 'docker healthy',
      }
    }
    return {
      id,
      label,
      tier: 2,
      status: 'daemon-dead',
      severity: 'error',
      detail: 'docker CLI is installed but the daemon is not responding',
      fix: 'Start Docker Desktop (or `sudo systemctl start docker` on Linux), then re-run doctor.',
    }
  }

  const podman = only === 'docker' ? undefined : await exec('podman', ['--version'])
  if (podman?.ok && podman.code === 0) {
    const info = await exec('podman', ['info'])
    if (info.ok && info.code === 0) {
      return {
        id,
        label,
        tier: 2,
        status: 'ok',
        severity: 'error',
        detail: podman.stdout.trim() || 'podman healthy',
      }
    }
    return {
      id,
      label,
      tier: 2,
      status: 'machine-stopped',
      severity: 'error',
      detail: 'podman CLI is installed but its machine is not initialized/started',
      fix: 'Run: podman machine init && podman machine start',
    }
  }

  return {
    id,
    label,
    tier: 2,
    status: 'missing',
    severity: 'error',
    detail: only ? `${only} not found on PATH` : 'neither docker nor podman found on PATH',
    fix: 'Install Docker Desktop or Podman (see docs/research/PREREQS-NOTES.md §4). Not needed for interactive-only use.',
  }
}

/** Everything the image probe reads, all of it injected. */
export interface ImageProbeInput {
  exec: ExecFn
  /**
   * The image a burn resolves to from the env var, the config file and the
   * stock default — i.e. every layer BELOW the project column, which
   * {@link ProjectImageEnv.stored} supplies and which wins over it. The probe
   * does not order those two itself: it hands both to `resolveSandboxImage`,
   * the one place that rule is written down.
   */
  imageName: string
  /** The stock burner Dockerfile the stock image must still match. */
  burnerDockerfile: string
  dockerfileHash: (path: string) => string | null
  /** The host's agent CLI versions every image's CLIs must match; null is never drift. */
  hostVersions: HostAgentVersions
  project?: ProjectImageEnv
  /** See {@link DoctorEnv.knownProjectIds}; absent means "do not classify". */
  knownProjectIds?: readonly string[]
  /** Who burns run as; resolved for the runtime found when omitted. */
  burnUser?: BurnUser
}

/**
 * Sandcastle image — the first AFK burn fails on a fresh machine by construction
 * until it's built. Runcastle builds it for the user, from the "Enable AFK
 * burns" card: the stock image `sandcastle:runcastle` from the template it
 * ships, and — when the repo carries `.runcastle/sandbox/Dockerfile` — the
 * project image `sandcastle:runcastle-<projectId>` chained on top of it, which
 * is how a repo whose toolchain is not JavaScript gets a JDK or a Go compiler
 * into its burns. AFK burns are opt-in, so a missing image is a warning, not a
 * block. Reuses whichever runtime is present.
 *
 * Staleness is a *content* question and nothing else (decision 4): every image
 * runcastle builds carries the sha256 of its Dockerfile as a label, and this
 * compares that label against the file on disk. The mtime-vs-`Created`
 * comparison it replaces was wrong in both directions, because BuildKit layer
 * caching keeps the old `Created` on a freshly rebuilt image. An image with no
 * label at all reads as stale — it predates the label, so its content is
 * unvouched for.
 *
 * A project image is stale when *either* hash mismatches, and the detail names
 * which layer: a runcastle upgrade changes the stock Dockerfile, and every
 * project image `FROM` it would otherwise stay "fresh" by its own label forever.
 *
 * The other half of freshness is the agent CLIs (sandbox-agent-clis-track-the-
 * host-version, decision 9): an image whose recorded Claude Code or Codex
 * version is not the host's is stale the same way, judged by `imageFreshness` —
 * the one verdict the Rebuild plan also uses. A custom image carries no labels,
 * so it is probed instead and its drift is only a warning (decision 3).
 */
export async function sandcastleImageProbe(input: ImageProbeInput): Promise<ProbeResult> {
  const { exec, burnerDockerfile, dockerfileHash, hostVersions, project } = input
  const runtime = await presentRuntime(exec)
  if (!runtime) {
    return {
      ...IMAGE_ROW,
      status: 'missing',
      severity: 'error',
      detail: 'no container runtime available to inspect the image',
      fix: 'Install a container runtime (Docker or Podman) first, then build the image from the Enable AFK burns card in the app.',
    }
  }

  const burnUser = input.burnUser ?? resolveBurnUser(runtime)
  const projectHash = project ? dockerfileHash(projectDockerfilePath(project.repoPath)) : null

  // Decision 5: a tag the human typed outranks the Dockerfile, because
  // `adoptProjectImage` will not overwrite it — so a burn keeps resolving to the
  // typed tag however current the project image is. Reporting on the project tag
  // below would describe an image no burn runs in; the custom row answers for
  // the image that is actually used, and leaves the Build button disarmed.
  const handTyped = project ? unmanagedImage(project) : null

  // Decision 8: runcastle wrote the column when it built the image, so it takes
  // it back when the Dockerfile that justified it is gone. Resolution falls
  // straight back to the global image or the stock default; the orphaned local
  // tag is the user's to prune. A hand-typed value is never touched.
  let stored = project?.stored ?? null
  if (project && stored !== null && projectHash === null && project.overwritable) {
    project.clearStored()
    stored = null
  }

  const unchecked = uncheckedRuntimes(hostVersions)

  const stock = await inspectBuiltImage(exec, runtime, DEFAULT_SANDBOX_IMAGE)
  const stockVerdict = imageFreshness({
    image: stock,
    expectedHash: dockerfileHash(burnerDockerfile),
    host: hostVersions,
    burnUser,
  })

  if (project && handTyped === null && projectHash !== null) {
    const tag = projectImageTag(project.id)
    const image = await inspectBuiltImage(exec, runtime, tag)
    // "Not built yet" covers both halves of the same gap: no image under the
    // tag, or an image runcastle has not adopted as this project's — which is
    // what a burn would actually have to resolve to. One Build does both.
    if (!image.present || (project.overwritable && stored !== tag)) {
      return {
        ...IMAGE_ROW,
        status: 'not-built-yet',
        severity: 'error',
        detail: image.present
          ? `${tag} is built but is not this project's image yet`
          : `.runcastle/sandbox/Dockerfile is not built — ${tag} does not exist`,
        fix: 'Open Settings → Workers (Build image) — runcastle builds .runcastle/sandbox/Dockerfile for you.',
      }
    }
    // The project image's own labels, inherited through `FROM`, record the CLIs
    // its containers actually run — so its CLI drift is judged here, not on the base.
    const own = imageFreshness({ image, expectedHash: projectHash, host: hostVersions, burnUser })
    if (!own.fresh) {
      return staleImage(describeStale(tag, own.reasons, '.runcastle/sandbox/Dockerfile'), unchecked)
    }
    if (!stockVerdict.fresh) {
      const layer = stockVerdict.reasons.find((r) => r.kind === 'hash' || r.kind === 'missing')
      return staleImage(
        layer === undefined
          ? `${tag} is built on a stale ${DEFAULT_SANDBOX_IMAGE} — ${describeStale(DEFAULT_SANDBOX_IMAGE, stockVerdict.reasons, 'the burner Dockerfile')}`
          : `${tag} is built on ${DEFAULT_SANDBOX_IMAGE}, which ${layer.kind === 'missing' ? 'is not built' : 'no longer matches the burner Dockerfile'}`,
        unchecked,
      )
    }
    return {
      ...IMAGE_ROW,
      status: 'ok',
      severity: 'error',
      detail: `${tag} built from .runcastle/sandbox/Dockerfile${unchecked}${imageUserNote(image, burnUser)}`,
    }
  }

  // The project column beats every layer below it — but that ordering is stated
  // once, in `resolveSandboxImage`, and this probe is one of its five consumers
  // rather than a second copy of the rule. `input.imageName` is already those
  // lower layers folded into one value, so it stands in for the config here.
  const imageName = resolveSandboxImage({ sandboxImage: input.imageName }, { sandboxImage: stored })
  if (imageName !== DEFAULT_SANDBOX_IMAGE) {
    // Decision 5: nothing here is runcastle's to build, so the row reports who
    // owns the image rather than offering a Rebuild that would build the stock
    // template under someone's custom tag — the clobber this feature exists to
    // remove. Staleness is unanswerable (there is no Dockerfile runcastle knows
    // about), but presence is not, and an image a burn will not find is still
    // worth saying out loud: an operator's own image is `info` when it is there
    // and an `error` when it is not.
    const custom = await inspectBuiltImage(exec, runtime, imageName)
    const wrongUid = imageUidMismatch(custom.user, burnUser)
    // An older runcastle wrote built project images into the machine-wide
    // config, so a `sandcastle:runcastle-<name>` reaching here from below the
    // project column is residue rather than anyone's custom image. Only the
    // wording changes: the value stays, because a human may have typed it.
    const legacy =
      input.knownProjectIds === undefined || stored !== null
        ? null
        : legacyGlobalImage(imageName, input.knownProjectIds)
    const clauses = [
      legacy === null
        ? `${imageName} is a custom image, managed outside runcastle`
        : `${imageName} is a machine-wide image left over from an older runcastle`,
      // A Dockerfile this tag outranks does nothing until the setting is
      // cleared, and a row that stayed silent about it would leave the human
      // waiting on a build that is never coming.
      ...(projectHash === null ? [] : [`and outranks this repo's .runcastle/sandbox/Dockerfile`]),
      ...(custom.present ? [] : ['and is not built locally']),
      ...(wrongUid === undefined
        ? []
        : [imageUidMismatchMessage(imageName, wrongUid, burnUser.uid, false)]),
      // Decision 3: no labels to read, so the one probe that starts a container.
      // Drift is a warning only — the status stays `custom`, which is what keeps
      // the Rebuild button disarmed, since runcastle did not build this image.
      ...(custom.present && legacy === null
        ? await customImageDrift(exec, runtime, imageName, hostVersions)
        : []),
    ]
    return {
      ...IMAGE_ROW,
      status: 'custom',
      // Residue nobody chose is always worth acting on, however buildable the
      // tag happens to be on this machine. So is an image a burn would refuse.
      severity: custom.present && legacy === null && wrongUid === undefined ? 'info' : 'error',
      detail: clauses.join(' — '),
      fix:
        legacy === null
          ? unmanagedImageReason(imageName, projectHash !== null)
          : legacyGlobalImageReason(legacy),
    }
  }
  if (!stock.present) {
    return {
      ...IMAGE_ROW,
      status: 'missing',
      severity: 'error',
      detail: `image ${imageName} not found locally`,
      fix: 'Start runcastle and click "Build image" on the Enable AFK burns card — it builds this for you (one click). Only needed for AFK/sandboxed burns.',
    }
  }
  if (!stockVerdict.fresh) {
    return staleImage(
      describeStale(imageName, stockVerdict.reasons, 'the burner Dockerfile'),
      unchecked,
    )
  }
  return {
    ...IMAGE_ROW,
    status: 'ok',
    severity: 'error',
    detail: `${imageName} present${unchecked}${imageUserNote(stock, burnUser)}`,
  }
}

/**
 * The clauses a fresh image's row carries about its group. Neither stops a burn:
 * burns pass the right group themselves, so the image's own is cosmetic
 * (decision 6). They exist so a group picked up from `sg docker`, or a lookup
 * that fell back to the process, is never silent (decision 2).
 */
function imageUserNote(image: BuiltImage, burnUser: BurnUser): string {
  const imageGid = parseImageUser(image.user)?.gid
  const built =
    imageGid === undefined || imageGid === burnUser.gid
      ? ''
      : ` (built with GID ${imageGid}, burns here use ${burnUser.gid}: harmless, and the next Rebuild corrects it)`
  const fallback =
    burnUser.gidSource === 'process'
      ? ` (could not read this account's primary group, so burns use the process's GID ${burnUser.gid})`
      : ''
  return `${built}${fallback}`
}

/**
 * Who burns run as, and the one user they cannot run as: Claude Code refuses to
 * run unattended as root (decision 9). Its severity follows the runtime it is
 * about, so a Codex-only setup is told without failing the report.
 */
export function burnUserProbe(
  burnUser: BurnUser,
  root: boolean,
  severity: ProbeSeverity,
): ProbeResult {
  const base = { id: 'burn-user', label: 'Burn user', tier: 2 as const, severity }
  if (root) {
    return {
      ...base,
      status: 'unhealthy',
      detail: ROOT_BURN_REFUSED,
      fix: 'Create a normal user, add it to the docker group, and run runcastle as that user.',
    }
  }
  return { ...base, status: 'ok', detail: `burns run as ${burnUserSpec(burnUser)}` }
}

/**
 * Rootless Docker and `userns-remap` are named, not supported (decision 12): the
 * host's UID means something else inside the container there, so `--user` no
 * longer matches the bind-mounted worktree. `undefined` — no row — on an
 * ordinary engine, or one that will not say. Burns are not blocked, in case a
 * setup happens to work, which is why this is not part of the runtime probe the
 * burn preflight reads.
 */
export async function dockerUserMappingProbe(exec: ExecFn): Promise<ProbeResult | undefined> {
  const out = await exec('docker', ['info', '--format', '{{json .SecurityOptions}}'])
  if (!(out.ok && out.code === 0)) return undefined
  const mode = /name=rootless/.test(out.stdout)
    ? 'rootless Docker'
    : /name=userns/.test(out.stdout)
      ? 'Docker with userns-remap'
      : undefined
  if (!mode) return undefined
  return {
    id: 'docker-user-mapping',
    label: 'Docker user mapping',
    tier: 2,
    status: 'unhealthy',
    severity: 'error',
    detail: `this engine runs ${mode}, which burns do not support: host user IDs mean something else inside its containers`,
    fix: 'Use rootful Docker with no userns-remap, or Podman.',
  }
}

/**
 * Can the burn user write to its cache volume? The doctor used to pass while
 * burns could not (decision 7). The check is the one every run makes, so the two
 * cannot disagree. A bad volume is `info`, not an error: the next burn replaces
 * it, so there is nothing for a human to do. `undefined` — no row — when the
 * image is not there to test from, which the image row already reports.
 */
export async function burnCacheVolumeProbe(
  exec: ExecFn,
  scope: BurnCacheScope,
  burnUser: BurnUser,
): Promise<ProbeResult | undefined> {
  const base = {
    id: 'burn-cache-volume',
    label: 'Burn cache volume',
    tier: 2 as const,
    severity: 'info' as const,
  }
  const image = await exec('docker', ['image', 'inspect', scope.imageName])
  if (!(image.ok && image.code === 0)) return undefined

  const projectIds = await burnCacheProjectIds(exec, scope)
  const none = { ...base, status: 'ok' as const, detail: 'no cache volume yet: the first burn creates it' }
  if (projectIds.length === 0) return none

  const bad: string[] = []
  const unknown: string[] = []
  for (const projectId of projectIds) {
    const volume = burnCacheVolumeName(projectId)
    const access = await checkBurnCacheAccess({
      engine: 'docker',
      imageName: scope.imageName,
      projectId,
      exec,
      burnUser,
    })
    if (access.state === 'unwritable') {
      bad.push(`${volume}: ${access.path} is owned by ${access.owner}`)
    }
    if (access.state === 'unknown') unknown.push(`${volume}: ${access.reason}`)
  }
  const user = burnUserSpec(burnUser)
  if (bad.length > 0) {
    return {
      ...base,
      status: 'stale',
      detail: `burn user ${user} cannot write to ${bad.join('; ')}. The next burn replaces it.`,
    }
  }
  if (unknown.length > 0) {
    return { ...base, status: 'unhealthy', detail: `could not test ${unknown.join('; ')}` }
  }
  return { ...base, status: 'ok', detail: `burn user ${user} can write to its cache` }
}

/** The project ids behind the volumes a scope covers, existing volumes only. */
async function burnCacheProjectIds(exec: ExecFn, scope: BurnCacheScope): Promise<string[]> {
  if (scope.projectId !== undefined) {
    const state = await inspectBurnCacheVolume(exec, 'docker', scope.projectId)
    return state === 'missing' ? [] : [scope.projectId]
  }
  const out = await exec('docker', [
    'volume',
    'ls',
    '--filter',
    `label=${BURN_CACHE_VOLUME_LABEL}`,
    '--format',
    '{{.Name}}',
  ])
  if (!(out.ok && out.code === 0)) return []
  const prefix = burnCacheVolumeName('')
  return out.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((name) => name.startsWith(prefix))
    .map((name) => name.slice(prefix.length))
}

/**
 * A stale image's reasons as one detail line. A hash mismatch keeps the row's
 * long-standing wording, naming the Dockerfile the image was built from; CLI
 * drift names the runtime and both versions.
 */
function describeStale(tag: string, reasons: FreshnessReason[], dockerfile: string): string {
  return reasons
    .map((reason) =>
      reason.kind === 'hash'
        ? `${tag} no longer matches ${dockerfile}`
        : describeFreshnessReason(tag, reason),
    )
    .join('; ')
}

/**
 * The trailing clause a managed image's row carries for every agent runtime the
 * freshness verdict could not judge (decision 4): with no host version there is
 * nothing to drift from, so `imageFreshness` skips that runtime rather than
 * calling the image stale over it. Saying so is the difference between an image
 * whose CLIs were checked and one where half the question was never asked — a
 * silent row reads as the former. Empty when the host has every CLI, so a fully
 * checked row keeps its long-standing wording.
 */
function uncheckedRuntimes(host: HostAgentVersions): string {
  const skipped = AGENT_RUNTIMES.filter((r) => host[r] === null).map((r) => RUNTIME_SPECS[r].label)
  return skipped.length === 0 ? '' : ` (${skipped.join(' and ')} not on host — not checked)`
}

/**
 * Ask an unmanaged image which agent CLIs it carries, in one container, and
 * name each that differs from the host's. A CLI missing from either side is
 * not drift: the host has nothing to match (decision 4), and an image without
 * a CLI is the burn preflight's to refuse. A probe that fails says nothing.
 */
async function customImageDrift(
  exec: ExecFn,
  runtime: Runtime,
  image: string,
  host: HostAgentVersions,
): Promise<string[]> {
  const script = AGENT_RUNTIMES.map((r) => `${RUNTIME_SPECS[r].bin} --version 2>/dev/null`).join(
    '; echo ---; ',
  )
  const out = await exec(runtime, ['run', '--rm', '--entrypoint', 'sh', image, '-c', script])
  if (!out.ok) return []
  const sections = out.stdout.split('---')
  return AGENT_RUNTIMES.flatMap((r, i) => {
    const inImage = parseAgentCliVersion(sections[i] ?? '')
    const onHost = host[r]
    if (inImage === null || onHost === null || inImage === onHost) return []
    const { label } = RUNTIME_SPECS[r]
    return [
      `its ${label} ${inImage} differs from the host's ${onHost} — rebuild it with the tool that built it`,
    ]
  })
}

/** The image row's identity, shared by every verdict it can reach. */
const IMAGE_ROW = { id: 'sandcastle-image', label: 'Sandcastle container image', tier: 2 } as const

/** The first container runtime whose CLI answers, or null when neither does. */
async function presentRuntime(exec: ExecFn): Promise<Runtime | null> {
  for (const runtime of ['docker', 'podman'] as const) {
    const present = await exec(runtime, ['--version'])
    if (present.ok && present.code === 0) return runtime
  }
  return null
}

/**
 * A stale verdict over whichever layer drifted. The fix names the settings page
 * the web turns into a link (flow-redesign-settings decision 9), so it lands the
 * reader on the image row rather than telling them to go looking for it — and
 * one Rebuild heals the whole chain, whichever layer this is about. `unchecked`
 * is {@link uncheckedRuntimes}, kept after the call to action so what to do
 * comes before what was skipped.
 */
function staleImage(detail: string, unchecked = ''): ProbeResult {
  return {
    ...IMAGE_ROW,
    status: 'stale',
    severity: 'error',
    detail: `${detail} — rebuild${unchecked}`,
    fix: 'Open Settings → Workers (Rebuild image).',
  }
}

/** The container-runtime verdicts where the CLI is present but nothing answers behind it. */
const RUNTIME_DOWN: ReadonlySet<ProbeStatus> = new Set(['daemon-dead', 'machine-stopped'])

/** The image row while the runtime is down: unknown, and the runtime row says why. */
function imageUncheckable(): ProbeResult {
  return {
    ...IMAGE_ROW,
    status: 'unhealthy',
    severity: 'error',
    detail: 'cannot inspect the image while the container runtime is not responding',
    fix: 'Get the container runtime answering first (see the container runtime row), then re-run doctor.',
  }
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

/**
 * Run every probe and fold the per-check verdicts into an overall report. Both
 * runtimes are always probed; only the ones in `env.runtimes` — those some
 * configured model resolves to — can fail the report (decision 6).
 */
export async function runDoctor(env: DoctorEnv): Promise<DoctorReport> {
  const { exec } = env
  const processEnv = env.env ?? process.env
  const imageName = env.imageName ?? DEFAULT_SANDBOX_IMAGE
  const burnerDockerfile = env.burnerDockerfile ?? burnerDockerfilePath()
  const dockerfileHash = env.dockerfileHash ?? hashDockerfile
  const required = new Set(env.runtimes ?? [DEFAULT_RUNTIME])

  const results: ProbeResult[] = [
    await bunProbe(exec),
    await nodeProbe(exec),
    await gitProbe(exec),
  ]
  for (const runtime of AGENT_RUNTIMES) {
    results.push(
      ...(await runtimeProbes(RUNTIME_SPECS[runtime], {
        exec,
        env: processEnv,
        ...(env.fileExists ? { fileExists: env.fileExists } : {}),
        severity: required.has(runtime) ? 'error' : 'info',
        ...(env.afkKeyLines ? { afkKeyLines: env.afkKeyLines } : {}),
        ...(env.checkToken && runtime === 'claude-code' ? { checkToken: env.checkToken } : {}),
      })),
    )
    const versionRow = await adapterVersionProbe(
      RUNTIME_SPECS[runtime],
      exec,
      (env.minimumCliVersion ?? minimumCliVersion)(runtime),
      required.has(runtime) ? 'error' : 'info',
    )
    if (versionRow) results.push(versionRow)
  }
  const containerRuntime = await containerRuntimeProbe(exec)
  results.push(
    await gitIdentityProbe(exec, env.cwd),
    containerRuntime,
    // A runtime whose CLI is there but whose daemon is not answering cannot say
    // anything about an image — and a wedged one never answers at all, so every
    // `image inspect` would sit out the full exec timeout on top of `info`'s.
    RUNTIME_DOWN.has(containerRuntime.status)
      ? imageUncheckable()
      : await sandcastleImageProbe({
          exec,
          imageName,
          burnerDockerfile,
          dockerfileHash,
          // Presence is the injected exec's to decide, as for every other probe
          // here: the production exec resolves the binary the same way anyway.
          hostVersions: (await resolveHostAgentVersions(exec, () => true)).versions,
          ...(env.projectImage ? { project: env.projectImage } : {}),
          ...(env.knownProjectIds ? { knownProjectIds: env.knownProjectIds } : {}),
          ...(env.burnUser ? { burnUser: env.burnUser } : {}),
        }),
  )

  const engineUp = containerRuntime.status === 'ok'
  const engine = engineUp ? await presentRuntime(exec) : null
  const burnUser = env.burnUser ?? resolveBurnUser(engine ?? 'docker')
  results.push(
    burnUserProbe(
      burnUser,
      env.runningAsRoot ?? runningAsRoot(),
      required.has('claude-code') ? 'error' : 'info',
    ),
  )
  if (engine === 'docker') {
    const mapping = await dockerUserMappingProbe(exec)
    if (mapping) results.push(mapping)
    const volume = env.burnCache ? await burnCacheVolumeProbe(exec, env.burnCache, burnUser) : undefined
    if (volume) results.push(volume)
  }

  const counts = (r: ProbeResult) => r.severity === 'error'
  return {
    results,
    ok: results.filter(counts).every((r) => r.status === 'ok'),
    tier1Ok: results.filter((r) => counts(r) && r.tier === 1).every((r) => r.status === 'ok'),
  }
}

export type DoctorMode = 'gate' | 'diagnostic'

/**
 * Exit code for a report under a given mode.
 * - `gate` (pre-boot): hard-stop on Tier-1 failures only; Tier-2 are warnings.
 * - `diagnostic` (run by hand): reflect overall health — any non-ok check fails.
 */
export function exitCodeFor(report: DoctorReport, mode: DoctorMode): number {
  if (mode === 'gate') return report.tier1Ok ? 0 : 1
  return report.ok ? 0 : 1
}
