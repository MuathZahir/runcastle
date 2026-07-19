/**
 * Cut a runcastle release by tagging and pushing — CI does the rest.
 *
 * `bun run release <version>` validates the tree, then creates and pushes an
 * annotated `v<version>` tag. `.github/workflows/release.yml` fires on that tag
 * and does the heavy, credentialed work: typecheck + tests, build the
 * publishable package with the version stamped in, publish to npm via OIDC
 * trusted publishing (no token, with provenance), and cut the GitHub release.
 *
 * Usage:
 *   bun run release 1.0.4          # confirms before pushing the tag
 *   bun run release 1.0.4 --yes    # skip the confirmation
 *
 * The version lives only in the tag — nothing version-related is committed (the
 * build injects RUNCASTLE_RELEASE_VERSION from the tag name in CI).
 *
 * Not automated here or in CI (see docs/RELEASE.md): the one-time / one-way /
 * human steps — deprecating the old castellan versions, making the repo public,
 * and the clean-machine install verification. If OIDC ever needs bypassing, the
 * manual `npm publish` fallback is still documented in RELEASE.md.
 */
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { $ } from 'bun'

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..')
const REMOTE = 'origin'
const ACTIONS_URL = 'https://github.com/MuathZahir/runcastle/actions'

function die(message: string): never {
  console.error(`\n✗ ${message}`)
  process.exit(1)
}

function step(message: string): void {
  console.log(`\n▶ ${message}`)
}

/** Run a command, streaming its output; abort the release on non-zero exit. */
async function run(strings: TemplateStringsArray, ...values: unknown[]): Promise<void> {
  const result = await $(strings, ...(values as never[])).nothrow()
  if (result.exitCode !== 0) die(`command failed (exit ${result.exitCode})`)
}

/** Capture a command's trimmed stdout; returns null if it exits non-zero. */
async function capture(strings: TemplateStringsArray, ...values: unknown[]): Promise<string | null> {
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
    die('usage: bun run release <version> [--yes]  (e.g. bun run release 1.0.4)')
  }
  if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) {
    die(`"${version}" is not a semver version (expected e.g. 1.0.4 or 1.2.0-rc.1)`)
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

  // The tag IS the version, so it must be free both locally and on the remote —
  // a tag that already exists on origin means that version was already released.
  const localTag = await capture`git -C ${REPO_ROOT} tag --list ${tag}`
  if (localTag) die(`tag ${tag} already exists locally — bump the version or delete the tag`)
  const remoteTag = await capture`git -C ${REPO_ROOT} ls-remote --tags ${REMOTE} ${tag}`
  if (remoteTag === null) die(`could not reach ${REMOTE} — check your network / remote`)
  if (remoteTag !== '') die(`tag ${tag} already exists on ${REMOTE} — that version was already released`)
  console.log(`  ✓ tag ${tag} is free (local + ${REMOTE})`)

  // ── Confirm ───────────────────────────────────────────────────────────────
  if (!skipConfirm) {
    if (!process.stdin.isTTY) {
      die('push needs confirmation but stdin is not a TTY — re-run with --yes')
    }
    const answer = prompt(`\nTag and push ${tag}? CI will test, build, publish to npm, and cut the release. (y/N)`)
    if (answer?.trim().toLowerCase() !== 'y') die('aborted — no tag pushed, nothing released')
  }

  // ── Tag + push (pushing the tag carries its commit, so CI can build it) ─────
  step(`Tagging ${tag} and pushing to ${REMOTE}`)
  await run`git -C ${REPO_ROOT} tag -a ${tag} -m ${`runcastle ${version}`}`
  await run`git -C ${REPO_ROOT} push ${REMOTE} ${tag}`

  console.log(`\n✓ Pushed ${tag}. GitHub Actions is now testing, building, and publishing runcastle ${version}.`)
  console.log(`  Watch it: ${ACTIONS_URL}`)
  console.log('  If the run fails, delete the tag (git push --delete origin ' + tag + '), fix, and re-release.')
}

main().catch((err) => {
  die(err instanceof Error ? err.message : String(err))
})
