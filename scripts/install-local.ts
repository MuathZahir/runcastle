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
 *   bun run install:local --no-install     # skip `bun install` in the snapshot
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
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { $ } from 'bun'
import { prodDataDir } from '../packages/core/src/paths.ts'
import {
  INSTALL_LOCAL_USAGE,
  InstallLocalUsageError,
  localBuildVersion,
  parseInstallLocalArgs,
} from '../packages/server/src/dev/install-local.ts'
import type { InstallLocalOptions } from '../packages/server/src/dev/install-local.ts'

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..')
const SERVER_PORT = 4512

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

/** Build, verify, and pack the snapshot; returns the tarball's path. */
async function buildTarball(snapshot: string, outDir: string, version: string, opts: InstallLocalOptions): Promise<string> {
  const serverDir = join(snapshot, 'packages', 'server')
  const buildDir = join(serverDir, 'build')

  if (opts.install) {
    step('Installing dependencies in the snapshot')
    await run($`bun install --frozen-lockfile`.cwd(snapshot))
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
  if (!opts.skipRunningCheck && (await isListening(SERVER_PORT))) {
    die(`runcastle is running on :${SERVER_PORT} — stop it (close its window / Ctrl+C), then re-run`)
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
    // later `bun add -g <anything>` — so it must outlive the temp dir. Only the
    // newest is kept; the version (sha included) names each one uniquely.
    const keepDir = join(prodDataDir(), 'local-builds')
    rmSync(keepDir, { recursive: true, force: true })
    mkdirSync(keepDir, { recursive: true })
    tarball = join(keepDir, `runcastle-${version}.tgz`)
    copyFileSync(packed, tarball)

    // A bare absolute path ending in .tgz is a tarball to bun on every OS
    // (drive-letter paths included), so no npm fallback is needed.
    step('Installing globally')
    await run($`bun add -g ${tarball}`)
  } finally {
    step('Removing the snapshot')
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
