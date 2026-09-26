/**
 * Install a local build of runcastle as the global `runcastle` — no npm publish.
 *
 * The owner runs the *installed* runcastle as their orchestrator, never from
 * source, so a merged fix only reaches them through a release. This builds the
 * package from a local ref exactly as `.github/workflows/release.yml` does and
 * installs the tarball globally, so the fix is live after one command.
 *
 * Usage:
 *   bun run install:local                  # build + install local `main`
 *   bun run install:local my-branch        # any ref
 *   bun run install:local --check          # typecheck + test before packing
 *   bun run install:local --no-install     # reuse this checkout's node_modules
 *   bun run install:local --skip-running-check
 *
 * It builds from a detached worktree in the OS temp dir, never from this
 * checkout: this checkout is also runcastle's test-drive target, so it may be
 * parked on a feature branch or dirty. The worktree is always removed.
 *
 * The version is `<latest v* tag>-local.<short sha>` (e.g. `1.4.1-local.ebc6eaab`)
 * so `runcastle --version` and the doctor show it is a local build. Return to
 * the published version with `bun add -g runcastle@latest`.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
} from 'node:fs'
import { connect } from 'node:net'
import { homedir, tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { $ } from 'bun'
import { loadConfig } from '../packages/core/src/config-load.ts'
import { prodDataDir } from '../packages/core/src/paths.ts'
import {
  INSTALL_LOCAL_USAGE,
  InstallLocalUsageError,
  bunGlobalManifestPath,
  globalRuncastleSpec,
  localBuildVersion,
  parseInstallLocalArgs,
  snapshotLinkTarget,
} from '../packages/server/src/dev/install-local.ts'
import type { InstallLocalOptions } from '../packages/server/src/dev/install-local.ts'

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..')
const DEFAULT_SERVER_PORT = 4512

function die(message: string): never {
  console.error(`\n✗ ${message}`)
  process.exit(1)
}

function step(message: string): void {
  console.log(`\n▶ ${message}`)
}

/**
 * Run a command, streaming its output; throw on non-zero exit. Throws rather
 * than exiting (unlike release.ts) so the snapshot worktree's `finally` runs.
 */
async function run(command: $.ShellPromise): Promise<void> {
  const result = await command.nothrow()
  if (result.exitCode !== 0) throw new Error(`command failed (exit ${result.exitCode})`)
}

/** Capture a command's trimmed stdout; returns null if it exits non-zero. */
async function capture(strings: TemplateStringsArray, ...values: unknown[]): Promise<string | null> {
  const result = await $(strings, ...(values as never[]))
    .quiet()
    .nothrow()
  if (result.exitCode !== 0) return null
  return result.stdout.toString().trim()
}

/**
 * The port the installed runcastle listens on: its config's `serverPort`
 * (file + `RUNCASTLE_SERVER_PORT`), or the default if that config is unreadable.
 */
function serverPort(): number {
  try {
    return loadConfig().serverPort
  } catch {
    return DEFAULT_SERVER_PORT
  }
}

/** Whether anything accepts connections on the server's loopback port. */
function isListening(port: number): Promise<boolean> {
  return new Promise((done) => {
    const socket = connect({ host: '127.0.0.1', port })
    socket.once('connect', () => {
      socket.destroy()
      done(true)
    })
    socket.once('error', () => done(false))
  })
}

function readTextOrNull(path: string): string | null {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

/** Every `node_modules` a workspace install creates under `root`: the root's plus each workspace's. */
function dependencyDirs(root: string): string[] {
  const { workspaces = [] } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { workspaces?: string[] }
  const members = workspaces.flatMap((pattern) => {
    const parent = join(root, pattern.replace(/\/\*$/, ''))
    if (!existsSync(parent)) return []
    return readdirSync(parent, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => join(parent, d.name))
  })
  return [root, ...members].map((dir) => join(dir, 'node_modules'))
}

/** Link `target` at `path`: a directory as a junction (no privilege needed on Windows), a file as a copy. */
function linkEntry(target: string, path: string): void {
  if (statSync(target).isDirectory()) symlinkSync(target, path, 'junction')
  else copyFileSync(target, path)
}

/** Mirror one checkout `node_modules` (and its `@scope` dirs) into the snapshot, entry by entry. */
function mirrorDependencyDir(from: string, to: string, snapshot: string): void {
  mkdirSync(to, { recursive: true })
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    const source = join(from, entry.name)
    const dest = join(to, entry.name)
    if (entry.isSymbolicLink()) linkEntry(snapshotLinkTarget(realpathSync(source), REPO_ROOT, snapshot), dest)
    else if (entry.isDirectory() && entry.name.startsWith('@')) mirrorDependencyDir(source, dest, snapshot)
    else linkEntry(source, dest)
  }
}

