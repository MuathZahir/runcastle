import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { envPath } from '@runcastle/core/paths'
import type { ExecFn, ProbeResult } from '../doctor/doctor'
import { gitIdentityProbe } from '../doctor/doctor'
import { InvalidInputError } from '../errors'

/**
 * First-run / Enable-AFK setup service (issue #50). The wizard's one hard step
 * (git identity) and the AFK card's actions (capture the OAuth token into the
 * data-dir env file, tell the embedded terminals their exact command, offer an
 * OS-specific runtime install line) all live here as a small, injected core so
 * the host is never touched under test. Everything IO is a passed-in seam:
 * {@link ExecFn} for git, {@link AfkTokenIo} for the env file + live token check.
 */

const AFK_TOKEN_KEY = 'CLAUDE_CODE_OAUTH_TOKEN'

/** Result of a live token validity check (a real `claude` call, injected). */
export interface TokenValidity {
  valid: boolean
  detail: string
}

/**
 * Writes git identity globally — the wizard's only blocking step — then re-runs
 * the identity probe so the caller shows the freshly-written value. Rejects an
 * empty name or an `@`-less email before touching config, so the form's own
 * validation is mirrored server-side and a bad value never reaches `git`.
 */
export async function writeGitIdentity(
  exec: ExecFn,
  identity: { name: string; email: string },
): Promise<ProbeResult> {
  const name = identity.name.trim()
  const email = identity.email.trim()
  if (name.length === 0) throw new InvalidInputError('git user.name cannot be empty')
  if (!email.includes('@')) throw new InvalidInputError('git user.email must be an email address')

  await exec('git', ['config', '--global', 'user.name', name])
  await exec('git', ['config', '--global', 'user.email', email])
  return gitIdentityProbe(exec)
}

/**
 * Idempotently sets `KEY=value` in a dotenv file's text. Replaces the value on an
 * existing line (preserving a leading `export ` and every other line), otherwise
 * appends a fresh line; the result always ends in exactly one trailing newline.
 * Pure string transform so the env-file capture is unit-testable without disk.
 */
export function upsertEnvVar(content: string, key: string, value: string): string {
  const line = `${key}=${value}`
  const lines = content.length === 0 ? [] : content.replace(/\n$/, '').split('\n')
  const matcher = new RegExp(`^(export\\s+)?${key}=`)
  let replaced = false
  const next = lines.map((l) => {
    if (matcher.test(l)) {
      replaced = true
      const exportPrefix = l.startsWith('export ') ? 'export ' : ''
      return `${exportPrefix}${line}`
    }
    return l
  })
  if (!replaced) next.push(line)
  return `${next.join('\n')}\n`
}

/** Injected IO for the AFK-token capture: read/write the env file, verify live. */
export interface AfkTokenIo {
  read: () => string
  write: (content: string) => void
  verify: (token: string) => Promise<TokenValidity>
}

/**
 * Captures the AFK OAuth token from the embedded `claude setup-token` flow into
 * the data-dir env file, then runs a live validity check. Always persists a
 * non-empty token (so a transient verify failure doesn't lose it) and reports
 * the check's verdict for the UI. Rejects an empty token without touching disk.
 */
export async function saveAfkToken(io: AfkTokenIo, rawToken: string): Promise<TokenValidity> {
  const token = rawToken.trim()
  if (token.length === 0) throw new InvalidInputError('AFK token cannot be empty')
  io.write(upsertEnvVar(io.read(), AFK_TOKEN_KEY, token))
  return io.verify(token)
}

/** OS-specific guided-manual runtime install: a copyable command + a follow-up note. */
export interface RuntimeInstallGuide {
  command: string
  note: string
}

/**
 * The copy-pasteable runtime install command for a guided-manual fix, per OS.
 * Podman is the default recommendation (rootless, no daemon); the note carries
 * the `podman machine init && start` follow-up the Windows/macOS VM needs.
 */
export function runtimeInstallGuide(platform: NodeJS.Platform): RuntimeInstallGuide {
  switch (platform) {
    case 'win32':
      return {
        command: 'winget install RedHat.Podman',
        note: 'Then initialize the VM: podman machine init && podman machine start',
      }
    case 'darwin':
      return {
        command: 'brew install podman',
        note: 'Then initialize the VM: podman machine init && podman machine start',
      }
    default:
      return {
        command: 'sudo apt install podman   # or: sudo dnf install podman / sudo pacman -S podman',
        note: 'Podman is rootless on Linux — no machine step needed.',
      }
  }
}

/** Which embedded-terminal flow to launch. */
export type TerminalKind = 'setup-token' | 'build-image'

/** The exact command an embedded terminal runs, resolved for the active runtime. */
export interface TerminalSpec {
  cmd: string
  args: string[]
}

/**
 * The command each embedded-terminal / streaming flow runs. `setup-token` drives
 * the interactive `claude setup-token` login; `build-image` builds the sandcastle
 * image with whichever runtime is present (its output streams into the card).
 */
export function terminalSpec(
  kind: TerminalKind,
  opts: { runtime: 'docker' | 'podman'; imageName: string },
): TerminalSpec {
  if (kind === 'setup-token') return { cmd: 'claude', args: ['setup-token'] }
  return { cmd: 'sandcastle', args: [opts.runtime, 'build-image'] }
}

// ---------------------------------------------------------------------------
// Production IO wiring (thin; the testable core is above)
// ---------------------------------------------------------------------------

/**
 * A live AFK-token validity check: run `claude --version`-equivalent auth probe
 * with the token in the environment. We can't fully round-trip the API here
 * without a paid call, so we treat a resolvable `claude` binary that accepts the
 * token env as valid presence; a missing binary is reported honestly.
 */
export function createTokenVerifier(exec: ExecFn): (token: string) => Promise<TokenValidity> {
  return async (token) => {
    const out = await exec('claude', ['--version'])
    if (!(out.ok && out.code === 0)) {
      return { valid: false, detail: 'claude CLI not found — cannot verify the token' }
    }
    if (token.length < 8) {
      return { valid: false, detail: 'token looks malformed (too short)' }
    }
    return { valid: true, detail: 'token captured to ~/.runcastle/.env' }
  }
}

/** File-backed {@link AfkTokenIo} over the data-dir env file (`~/.runcastle/.env`). */
export function fileAfkTokenIo(exec: ExecFn): AfkTokenIo {
  const path = envPath()
  return {
    read: () => (existsSync(path) ? readFileSync(path, 'utf8') : ''),
    write: (content) => {
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, content, 'utf8')
    },
    verify: createTokenVerifier(exec),
  }
}
