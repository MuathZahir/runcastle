import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_RUNTIME, RUNTIME_DEFAULT_MODELS, type AgentRuntime } from '@runcastle/core'
import { envPath, sandboxBuildDir } from '@runcastle/core/paths'
import type { ExecFn, ProbeResult } from '../doctor/doctor'
import { RUNTIME_SPECS, gitIdentityProbe } from '../doctor/doctor'
import type { AppCtx } from '../db/types'
import { InvalidInputError, NotFoundError } from '../errors'
import { ASSET_ENV, resolveAsset } from '../launcher/asset-paths'
import { updateSettings, type SettingsIO } from './settings'

/**
 * First-run / Enable-AFK setup service (issue #50). The wizard's one hard step
 * (git identity) and the AFK card's actions (capture each runtime's unattended
 * credential into the data-dir env file, tell the embedded terminals their exact
 * command, offer an OS-specific runtime install line, seed the model defaults
 * from whatever the operator authed) all live here as a small, injected core so
 * the host is never touched under test. Everything IO is a passed-in seam:
 * {@link ExecFn} for git, {@link AfkTokenIo} for the env file + live check.
 *
 * Nothing here names one provider: which binary, which env var and which words
 * describe a credential all come from the runtime's {@link RUNTIME_SPECS} entry.
 */

/**
 * The env var each runtime's AFK burns authenticate with. Codex's is an OpenAI
 * API key — verified against codex-rs, `CODEX_API_KEY` is its highest-precedence
 * auth path and the one designed for headless use. Interactive Codex sessions
 * are NOT this: they inherit the human's own `codex login` (decision 5).
 */
export const AFK_TOKEN_KEY = RUNTIME_SPECS['claude-code'].afkKey
export const CODEX_API_KEY = RUNTIME_SPECS.codex.afkKey

/**
 * The env var each runtime's unattended burns authenticate with, by runtime. One
 * map so the env-file reader, the burn env builder and the setup UI never
 * disagree about which key a runtime needs.
 */
export const RUNTIME_AUTH_KEY: Record<AgentRuntime, string> = {
  'claude-code': AFK_TOKEN_KEY,
  codex: CODEX_API_KEY,
}

/**
 * What to tell a human whose burn aborted for missing auth, per runtime. The
 * two runtimes end in different places: Claude Code burns on a long-lived token
 * captured into `~/.runcastle/.env`, while a Codex burn borrows the operator's
 * own ChatGPT login, so its only setup step is `codex login` and naming
 * `CODEX_API_KEY` here would send them to a credential they need not have.
 */
export const RUNTIME_AUTH_SETUP_HINT: Record<AgentRuntime, string> = {
  'claude-code': RUNTIME_SPECS['claude-code'].afkFix,
  codex: `Run \`${RUNTIME_SPECS.codex.loginCommand}\` on this host, then burn again`,
}

