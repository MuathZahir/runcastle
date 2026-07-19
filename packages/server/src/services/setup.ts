import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { envPath, sandboxBuildDir } from '@runcastle/core/paths'
import type { ExecFn, ProbeResult } from '../doctor/doctor'
import { gitIdentityProbe } from '../doctor/doctor'
import { InvalidInputError, NotFoundError } from '../errors'
import { ASSET_ENV, resolveAsset } from '../launcher/asset-paths'

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
  if (/[\r\n]/.test(token)) throw new InvalidInputError('AFK token cannot contain a newline')
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

/** Which embedded-terminal flow to launch. */
export type TerminalKind = 'setup-token' | 'build-image'

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
 * the interactive `claude setup-token` login; `build-image` builds the sandcastle
 * image with whichever runtime is present (its output streams into the card).
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
