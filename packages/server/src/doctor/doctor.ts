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
  | 'missing' // presence check failed — not installed / not on PATH
  | 'daemon-dead' // container CLI present, daemon not responding (docker)
  | 'machine-stopped' // container CLI present, VM not initialized/started (podman)
  | 'unhealthy' // present but a generic health probe failed
  | 'unset' // a value (git identity / AFK token) is absent

export interface ProbeResult {
  id: string
  label: string
  /** Tier 1 = required to run runcastle at all; Tier 2 = only for AFK/sandbox burns. */
  tier: 1 | 2
  status: ProbeStatus
  /** What was actually found — the observed evidence. */
  detail: string
  /** Copy-pasteable next step; omitted only when `status === 'ok'`. */
  fix?: string
}

export interface DoctorEnv {
  exec: ExecFn
  /** Environment map to read tokens from; defaults to `process.env`. */
  env?: Record<string, string | undefined>
  /** Target platform for fix wording; defaults to the host. */
  platform?: NodeJS.Platform
  /** Directory to resolve git identity in (repo-local overrides honored). */
  cwd?: string
  /** Sandcastle image tag to inspect (defaults to `sandcastle:runcastle`). */
  imageName?: string
}

export interface DoctorReport {
  results: ProbeResult[]
  /** Every probe is `ok`. */
  ok: boolean
  /** Every Tier-1 probe is `ok` (the pre-boot gate condition). */
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
    return { id, label, tier: 1, status: 'ok', detail: out.stdout.trim() || `${bin} present` }
  }
  return { id, label, tier: 1, status: 'missing', detail: `${bin} not found on PATH`, fix }
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

async function claudeProbe(exec: ExecFn): Promise<ProbeResult> {
  return versionProbe(
    exec,
    'claude',
    'Claude Code CLI',
    'claude',
    'Install Claude Code: curl -fsSL https://claude.ai/install.sh | bash (Windows: irm https://claude.ai/install.ps1 | iex)',
  )
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
      detail: `${name.stdout.trim()} <${email.stdout.trim()}>`,
    }
  }
  const missing = [!nameSet && 'user.name', !emailSet && 'user.email'].filter(Boolean).join(' and ')
  return {
    id: 'git-identity',
    label: 'Git identity (user.name / user.email)',
    tier: 2,
    status: 'unset',
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
      return { id, label, tier: 2, status: 'ok', detail: docker.stdout.trim() || 'docker healthy' }
    }
    return {
      id,
      label,
      tier: 2,
      status: 'daemon-dead',
      detail: 'docker CLI is installed but the daemon is not responding',
      fix: 'Start Docker Desktop (or `sudo systemctl start docker` on Linux), then re-run doctor.',
    }
  }

  const podman = await exec('podman', ['--version'])
  if (podman.ok && podman.code === 0) {
    const info = await exec('podman', ['info'])
    if (info.ok && info.code === 0) {
      return { id, label, tier: 2, status: 'ok', detail: podman.stdout.trim() || 'podman healthy' }
    }
    return {
      id,
      label,
      tier: 2,
      status: 'machine-stopped',
      detail: 'podman CLI is installed but its machine is not initialized/started',
      fix: 'Run: podman machine init && podman machine start',
    }
  }

  return {
    id,
    label,
    tier: 2,
    status: 'missing',
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
export async function sandcastleImageProbe(exec: ExecFn, imageName: string): Promise<ProbeResult> {
  const id = 'sandcastle-image'
  const label = 'Sandcastle container image'
  for (const runtime of ['docker', 'podman'] as const) {
    const present = await exec(runtime, ['--version'])
    if (!(present.ok && present.code === 0)) continue
    const inspect = await exec(runtime, ['image', 'inspect', imageName])
    if (inspect.ok && inspect.code === 0) {
      return { id, label, tier: 2, status: 'ok', detail: `${imageName} present` }
    }
    return {
      id,
      label,
      tier: 2,
      status: 'missing',
      detail: `image ${imageName} not found locally`,
      fix: 'Start runcastle and click "Build image" on the Enable AFK burns card — it builds this for you (one click). Only needed for AFK/sandboxed burns.',
    }
  }
  return {
    id,
    label,
    tier: 2,
    status: 'missing',
    detail: 'no container runtime available to inspect the image',
    fix: 'Install a container runtime (Docker or Podman) first, then build the image from the Enable AFK burns card in the app.',
  }
}

/**
 * AFK OAuth token — presence only (validity needs a live call). Read from the
 * injected env; the CLI merges `~/.runcastle/.env` in before calling.
 */
export function afkTokenProbe(env: Record<string, string | undefined>): ProbeResult {
  const id = 'afk-token'
  const label = 'AFK auth token (CLAUDE_CODE_OAUTH_TOKEN)'
  const token = env.CLAUDE_CODE_OAUTH_TOKEN
  if (token && token.trim().length > 0) {
    return { id, label, tier: 2, status: 'ok', detail: 'token present' }
  }
  return {
    id,
    label,
    tier: 2,
    status: 'unset',
    detail: 'no CLAUDE_CODE_OAUTH_TOKEN — AFK burns cannot authenticate',
    fix: 'Run `claude setup-token` on this host and put CLAUDE_CODE_OAUTH_TOKEN in ~/.runcastle/.env',
  }
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

/** Run every probe and fold the per-check verdicts into an overall report. */
export async function runDoctor(env: DoctorEnv): Promise<DoctorReport> {
  const { exec } = env
  const processEnv = env.env ?? process.env
  const imageName = env.imageName ?? 'sandcastle:runcastle'

  const results: ProbeResult[] = [
    await bunProbe(exec),
    await nodeProbe(exec),
    await gitProbe(exec),
    await claudeProbe(exec),
    await gitIdentityProbe(exec, env.cwd),
    await containerRuntimeProbe(exec),
    await sandcastleImageProbe(exec, imageName),
    afkTokenProbe(processEnv),
  ]

  return {
    results,
    ok: results.every((r) => r.status === 'ok'),
    tier1Ok: results.filter((r) => r.tier === 1).every((r) => r.status === 'ok'),
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