/** Result of a live token validity check (a real `claude` call, injected). */
export interface TokenValidity {
  valid: boolean
  detail: string
  /** Copy-pasteable next step; omitted when the check passed. */
  fix?: string
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

/** Injected IO for the AFK-credential capture: read/write the env file, verify live. */
export interface AfkTokenIo {
  read: () => string
  write: (content: string) => void
  verify: (token: string) => Promise<TokenValidity>
}

/**
 * Captures a runtime's AFK credential — Claude Code's `setup-token` OAuth token,
 * Codex's OpenAI API key — into the data-dir env file under that runtime's own
 * key, then runs a live validity check. Always persists a non-empty value (so a
 * transient verify failure doesn't lose it) and reports the check's verdict for
 * the UI. Rejects an empty value without touching disk.
 */
export async function saveAfkCredential(
  io: AfkTokenIo,
  rawValue: string,
  runtime: AgentRuntime = DEFAULT_RUNTIME,
): Promise<TokenValidity> {
  const spec = RUNTIME_SPECS[runtime]
  const value = rawValue.trim()
  if (value.length === 0) throw new InvalidInputError(`${spec.label} ${spec.afkNoun} cannot be empty`)
  if (/[\r\n]/.test(value)) {
    throw new InvalidInputError(`${spec.label} ${spec.afkNoun} cannot contain a newline`)
  }
  io.write(upsertEnvVar(io.read(), spec.afkKey, value))
  return io.verify(value)
}

/**
 * Which runtime's curated default pair onboarding seeds from (decision 7):
 * Claude Code when it is one of the ready ones — so an operator who authed both
 * keeps today's behaviour — and otherwise whichever single runtime they did
 * auth. `undefined` when nothing is ready, which is the case the wizard refuses
 * to complete in.
 */
export function seedRuntimeFor(ready: readonly AgentRuntime[]): AgentRuntime | undefined {
  return ready.includes(DEFAULT_RUNTIME) ? DEFAULT_RUNTIME : ready[0]
}

/** What onboarding wrote: the runtime it seeded from and the values that landed. */
export interface SeededModelDefaults {
  runtime: AgentRuntime
  /** Values actually written — a key the environment pins is left alone and absent. */
  model?: string
  smoke?: string
}

/**
 * Seed the global default and smoke models from an authed runtime's curated pair
 * when onboarding completes (decision 7). Hardcoded Claude defaults are dead
 * values for a Codex-only operator, so the wizard writes real ones once — as
 * ORDINARY settings mutations, events and all, not magic that keeps re-deciding.
 *
 * A value the environment pins (`RUNCASTLE_MODEL`) is left exactly as the
 * operator pinned it: that is already a decision, and onboarding does not get to
 * overrule it. Returns `null` when no runtime is ready to seed from.
 */
export function seedModelDefaults(
  ctx: AppCtx,
  ready: readonly AgentRuntime[],
  io: SettingsIO = {},
): SeededModelDefaults | null {
  const runtime = seedRuntimeFor(ready)
  if (!runtime) return null
  const pair = RUNTIME_DEFAULT_MODELS[runtime]
  const write = (key: string, value: string): string | undefined => {
    try {
      updateSettings(ctx, { key, value }, io)
      return value
    } catch (err) {
      if (err instanceof InvalidInputError) return undefined
      throw err
    }
  }
  const model = write('model', pair.flagship)
  const smoke = write('stepModels.smoke', pair.smoke)
  return {
    runtime,
    ...(model ? { model } : {}),
    ...(smoke ? { smoke } : {}),
  }
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

/** Container runtimes the embedded flows can drive. */
export type Runtime = 'docker' | 'podman'

/**
 * Picks the runtime the build-image / image-probe flows should drive. Honors the
 * configured preference when that binary is actually present; otherwise falls
 * back to whichever runtime is installed, and finally to the preference (docker)
 * so the emitted command is still something the user can act on.
 */
export async function resolveRuntime(exec: ExecFn, preferred: Runtime): Promise<Runtime> {
  const present = async (bin: Runtime): Promise<boolean> => {
    const out = await exec(bin, ['--version'])
    return out.ok && out.code === 0
  }
  if (await present(preferred)) return preferred
  const other: Runtime = preferred === 'docker' ? 'podman' : 'docker'
  if (await present(other)) return other
  return preferred
}

/**
 * Which embedded-terminal flow to launch. Each runtime contributes a login flow
 * (`claude auth login`, `codex login`) so onboarding can auth whichever
 * providers the operator has; `setup-token` is Claude Code's separate long-lived
 * AFK-token flow, which Codex has no analogue for (its AFK credential is an API
 * key pasted straight in).
 */
export type TerminalKind = 'setup-token' | 'build-image' | 'claude-login' | 'codex-login'

/** The login terminal kind for each runtime, as the wizard and settings offer it. */
export const LOGIN_TERMINAL_KIND: Record<AgentRuntime, TerminalKind> = {
  'claude-code': 'claude-login',
  codex: 'codex-login',
}

/** The exact command an embedded terminal runs, resolved for the active runtime. */
export interface TerminalSpec {
  cmd: string
  args: string[]
}

/**
 * Resolve the bundled sandcastle CLI's entrypoint (`@ai-hero/sandcastle`'s
 * `bin.sandcastle`, an absolute path) via module resolution, or null if it can't
 * be found. This is the fix for the "one-click build" failing on a real install:
 * sandcastle is a *transitive* dependency, so its bin is never on the user's PATH
 * in a `bun add -g runcastle` install — a bare `spawn('sandcastle')` ENOENTs, and
 * telling the user to type `sandcastle …` in their shell is a dead end. Resolving
 * the manifest works in both the contributor checkout and the published tarball
 * (sandcastle stays external, so it's a real installed dependency either way),
 * mirroring {@link resolvePtyRoot}'s `require.resolve('node-pty/package.json')`.
 */
export function resolveSandcastleBin(): string | null {
  try {
    // `@ai-hero/sandcastle` is ESM-only with an `exports` map that neither
    // carries a `require` condition nor exposes `./package.json`, so a CJS
    // `require.resolve('…/package.json')` throws ERR_PACKAGE_PATH_NOT_EXPORTED.
    // Resolve the exported main entry with the ESM resolver, then walk up to the
    // package root to read `bin.sandcastle` — robust to hoisting and to the
    // bundled published layout alike.
    const mainUrl = import.meta.resolve('@ai-hero/sandcastle')
    let dir = dirname(fileURLToPath(mainUrl))
    for (let hops = 0; hops < 6; hops++) {
      const manifestPath = join(dir, 'package.json')
      if (existsSync(manifestPath)) {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
          name?: string
          bin?: Record<string, string>
        }
        if (manifest.name === '@ai-hero/sandcastle' && manifest.bin?.sandcastle) {
          return join(dir, manifest.bin.sandcastle)
        }
      }
      const parent = dirname(dir)
      if (parent === dir) break
      dir = parent
    }
    return null
  } catch {
    return null
  }
}

/**
 * The command each embedded-terminal / streaming flow runs. `setup-token` drives
 * the interactive `claude setup-token` login; `claude-login`/`codex-login` drive
 * each runtime's own interactive sign-in, which is what talk sessions run on;
 * `build-image` builds the sandcastle image with whichever runtime is present
 * (its output streams into the card).
 *
 * `build-image` launches the resolved sandcastle CLI (`opts.sandcastleBin`) under
 * `node` — its shebang runtime and a Tier-1 prerequisite — rather than a bare
 * `sandcastle`, which is never on PATH in a global install (see
 * {@link resolveSandcastleBin}). `--image-name` is pinned explicitly so the built
 * tag matches `opts.imageName` exactly — the same name the doctor probe re-checks
 * after the build — instead of falling back to sandcastle's own cwd-derived
 * default, which would silently build an image the re-probe can never find.
 */
export function terminalSpec(
  kind: TerminalKind,
  opts: { runtime: Runtime; imageName: string; sandcastleBin?: string },
): TerminalSpec {
  if (kind === 'setup-token') return { cmd: 'claude', args: ['setup-token'] }
  for (const spec of Object.values(RUNTIME_SPECS)) {
    if (kind === LOGIN_TERMINAL_KIND[spec.runtime]) return { cmd: spec.bin, args: spec.loginArgs }
  }
  if (!opts.sandcastleBin) {
    throw new NotFoundError(
      'The bundled sandcastle CLI (@ai-hero/sandcastle) could not be located — reinstall runcastle.',
    )
  }
  return {
    cmd: 'node',
    args: [opts.sandcastleBin, opts.runtime, 'build-image', '--image-name', opts.imageName],
  }
}

// ---------------------------------------------------------------------------
// Build-context scaffold (issue #50 product decision) — runcastle owns the scaffold
// ---------------------------------------------------------------------------

/** Result of a `.sandcastle/` scaffold: whether it wrote, and where it lives. */
export interface ScaffoldResult {
  scaffolded: boolean
  dir: string
}

/**
 * The vetted burner-image template dir shipped as a package asset (real files
 * under `src/`, so they ride the published tarball). `RUNCASTLE_SANDCASTLE_TEMPLATE`
 * overrides it in a vendored install, exactly like the other #51 runtime assets.
 */
export function sandcastleTemplateDir(): string {
  return resolveAsset(
    ASSET_ENV.sandcastleTemplate,
    fileURLToPath(new URL('../assets/sandcastle', import.meta.url)),
  )
}

/**
 * Copy the template into `<targetDir>/.sandcastle/` so `sandcastle build-image`
 * (which unconditionally requires a `.sandcastle/` at its cwd) has a context to
 * build. **Create-only**: an existing `.sandcastle/` — which may be hand-tuned —
 * is never touched, mirroring the knowledge-docs scaffold precedent. Idempotent.
 */
export function scaffoldSandcastleConfig(templateDir: string, targetDir: string): ScaffoldResult {
  const dir = join(targetDir, '.sandcastle')
  if (existsSync(dir)) return { scaffolded: false, dir }
  mkdirSync(dir, { recursive: true })
  for (const name of readdirSync(templateDir)) {
    copyFileSync(join(templateDir, name), join(dir, name))
  }
  return { scaffolded: true, dir }
}

/**
 * Ensure the runcastle-owned build context exists and return its dir. The AFK
 * image is generic and app-global (not per-project — per-project deps install at
 * sandbox start), and the card is actionable during first-run before any project
 * exists, so the context lives under the data dir rather than in a project repo.
 * `build-image` runs here with the freshly-scaffolded `.sandcastle/`.
 */
export function prepareSandboxBuildContext(): string {
  const target = sandboxBuildDir()
  mkdirSync(target, { recursive: true })
  scaffoldSandcastleConfig(sandcastleTemplateDir(), target)
  return target
}

// ---------------------------------------------------------------------------
// Production IO wiring (thin; the testable core is above)
// ---------------------------------------------------------------------------

/**
 * A live AFK-credential validity check: run the runtime's CLI `--version` with
 * the credential saved. We can't fully round-trip the API here without a paid
 * call, so we treat a resolvable binary as valid presence; a missing one is
 * reported honestly.
 *
 * The two ways that probe can fail are kept *distinct*, because they have
 * opposite fixes and conflating them is what made this step a dead end for real
 * users: `ok:false` is a spawn failure (nothing to run — almost always a PATH the
 * server can't see, not a missing install), while a non-zero exit means the CLI
 * ran and rejected the call, which is a runtime problem, not a runcastle one.
 * Either way the credential is already on disk, so we say so — the user's next
 * move is never "paste it again".
 */
export function createCredentialVerifier(
  exec: ExecFn,
  runtime: AgentRuntime = DEFAULT_RUNTIME,
): (value: string) => Promise<TokenValidity> {
  const spec = RUNTIME_SPECS[runtime]
  return async (value) => {
    if (value.length < 8) {
      return {
        valid: false,
        detail: `${spec.afkNoun} looks malformed (too short) — saved to ~/.runcastle/.env anyway`,
        fix: `${spec.afkFix}. It starts with \`sk-\`.`,
      }
    }
    const out = await exec(spec.bin, ['--version'])
    if (!out.ok) {
      return {
        valid: false,
        detail:
          `${spec.afkNoun} saved to ~/.runcastle/.env, but runcastle could not launch \`${spec.bin}\` to verify it. ` +
          'That is a PATH problem in this server process, not a missing install — a terminal that finds ' +
          `\`${spec.bin}\` proves nothing about the PATH runcastle was started with.`,
        fix:
          `Quit runcastle and start it again from a terminal where \`${spec.bin} --version\` works. ` +
          `If it still fails, pin the path: set ${spec.binOverrideEnv} to the full path from ` +
          `\`where.exe ${spec.bin}\` (Windows) or \`which ${spec.bin}\` (macOS/Linux), then restart runcastle.`,
      }
    }
    if (out.code !== 0) {
      const why = (out.stderr.trim() || out.stdout.trim()).split('\n')[0] ?? ''
      return {
        valid: false,
        detail:
          `${spec.afkNoun} saved to ~/.runcastle/.env, but \`${spec.bin} --version\` exited ${out.code}` +
          `${why ? `: ${why}` : ' with no output'}.`,
        fix: `Run \`${spec.bin} --version\` yourself and fix what it reports — the ${spec.label} install is broken, not the ${spec.afkNoun}.`,
      }
    }
    return { valid: true, detail: `${spec.afkNoun} captured to ~/.runcastle/.env` }
  }
}

/** File-backed {@link AfkTokenIo} over the data-dir env file (`~/.runcastle/.env`). */
export function fileAfkTokenIo(exec: ExecFn, runtime: AgentRuntime = DEFAULT_RUNTIME): AfkTokenIo {
  const path = envPath()
  return {
    read: () => (existsSync(path) ? readFileSync(path, 'utf8') : ''),
    write: (content) => {
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, content, 'utf8')
    },
    verify: createCredentialVerifier(exec, runtime),
  }
}
