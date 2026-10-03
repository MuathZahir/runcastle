/**
 * Run the platform install smoke (smoke.ts) in fresh Linux containers.
 *
 * Usage:
 *   bun scripts/platform-smoke/run.ts                        # local build, every target
 *   bun scripts/platform-smoke/run.ts ubuntu-x64 alpine-x64  # some targets
 *   bun scripts/platform-smoke/run.ts --npm runcastle@1.4.2  # a published version instead
 *   bun scripts/platform-smoke/run.ts --no-build             # reuse packages/server/build
 *
 * Local mode builds the package exactly as release.yml does (`build:pkg`, then
 * `bun pm pack`) so what gets smoked is what would ship. Each target is a
 * Dockerfile + base image + `--platform`; arm64 runs under QEMU on an x64 host,
 * which is slow but real. If its image build dies with `exec format error`, the
 * emulator is not registered: `docker run --privileged --rm tonistiigi/binfmt
 * --install arm64` (lasts until the Docker VM restarts), or rely on the native
 * `ubuntu-24.04-arm` runner in .github/workflows/platform-smoke.yml.
 *
 * Containers cover Linux only. macOS runs the same smoke.ts on a GitHub macOS
 * runner — see .github/workflows/platform-smoke.yml.
 */
import { cpSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { $ } from 'bun'

const HERE = resolve(fileURLToPath(import.meta.url), '..')
const REPO_ROOT = resolve(HERE, '..', '..')
const SERVER_DIR = join(REPO_ROOT, 'packages', 'server')

interface Target {
  dockerfile: 'Dockerfile' | 'Dockerfile.alpine'
  base: string
  platform: 'linux/amd64' | 'linux/arm64'
}

const TARGETS: Record<string, Target> = {
  'ubuntu-x64': { dockerfile: 'Dockerfile', base: 'ubuntu:24.04', platform: 'linux/amd64' },
  'debian-x64': { dockerfile: 'Dockerfile', base: 'debian:12', platform: 'linux/amd64' },
  'ubuntu-arm64': { dockerfile: 'Dockerfile', base: 'ubuntu:24.04', platform: 'linux/arm64' },
  'alpine-x64': { dockerfile: 'Dockerfile.alpine', base: 'alpine:3.22', platform: 'linux/amd64' },
}

const argv = process.argv.slice(2)
const npmIdx = argv.indexOf('--npm')
const npmSpec = npmIdx >= 0 ? (argv[npmIdx + 1] ?? 'runcastle@latest') : null
const noBuild = argv.includes('--no-build')
const named = argv.filter((a, i) => !a.startsWith('--') && !(npmIdx >= 0 && i === npmIdx + 1))
const unknown = named.filter((n) => !(n in TARGETS))
if (unknown.length > 0) {
  console.error(`unknown target(s): ${unknown.join(', ')}. Known: ${Object.keys(TARGETS).join(', ')}`)
  process.exit(2)
}
const selected = named.length > 0 ? named : Object.keys(TARGETS)

const ctx = mkdtempSync(join(tmpdir(), 'runcastle-platform-smoke-'))
try {
  for (const f of ['Dockerfile', 'Dockerfile.alpine', 'smoke.ts']) cpSync(join(HERE, f), join(ctx, f))

  if (!npmSpec) {
    const sha = (await $`git rev-parse --short HEAD`.cwd(REPO_ROOT).text()).trim()
    if (!noBuild) {
      console.log(`• building the publishable package (0.0.0-smoke.${sha})`)
      await $`bun run build:pkg`.cwd(SERVER_DIR).env({ ...process.env, RUNCASTLE_RELEASE_VERSION: `0.0.0-smoke.${sha}` })
    }
    const packDir = join(ctx, 'pack')
    await $`bun pm pack --destination ${packDir}`.cwd(join(SERVER_DIR, 'build')).quiet()
    const tarball = readdirSync(packDir).find((f) => f.endsWith('.tgz'))
    if (!tarball) throw new Error('bun pm pack wrote no tarball')
    cpSync(join(packDir, tarball), join(ctx, 'runcastle.tgz'))
    rmSync(packDir, { recursive: true, force: true })
    console.log(`• packed ${tarball}`)
  }

  const outcome: Record<string, boolean> = {}
  for (const name of selected) {
    const t = TARGETS[name]!
    const tag = `runcastle-platform-smoke:${name}`
    console.log(`\n════ ${name} (${t.base}, ${t.platform}) ════`)
    const build = await $`docker build --platform ${t.platform} --build-arg BASE=${t.base} -f ${join(ctx, t.dockerfile)} -t ${tag} ${ctx}`.nothrow()
    if (build.exitCode !== 0) {
      outcome[name] = false
      console.log(`✗ ${name}: image build failed`)
      continue
    }
    const envArgs = npmSpec ? ['-e', `RUNCASTLE_SPEC=${npmSpec}`] : []
    const runResult = await $`docker run --rm --platform ${t.platform} ${envArgs} ${tag}`.nothrow()
    outcome[name] = runResult.exitCode === 0
  }

  console.log('\n════ platform smoke ════')
  for (const [name, ok] of Object.entries(outcome)) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
  process.exitCode = Object.values(outcome).every(Boolean) ? 0 : 1
} finally {
  rmSync(ctx, { recursive: true, force: true })
}
