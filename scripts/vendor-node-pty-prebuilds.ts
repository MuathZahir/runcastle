/**
 * Regenerate the vendored node-pty linux prebuilds under `vendor/node-pty/`
 * (issue #39). node-pty 1.1.0 ships no `linux-*` prebuild, so `bun install` on
 * stock glibc Linux would compile from source (needs a C++ toolchain + node ≥22).
 * We instead vendor a prebuilt `pty.node` as a real committed file and copy it
 * into node-pty's `prebuilds/linux-<arch>/` from the root `postinstall`
 * (`scripts/postinstall-node-pty.ts`). See `vendor/node-pty/README.md`.
 *
 * Run (on a linux-x64 or linux-arm64 host):
 *   bun scripts/vendor-node-pty-prebuilds.ts
 *
 * It (1) resolves the installed node-pty, (2) builds `pty.node` for the host arch
 * via `node-gyp rebuild` if no compiled addon is present, and (3) copies it to
 * `vendor/node-pty/linux-<arch>/pty.node`. Run it once per arch and commit the
 * result; the postinstall then bridges whichever arch is running.
 */
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

if (process.platform !== 'linux') {
  console.error(
    `> refusing to vendor: host platform is ${process.platform}, not linux. ` +
      'Run this on a glibc linux-x64 or linux-arm64 host.',
  )
  process.exit(1)
}

const require = createRequire(import.meta.url)
const ptyRoot = dirname(require.resolve('node-pty/package.json'))
const version = JSON.parse(readFileSync(join(ptyRoot, 'package.json'), 'utf8')).version as string
const repoRoot = join(import.meta.dirname ?? '.', '..')

/** Ensure a compiled `build/Release/pty.node` exists for the host, else build it. */
function ensureHostAddon(): string {
  const built = join(ptyRoot, 'build', 'Release', 'pty.node')
  if (!existsSync(built)) {
    console.log('> no compiled pty.node — running node-gyp rebuild…')
    execFileSync('npx', ['--yes', 'node-gyp@10', 'rebuild'], { cwd: ptyRoot, stdio: 'inherit' })
  }
  return built
}

const arch = process.arch // 'x64' | 'arm64'
const src = ensureHostAddon()
const destDir = join(repoRoot, 'vendor', 'node-pty', `linux-${arch}`)
const dest = join(destDir, 'pty.node')

mkdirSync(destDir, { recursive: true })
copyFileSync(src, dest)
chmodSync(dest, 0o755)
console.log(`> vendored node-pty ${version} linux-${arch}: ${src} -> ${dest}`)
