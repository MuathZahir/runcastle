/**
 * One-command release cut for the `runcastle` npm package.
 *
 * Automates the mechanical, repeatable core of docs/RELEASE.md:
 *
 *   preconditions -> tests -> build (version stamped) -> verify -> publish
 *   -> git tag + GitHub release
 *
 * Usage:
 *   bun run release 1.0.0            # full cut, pauses to confirm before publish
 *   bun run release 1.0.0 --yes      # skip the interactive confirmation
 *
 * Deliberately NOT automated (see RELEASE.md), because they are one-time,
 * one-way, or require a human:
 *   - deprecating the old "castellan" 0.1.0/0.2.0 (one-time, already done)
 *   - `gh repo edit --visibility public` (irreversible, outward-facing)
 *   - the clean-machine install verification (Step 6)
 *
 * Bun-only: uses `Bun.$`. Registry ops (publish/whoami/view) go through the npm
 * CLI to match the runbook — the `never npm` rule is about package management,
 * not registry auth, and `npm deprecate`/`npm view` have no Bun equivalent.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { $ } from 'bun'

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..')
const SERVER_DIR = join(REPO_ROOT, 'packages', 'server')
const BUILD_DIR = join(SERVER_DIR, 'build')

/** npm account that owns the `runcastle` name (RELEASE.md preconditions). */
const OWNER = 'muathzaher'
/** Files the tarball must contain — smoke-check that the build vendored assets. */
const REQUIRED_BUILD_FILES = [
  'index.js',
  'bin/runcastle.js',
  'pty-host.cjs',
  join('web', 'index.html'),
]

function die(message: string): never {
  console.error(`\n✗ ${message}`)
  process.exit(1)
}

function step(message: string): void {
  console.log(`\n▶ ${message}`)
}

/** Run a command, streaming its output; abort the release on non-zero exit. */
async function run(
  strings: TemplateStringsArray,
  ...values: unknown[]
): Promise<void> {
  // Rebuild the tagged-template call so callers keep Bun.$'s auto-escaping.
  const result = await $(strings, ...(values as never[])).nothrow()
  if (result.exitCode !== 0) die(`command failed (exit ${result.exitCode})`)
}

/** Capture a command's trimmed stdout; returns null if it exits non-zero. */
async function capture(
  strings: TemplateStringsArray,
  ...values: unknown[]
): Promise<string | null> {
  const result = await $(strings, ...(values as never[]))
    .quiet()
    .nothrow()
  if (result.exitCode !== 0) return null
  return result.stdout.toString().trim()
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const skipConfirm = args.includes('--yes') || args.includes('-y')
  const version = args.find((a) => !a.startsWith('-'))

  if (!version) {
    die('usage: bun run release <version> [--yes]  (e.g. bun run release 1.0.0)')
  }
  if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) {
    die(`"${version}" is not a semver version (expected e.g. 1.0.0 or 1.2.0-rc.1)`)
  }
  const tag = `v${version}`

  console.log(`\nReleasing runcastle ${version}\n${'─'.repeat(32)}`)

  // ── Preconditions ─────────────────────────────────────────────────────────
  step('Checking preconditions')

  const dirty = await capture`git -C ${REPO_ROOT} status --porcelain`
  if (dirty === null) die('not a git repository (or git failed)')
  if (dirty !== '') {
    die('working tree is dirty — commit or stash before releasing:\n' + dirty)
  }
  console.log('  ✓ clean working tree')

  const whoami = await capture`npm whoami`
  if (whoami === null) die('not logged in to npm — run `npm login` first')
  if (whoami !== OWNER) {
    console.warn(`  ⚠ npm user is "${whoami}", expected "${OWNER}" — double-check before confirming`)
  } else {
    console.log(`  ✓ npm user: ${whoami}`)
  }

  const existingTag = await capture`git -C ${REPO_ROOT} tag --list ${tag}`
  if (existingTag) die(`git tag ${tag} already exists — bump the version or delete the tag`)
  console.log(`  ✓ tag ${tag} is free`)

  // ── Tests ─────────────────────────────────────────────────────────────────
  step('Running test suite (bun run test)')
  {
    const result = await $`bun run test`.cwd(REPO_ROOT).nothrow()
    if (result.exitCode !== 0) die('tests failed — release aborted')
  }

  // ── Build ─────────────────────────────────────────────────────────────────
  step(`Building publishable package (version ${version})`)
  // RUNCASTLE_RELEASE_VERSION must reach the bun child as a real env var — the
  // build reads it from process.env (RELEASE.md Step 1 gotcha). $.env sets it
  // for this child only, so no shell-specific `$env:` dance and no leak.
  {
    const result = await $`bun run build:pkg`
      .cwd(SERVER_DIR)
      .env({ ...process.env, RUNCASTLE_RELEASE_VERSION: version })
      .nothrow()
    if (result.exitCode !== 0) die(`build failed (exit ${result.exitCode})`)
  }

  // ── Verify ────────────────────────────────────────────────────────────────
  step('Verifying build output')
  const manifestPath = join(BUILD_DIR, 'package.json')
  if (!existsSync(manifestPath)) die(`build produced no manifest at ${manifestPath}`)
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    name?: string
    version?: string
    private?: boolean
  }
  if (manifest.name !== 'runcastle') die(`built manifest name is "${manifest.name}", expected "runcastle"`)
  if (manifest.version !== version) {
    die(`built manifest version is "${manifest.version}", expected "${version}" — RUNCASTLE_RELEASE_VERSION did not take`)
  }
  if (manifest.private) die('built manifest is marked private — it would refuse to publish')
  for (const file of REQUIRED_BUILD_FILES) {
    if (!existsSync(join(BUILD_DIR, file))) die(`build is missing ${file} — asset vendoring failed`)
  }
  console.log(`  ✓ runcastle@${version}, public, all required assets present`)

  // ── Confirm ───────────────────────────────────────────────────────────────
  if (!skipConfirm) {
    if (!process.stdin.isTTY) {
      die('publish needs confirmation but stdin is not a TTY — re-run with --yes')
    }
    const answer = prompt(`\nPublish runcastle@${version} to npm and cut ${tag}? (y/N)`)
    if (answer?.trim().toLowerCase() !== 'y') die('aborted before publish — nothing was released')
  }

  // ── Publish ───────────────────────────────────────────────────────────────
  // Pack from build/ (its manifest has no prepack, so it can't reset the
  // version); publish the same dir. Never publish from packages/server.
  step(`Publishing runcastle@${version}`)
  {
    const result = await $`npm publish --access public`.cwd(BUILD_DIR).nothrow()
    if (result.exitCode !== 0) die(`npm publish failed (exit ${result.exitCode})`)
  }

  const published = await capture`npm view runcastle version`
  if (published !== version) {
    die(`published, but the registry reports "${published}" for runcastle — investigate before tagging`)
  }
  console.log(`  ✓ registry now serves runcastle@${published}`)

  // ── Tag + GitHub release ──────────────────────────────────────────────────
  step(`Tagging ${tag} and cutting the GitHub release`)
  await run`git -C ${REPO_ROOT} tag -a ${tag} -m ${`runcastle ${version}`}`
  await run`git -C ${REPO_ROOT} push origin ${tag}`
  await run`gh release create ${tag} --title ${`runcastle ${version}`} --notes ${`Release runcastle ${version}. Install: bun add -g runcastle`}`

  console.log(`\n✓ runcastle ${version} released.`)
  console.log('  Remaining manual steps (see docs/RELEASE.md): clean-machine verify (Step 6).')
}

main().catch((err) => {
  die(err instanceof Error ? err.message : String(err))
})