/**
 * `--no-install`: the snapshot is a fresh worktree outside the repo with nothing
 * installed, so reuse this checkout's dependencies. Links are mirrored entry by
 * entry rather than linking whole `node_modules` dirs, so a workspace package
 * (`@runcastle/core`) still resolves to the snapshot's sources, not this
 * checkout's. Refuses when the lockfiles differ — the installed set would not be
 * the ref's.
 */
function linkCheckoutDependencies(snapshot: string): void {
  if (!existsSync(join(REPO_ROOT, 'node_modules'))) {
    throw new Error(`--no-install needs installed dependencies, but ${REPO_ROOT} has no node_modules — run bun install there, or drop --no-install`)
  }
  if (readFileSync(join(REPO_ROOT, 'bun.lock'), 'utf8') !== readFileSync(join(snapshot, 'bun.lock'), 'utf8')) {
    throw new Error(`--no-install: the ref's bun.lock differs from ${REPO_ROOT}'s, so its installed dependencies do not fit — drop --no-install`)
  }
  for (const from of dependencyDirs(REPO_ROOT)) {
    if (existsSync(from)) mirrorDependencyDir(from, join(snapshot, relative(REPO_ROOT, from)), snapshot)
  }
}

/** Build, verify, and pack the snapshot; returns the tarball's path. */
async function buildTarball(snapshot: string, outDir: string, version: string, opts: InstallLocalOptions): Promise<string> {
  const serverDir = join(snapshot, 'packages', 'server')
  const buildDir = join(serverDir, 'build')

  if (opts.install) {
    step('Installing dependencies in the snapshot')
    await run($`bun install --frozen-lockfile`.cwd(snapshot))
  } else {
    step('Linking this checkout’s installed dependencies into the snapshot')
    linkCheckoutDependencies(snapshot)
  }

  if (opts.check) {
    step('Typecheck + tests')
    await run($`bun run typecheck`.cwd(snapshot))
    await run($`bun run test`.cwd(snapshot))
  }

  // Same step + env as release.yml's "Build publishable package".
  step(`Building runcastle ${version}`)
  await run($`bun run build:pkg`.cwd(serverDir).env({ ...process.env, RUNCASTLE_RELEASE_VERSION: version }))

  // Same check as release.yml's "Verify built manifest".
  const manifest = (await Bun.file(join(buildDir, 'package.json')).json()) as { name?: string; version?: string }
  if (manifest.name !== 'runcastle') throw new Error(`built name is '${manifest.name}', expected 'runcastle'`)
  if (manifest.version !== version) throw new Error(`built version is '${manifest.version}', expected '${version}'`)
  console.log(`  ✓ built manifest is runcastle@${version}`)

  // Pack from build/, never packages/server: the source manifest's `prepack`
  // rebuilds without the version (docs/RELEASE.md, Step 1).
  step('Packing')
  await run($`bun pm pack --destination ${outDir}`.cwd(buildDir))
  const tarball = readdirSync(outDir).find((f) => f.endsWith('.tgz'))
  if (!tarball) throw new Error(`bun pm pack wrote no tarball to ${outDir}`)
  return join(outDir, tarball)
}

