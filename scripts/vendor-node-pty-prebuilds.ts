/**
 * Regenerate `patches/node-pty@<version>.patch` — the Linux prebuild bridge
 * (issue #39). node-pty 1.1.0 ships no `linux-*` prebuild, so `bun install` on
 * stock glibc Linux compiles from source (needs a C++ toolchain + node ≥22).
 * This script vendors a prebuilt `pty.node` into a Bun patch that lands the
 * binary in `prebuilds/<platform>-<arch>/` *before* node-pty's install hook, so
 * the compile never fires. See `patches/README.md`.
 *
 * Run:  bun scripts/vendor-node-pty-prebuilds.ts
 *
 * It (1) resolves the installed node-pty, (2) builds `pty.node` for the host arch
 * via `node-gyp rebuild` if no compiled addon is present, (3) stages that addon
 * (plus any `pty.node` already sitting under a `prebuilds/<platform>-<arch>/`
 * dir in node_modules — e.g. a cross-built arm64 you dropped in) and (4) emits a
 * git binary patch. Bun's patch applier is git-compatible.
 */
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const ptyRoot = dirname(require.resolve('node-pty/package.json'))
const version = JSON.parse(readFileSync(join(ptyRoot, 'package.json'), 'utf8')).version as string
const patchPath = join(import.meta.dirname ?? '.', '..', 'patches', `node-pty@${version}.patch`)

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' })

/** Ensure a compiled `build/Release/pty.node` exists for the host, else build it. */
function ensureHostAddon(): string {
  const built = join(ptyRoot, 'build', 'Release', 'pty.node')
  if (!existsSync(built)) {
    console.log('> no compiled pty.node — running node-gyp rebuild…')
    execFileSync('npx', ['--yes', 'node-gyp@10', 'rebuild'], { cwd: ptyRoot, stdio: 'inherit' })
  }
  return built
}

// Which prebuild dirs to fold into the patch: the host arch (built above) plus
// any that already exist in the install (a cross-built arch dropped in by hand).
const hostDir = `prebuilds/${process.platform}-${process.arch}`
const staged = new Map<string, string>() // patch-relative path -> source file
staged.set(`${hostDir}/pty.node`, ensureHostAddon())
for (const arch of ['linux-x64', 'linux-arm64']) {
  const existing = join(ptyRoot, 'prebuilds', arch, 'pty.node')
  if (existsSync(existing)) staged.set(`prebuilds/${arch}/pty.node`, existing)
}

// Assemble the additions in a throwaway git repo so paths are package-relative.
const tmp = mkdtempSync(join(tmpdir(), 'node-pty-patch-'))
try {
  git(tmp, 'init', '-q')
  git(tmp, 'config', 'user.email', 'bot@runcastle')
  git(tmp, 'config', 'user.name', 'runcastle')
  for (const [rel, src] of staged) {
    const dest = join(tmp, rel)
    mkdirSync(dirname(dest), { recursive: true })
    cpSync(src, dest, { mode: 0o755 } as never)
  }
  git(tmp, 'add', '-A')
  const patch = execFileSync('git', ['-c', 'core.autocrlf=false', 'diff', '--binary', '--cached'], {
    cwd: tmp,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  writeFileSync(patchPath, patch)
  console.log(`> wrote ${patchPath} (${[...staged.keys()].join(', ')})`)
} finally {
  rmSync(tmp, { recursive: true, force: true })
}
