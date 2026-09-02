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

import { existsSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { AGENT_RUNTIMES, DEFAULT_RUNTIME, DEFAULT_SANDBOX_IMAGE, type AgentRuntime } from '@runcastle/core'
import { codexAuthFile } from '../services/codex-auth'

/** Outcome of one injected command. `ok:false` = spawn failed (ENOENT / not on PATH). */
export interface ExecOutcome {
  /** The process spawned and ran (regardless of exit code). `false` = not found. */
  ok: boolean
  /** Exit code, or `null` when the spawn itself failed. */
  code: number | null
  stdout: string
  stderr: string
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
  | 'stale' // present, but built before the current burner Dockerfile
  | 'missing' // presence check failed — not installed / not on PATH
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
  /** Sandcastle image tag to inspect (defaults to {@link DEFAULT_SANDBOX_IMAGE}). */
  imageName?: string
  /**
   * The runtimes some configured model resolves to (`configuredRuntimes` from
   * core). Every runtime is still probed; these are the ones whose gaps are
   * `error` rather than `info`. Defaults to the historical single runtime.
   */
  runtimes?: readonly AgentRuntime[]
  /** Injected file-existence check for the auth-file fallback; defaults to real fs. */
  fileExists?: (path: string) => boolean
  /** Injected mtime read for the bundled burner Dockerfile; defaults to real fs. */
  fileMtime?: (path: string) => Date
  /** Override for the bundled burner Dockerfile path (primarily for packaging tests). */
  burnerDockerfile?: string
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
    'Install Node.js 22+ — required for the PTY sidecar on Windows and node-pty builds on Linux.',
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
 * call). Read from the injected env; the CLI merges `~/.runcastle/.env` in
 * before calling.
 *
 * `undefined` for a runtime with no `ids.afkKey`: its burns borrow the human's
 * own login, which the `auth` check already reports, so a second row asking for
 * a credential they need not have would be the setup step this feature removed.
 */
export function runtimeAfkKeyProbe(
  spec: RuntimeSpec,
  env: Record<string, string | undefined>,
  severity: ProbeSeverity = 'error',
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
    return { ...base, status: 'ok', detail: `${spec.afkNoun} present` }
  }
  return {
    ...base,
    status: 'unset',
    detail: `no ${spec.afkKey} — AFK burns on ${spec.label} cannot authenticate`,
    fix: spec.afkFix,
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
  },
): Promise<ProbeResult[]> {
  const fileExists = deps.fileExists ?? existsSync
  const afkKeyProbe = runtimeAfkKeyProbe(spec, deps.env, deps.severity)
  return [
    await runtimeBinaryProbe(spec, deps.exec, deps.severity),
    await runtimeAuthProbe(spec, deps.exec, deps.env, fileExists, deps.severity),
    ...(afkKeyProbe ? [afkKeyProbe] : []),
  ]
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
 */
export async function containerRuntimeProbe(exec: ExecFn): Promise<ProbeResult> {
  const id = 'container-runtime'
  const label = 'Container runtime (Docker / Podman)'
  const docker = await exec('docker', ['--version'])
  if (docker.ok && docker.code === 0) {
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

  const podman = await exec('podman', ['--version'])
  if (podman.ok && podman.code === 0) {
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
    detail: 'neither docker nor podman found on PATH',
    fix: 'Install Docker Desktop or Podman (see docs/research/PREREQS-NOTES.md §4). Not needed for interactive-only use.',
  }
}

/**
 * Sandcastle image — the first AFK burn fails on a fresh machine by construction
 * until it's built. Runcastle builds it for the user: the in-app "Enable AFK
 * burns" card scaffolds the build context and runs the bundled sandcastle CLI
 * (the user never invokes `sandcastle` themselves — its bin isn't on PATH in a
 * global install). AFK burns are opt-in, so a missing image is a warning, not a
 * block. Reuses whichever runtime is present.
 */
export async function sandcastleImageProbe(
  exec: ExecFn,
  imageName: string,
  burnerDockerfile: string,
  fileMtime: (path: string) => Date,
): Promise<ProbeResult> {
  const id = 'sandcastle-image'
  const label = 'Sandcastle container image'
  for (const runtime of ['docker', 'podman'] as const) {
    const present = await exec(runtime, ['--version'])
    if (!(present.ok && present.code === 0)) continue
    const inspect = await exec(runtime, ['image', 'inspect', '--format', '{{.Created}}', imageName])
    if (inspect.ok && inspect.code === 0) {
      const created = new Date(inspect.stdout.trim())
      const dockerfileChanged = fileMtime(burnerDockerfile)
      if (dockerfileChanged > created) {
        const date = (value: Date) => value.toISOString().slice(0, 10)
        return {
          id,
          label,
          tier: 2,
          status: 'stale',
          severity: 'error',
          detail: `${imageName} built ${date(created)}, burner Dockerfile changed ${date(dockerfileChanged)} — rebuild`,
          // The wording names the settings page the web turns into a link
          // (flow-redesign-settings decision 9), so this fix lands the reader on
          // the image row rather than telling them to go looking for it.
          fix: 'Open Settings → Burns (Rebuild image).',
        }
      }
      return { id, label, tier: 2, status: 'ok', severity: 'error', detail: `${imageName} present` }
    }
    return {
      id,
      label,
      tier: 2,
      status: 'missing',
      severity: 'error',
      detail: `image ${imageName} not found locally`,
      fix: 'Start runcastle and click "Build image" on the Enable AFK burns card — it builds this for you (one click). Only needed for AFK/sandboxed burns.',
    }
  }
  return {
    id,
    label,
    tier: 2,
    status: 'missing',
    severity: 'error',
    detail: 'no container runtime available to inspect the image',
    fix: 'Install a container runtime (Docker or Podman) first, then build the image from the Enable AFK burns card in the app.',
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
  const burnerDockerfile =
    env.burnerDockerfile ??
    fileURLToPath(new URL('../assets/sandcastle/Dockerfile', import.meta.url))
  const fileMtime = env.fileMtime ?? ((path: string) => statSync(path).mtime)
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
      })),
    )
  }
  results.push(
    await gitIdentityProbe(exec, env.cwd),
    await containerRuntimeProbe(exec),
    await sandcastleImageProbe(exec, imageName, burnerDockerfile, fileMtime),
  )

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