async function main(): Promise<void> {
  let opts: InstallLocalOptions
  try {
    opts = parseInstallLocalArgs(process.argv.slice(2))
  } catch (err) {
    if (err instanceof InstallLocalUsageError) die(`${err.message}\n${INSTALL_LOCAL_USAGE}`)
    throw err
  }

  // A running server holds the global install's files open on Windows, and
  // stopping it here would kill every live session's PTY — the human decides.
  if (!opts.skipRunningCheck) {
    const port = serverPort()
    if (await isListening(port)) {
      die(`runcastle is running on :${port} — stop it (close its window / Ctrl+C), then re-run`)
    }
  }

  const sha = await capture`git -C ${REPO_ROOT} rev-parse --verify ${`${opts.ref}^{commit}`}`
  if (!sha) die(`'${opts.ref}' is not a commit in ${REPO_ROOT}`)
  const shortSha = await capture`git -C ${REPO_ROOT} rev-parse --short ${sha}`
  const tags = (await capture`git -C ${REPO_ROOT} tag --list ${'v*'}`) ?? ''
  const version = localBuildVersion(tags.split('\n'), shortSha ?? sha.slice(0, 8))

  console.log(`\nInstalling runcastle ${version} from ${opts.ref} (${sha})\n${'─'.repeat(40)}`)

  const tmp = mkdtempSync(join(tmpdir(), 'runcastle-install-local-'))
  const snapshot = join(tmp, 'snapshot')
  let tarball: string
  try {
    step(`Snapshotting ${opts.ref} into ${snapshot}`)
    await run($`git -C ${REPO_ROOT} worktree add --detach ${snapshot} ${sha}`)
    const packed = await buildTarball(snapshot, tmp, version, opts)

    // The global manifest records the tarball's path, and bun re-reads it on a
    // later `bun add -g <anything>` — so it must outlive the temp dir. The
    // version (sha included) names each one uniquely; older ones are pruned only
    // once the new one is installed, so a failed install leaves the last intact.
    const keepDir = join(prodDataDir(), 'local-builds')
    mkdirSync(keepDir, { recursive: true })
    const kept = `runcastle-${version}.tgz`
    tarball = join(keepDir, kept)
    copyFileSync(packed, tarball)

    // bun cannot swap an existing global `runcastle` (registry or tarball) for
    // a tarball in place — DependencyLoop — so remove it first, and put the
    // previous spec back if the add fails so a bad build never leaves none.
    const previous = globalRuncastleSpec(readTextOrNull(bunGlobalManifestPath(process.env, homedir())))
    if (previous) {
      step(`Removing the current global runcastle (${previous})`)
      await run($`bun remove -g runcastle`)
    }

    // A bare absolute path ending in .tgz is a tarball to bun on every OS
    // (drive-letter paths included), so no npm fallback is needed.
    step('Installing globally')
    try {
      await run($`bun add -g ${tarball}`)
    } catch (err) {
      if (previous) {
        // A kept tarball is re-added by path (pruning only follows a success).
        const restore = previous.endsWith('.tgz') ? previous : `runcastle@${previous}`
        step(`Install failed — restoring ${restore}`)
        await $`bun add -g ${restore}`.nothrow()
      }
      throw err
    }
    for (const old of readdirSync(keepDir).filter((f) => f.endsWith('.tgz') && f !== kept)) {
      rmSync(join(keepDir, old), { force: true })
    }
  } finally {
    step('Removing the snapshot')
    // Drop node_modules first: rmSync unlinks --no-install's junctions without
    // following them into this checkout's dependencies.
    for (const dir of existsSync(snapshot) ? dependencyDirs(snapshot) : []) rmSync(dir, { recursive: true, force: true })
    await capture`git -C ${REPO_ROOT} worktree remove --force ${snapshot}`
    await capture`git -C ${REPO_ROOT} worktree prune`
    rmSync(tmp, { recursive: true, force: true })
  }

  console.log(`\n✓ Installed runcastle ${version}`)
  console.log(`  Built from ${opts.ref} @ ${sha}`)
  console.log(`  Tarball: ${tarball}`)
  console.log('  Back to the published version: bun add -g runcastle@latest')
  console.log('\n  start it with: runcastle')
}

main().catch((err) => {
  die(err instanceof Error ? err.message : String(err))
})
