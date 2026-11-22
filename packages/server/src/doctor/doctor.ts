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
  type AgentRuntime,
} from '@runcastle/core'
import { cliNeedsMissingNode, resolveTool } from '../util/resolve-executable'
import { isOlderVersion, minimumCliVersion } from './adapter-requirements'
import { parseAgentCliVersion } from '../services/agent-cli-versions'
import { codexAuthFile } from '../services/codex-auth'

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
  /** {@link ExecOptions.stopWhen} matched and the command was killed — `ok` stays true, `code` is null. */
  stopped?: boolean
}

export interface ExecOptions {
  /**
   * Read the output so far (stdout then stderr) as it arrives; once this
   * answers true the command is killed and resolves at once with what it said.
   * For a command that may print a question and then wait for an answer.
   */
  stopWhen?: (output: string) => boolean
}

/** The single injected seam: run a command, never throw. */
export type ExecFn = (command: string, args: string[], opts?: ExecOptions) => Promise<ExecOutcome>

/**
 * A probe's precise verdict. `ok` is healthy; everything else is a distinct,
 * separately-fixable failure — crucially `missing` (not installed) is never
 * conflated with an installed-but-broken state.
 */
export type ProbeStatus =
  | 'ok'
  | 'stale' // present, but older than the chat adapter needs
  | 'missing' // presence check failed — not installed / not on PATH
  | 'unhealthy' // present but a generic health probe failed
  | 'unset' // a value (git identity) is absent
  | 'api-key' // sessions will bill an Anthropic API key, not the subscription (info only)

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

export interface ProbeResult {
  id: string
  label: string
  /** Tier 1 = required to run runcastle at all; Tier 2 = only needed for workers and merges. */
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
  /**
   * The environment sessions inherit: the server's own, defaults to
   * `process.env`. Apart from {@link env}, which also holds runcastle's data-dir
   * `.env` — read by hand for workers, never handed to a session.
   */
  sessionEnv?: Record<string, string | undefined>
  /** Target platform for fix wording; defaults to the host. */
  platform?: NodeJS.Platform
  /** Directory to resolve git identity in (repo-local overrides honored). */
  cwd?: string
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
  /** Whether a CLI is a Node script on a machine with no Node; defaults to looking at the real file. */
  needsMissingNode?: (bin: string) => boolean
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

export const BUN_INSTALLER: StandaloneInstaller = {
  unix: 'curl -fsSL https://bun.sh/install | bash',
  windowsUrl: 'bun.sh/install.ps1',
}

/** The Anthropic credentials Claude Code bills ahead of the subscription login. */
export const ANTHROPIC_KEY_VARS = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'] as const

/**
 * Whether sessions will bill an Anthropic API key instead of the human's Claude
 * subscription (sessions-never-pick-up-a-project-s-api-key, decision 6). Since
 * the bin drops what Bun loaded from a start-folder `.env`, a key here was
 * exported in the shell — maybe on purpose, maybe for another tool. Information
 * only: it never fails the report, and a user billing a key on purpose is not
 * asked to change anything.
 */
export function apiKeyBillingProbe(sessionEnv: Record<string, string | undefined>): ProbeResult {
  const base = { id: 'api-key-billing', label: 'Session billing', tier: 1 as const, severity: 'info' as const }
  const key = ANTHROPIC_KEY_VARS.find((name) => (sessionEnv[name] ?? '') !== '')
  return key
    ? {
        ...base,
        status: 'api-key',
        // The advice sits in the detail too: the CLI prints no fix line on an `info` row.
        detail: `Sessions will bill the API key in ${key}, not your Claude subscription. Unset it in the shell that starts runcastle to use your subscription.`,
        fix: `Unset ${key} before starting runcastle to use your subscription.`,
      }
    : { ...base, status: 'ok', detail: 'Sessions use your Claude subscription.' }
}

async function bunProbe(exec: ExecFn): Promise<ProbeResult> {
  return versionProbe(
    exec,
    'bun',
    'Bun runtime',
    'bun',
    `Install Bun: ${BUN_INSTALLER.unix} (Windows: irm ${BUN_INSTALLER.windowsUrl} | iex)`,
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
 * that logs them in.
 *
 * One table so onboarding, the doctor, can be written once and
 * read per runtime instead of being spelled out per provider.
 */
export interface RuntimeSpec {
  runtime: AgentRuntime
  /** How the runtime is named to a human. */
  label: string
  /** The CLI binary. */
  bin: string
  /** Probe ids, pinned rather than derived so existing ids stay stable. */
  ids: { binary: string; auth: string }
  /** Argv that makes the CLI report its interactive login state (exit 0 = logged in). */
  authStatusArgs: string[]
  /** The command a human runs to log in interactively. */
  loginCommand: string
  /** Argv for that login command, as an embedded terminal runs it. */
  loginArgs: string[]
  /** How to install the CLI. */
  installFix: string
  /** `RUNCASTLE_*_BIN` escape hatch for a PATH the server cannot see. */
  binOverrideEnv: string
  /**
   * Where the CLI stores the credentials its interactive login writes — the file
   * a session or a round actually borrows, and therefore what decides whether
   * this runtime is logged in (Codex: `codexAuthFile`, the same path
   * `codexLoggedIn` tests). Absent when there is no file to check (Claude Code
   * keeps credentials in the macOS Keychain on darwin, so a missing file there
   * would be a false negative) — those runtimes are judged by the CLI instead.
   */
  authFile?: (env: Record<string, string | undefined>) => string
}

/**
 * A tool's own install script: a shell pipeline for Linux and macOS, and the
 * PowerShell script's address for Windows. The one home for these commands —
 * the fix lines quote them and `runcastle setup` runs them.
 */
export interface StandaloneInstaller {
  unix: string
  windowsUrl: string
}

/** How a Windows installer script is run from outside PowerShell. */
export function powershellInstall(url: string): string {
  return `powershell -ExecutionPolicy ByPass -c "irm ${url} | iex"`
}

/** The agent CLIs' standalone installers: native binaries, so neither needs Node. */
export const AGENT_INSTALLERS: Record<AgentRuntime, StandaloneInstaller> = {
  'claude-code': {
    unix: 'curl -fsSL https://claude.ai/install.sh | bash',
    windowsUrl: 'https://claude.ai/install.ps1',
  },
  codex: {
    unix: 'curl -fsSL https://chatgpt.com/codex/install.sh | sh',
    windowsUrl: 'https://chatgpt.com/codex/install.ps1',
  },
}

const CODEX_INSTALL = `${AGENT_INSTALLERS.codex.unix} (Windows: ${powershellInstall(AGENT_INSTALLERS.codex.windowsUrl)})`

export const RUNTIME_SPECS: Record<AgentRuntime, RuntimeSpec> = {
  'claude-code': {
    runtime: 'claude-code',
    label: 'Claude Code',
    bin: 'claude',
    ids: { binary: 'claude', auth: 'claude-auth' },
    authStatusArgs: ['auth', 'status'],
    loginCommand: 'claude auth login',
    loginArgs: ['auth', 'login'],
    installFix: `Install Claude Code: ${AGENT_INSTALLERS['claude-code'].unix} (Windows: irm ${AGENT_INSTALLERS['claude-code'].windowsUrl} | iex)`,
    binOverrideEnv: 'RUNCASTLE_CLAUDE_BIN',
  },
  codex: {
    runtime: 'codex',
    label: 'Codex',
    bin: 'codex',
    ids: { binary: 'codex', auth: 'codex-auth' },
    authStatusArgs: ['login', 'status'],
    loginCommand: 'codex login',
    loginArgs: ['login'],
    installFix: `Install Codex: ${CODEX_INSTALL}`,
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

/** The binary row's detail for a CLI installed as a Node script on a machine with no Node. */
export function noNodeDetail(bin: string): string {
  return `${bin} is a Node script (an npm or bun install), and this machine has no Node`
}

/** The runtime's CLI is resolvable — the floor for both talk sessions and burns. */
async function runtimeBinaryProbe(
  spec: RuntimeSpec,
  exec: ExecFn,
  severity: ProbeSeverity,
  needsMissingNode: (bin: string) => boolean,
): Promise<ProbeResult> {
  const base = await versionProbe(
    exec,
    spec.ids.binary,
    `${spec.label} CLI`,
    spec.bin,
    spec.installFix,
  )
  // Installed, but as a Node script on a machine with no Node. Saying "not found"
  // would send the person looking for a CLI that is plainly on their PATH.
  const noNode =
    base.status !== 'ok' && needsMissingNode(spec.bin)
      ? {
          detail: noNodeDetail(spec.bin),
          fix: `Reinstall it with its standalone installer, which needs no Node. ${spec.installFix}`,
        }
      : {}
  return { ...base, ...noNode, severity, runtime: spec.runtime, check: 'binary' }
}

/**
 * The runtime's interactive login — which, for a runtime whose workers borrow it,
 * is also what an unattended burn runs on.
 *
 * Where the runtime keeps that login in a file ({@link RuntimeSpec.authFile}),
 * the file decides: it is the artifact a session and a round actually copy, so
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
      coda = `, but \`${statusCommand}\` reports logged out — workers borrow the file, so this host counts as signed in`
    } else {
      coda = `, but \`${statusCommand}\` reports a login — a round borrows the file, and it is not there`
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
 * Every readiness check one runtime answers — `binary` and `auth` always, plus
 
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
    needsMissingNode?: (bin: string) => boolean
    severity: ProbeSeverity
  },
): Promise<ProbeResult[]> {
  const fileExists = deps.fileExists ?? existsSync
  const needsMissingNode =
    deps.needsMissingNode ?? ((bin: string) => cliNeedsMissingNode(resolveTool(bin)))
  return [
    await runtimeBinaryProbe(spec, deps.exec, deps.severity, needsMissingNode),
    await runtimeAuthProbe(spec, deps.exec, deps.env, fileExists, deps.severity),
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
      fix: `Update ${spec.label} to ${minimum} or newer (${spec.runtime === 'codex' ? `rerun its installer: ${CODEX_INSTALL}` : '`claude update`'}, or however you installed it).`,
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
  const required = new Set(env.runtimes ?? [DEFAULT_RUNTIME])

  const results: ProbeResult[] = [
    await bunProbe(exec),
    await gitProbe(exec),
  ]
  for (const runtime of AGENT_RUNTIMES) {
    results.push(
      ...(await runtimeProbes(RUNTIME_SPECS[runtime], {
        exec,
        env: processEnv,
        ...(env.fileExists ? { fileExists: env.fileExists } : {}),
        ...(env.needsMissingNode ? { needsMissingNode: env.needsMissingNode } : {}),
        severity: required.has(runtime) ? 'error' : 'info',
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
  results.push(apiKeyBillingProbe(env.sessionEnv ?? process.env))
  results.push(await gitIdentityProbe(exec, env.cwd))

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
