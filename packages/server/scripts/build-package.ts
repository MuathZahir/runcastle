#!/usr/bin/env bun
/**
 * Assemble the publishable `runcastle` package (issue #51, workstream G).
 *
 * `packages/server` is the source; this prepack step turns it into a
 * self-contained tarball under `build/` that resolves on a machine that has
 * never seen this monorepo:
 *
 *   1. Bundle the server + bin entrypoints to plain JS with `@runcastle/core`
 *      resolved INTO the output (NOT `--compile`); every real dependency
 *      (node-pty, simple-git, hono, drizzle, …) stays external so it installs
 *      normally and keeps its prebuilds.
 *   2. Copy the runtime-spawned / runtime-read assets as REAL files: drizzle
 *      migrations, the hook client (spawned by `bun`), the PTY sidecar host
 *      (spawned by `node`), the skills pack + burner prompts, the built SPA, and
 *      the sandcastle build-context template (scaffolded on demand, issue #50).
 *   3. Write the flattened manifest (see publish-manifest.ts) — public name, no
 *      `private`, no `workspace:*`.
 *
 * Run via `bun run build:pkg` (or automatically on `bun pm pack` / publish through
 * the `prepack` script). Then `cd build && bun pm pack` produces the tarball.
 *
 * Bun-only: this uses `Bun.build`, `Bun.$`, and `Bun.file`. It never runs under
 * the node/vitest suite — the pure manifest logic it depends on is tested there.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { $ } from 'bun'
import { buildPublishedManifest, type PackageJson } from './publish-manifest'

const SERVER_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const REPO_ROOT = resolve(SERVER_DIR, '..', '..')
const CORE_DIR = join(REPO_ROOT, 'packages', 'core')
const SKILLS_DIR = join(REPO_ROOT, 'packages', 'skills')
const WEB_DIR = join(REPO_ROOT, 'apps', 'web')
const OUT = join(SERVER_DIR, 'build')

function readPkg(dir: string): PackageJson {
  return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as PackageJson
}

async function main(): Promise<void> {
  const serverPkg = readPkg(SERVER_DIR)
  const corePkg = readPkg(CORE_DIR)
  const manifest = buildPublishedManifest({
    serverPkg,
    corePkg,
    version: process.env.RUNCASTLE_RELEASE_VERSION,
  })
  // Every real dependency stays external so it resolves from node_modules at
  // runtime (prebuilds intact); only `@runcastle/*` is bundled in.
  const external = Object.keys(manifest.dependencies ?? {})

  rmSync(OUT, { recursive: true, force: true })
  mkdirSync(OUT, { recursive: true })

  console.log('• bundling server + bin (core inlined, deps external)')
  const bundle = await Bun.build({
    entrypoints: [join(SERVER_DIR, 'src', 'index.ts'), join(SERVER_DIR, 'src', 'bin', 'runcastle.ts')],
    outdir: OUT,
    target: 'bun',
    format: 'esm',
    external,
    naming: { entry: '[dir]/[name].js' },
    root: join(SERVER_DIR, 'src'),
  })
  if (!bundle.success) {
    for (const log of bundle.logs) console.error(log)
    throw new Error('bun build failed')
  }

  console.log('• building web SPA')
  await $`bun run build`.cwd(WEB_DIR)

  console.log('• vendoring runtime assets as real files')
  // Migrations (read by runMigrations).
  cpSync(join(SERVER_DIR, 'drizzle'), join(OUT, 'drizzle'), { recursive: true })
  // Hook client (spawned by bun) + PTY sidecar host (spawned by node): real files.
  cpSync(join(SERVER_DIR, 'src', 'launcher', 'hook-client.ts'), join(OUT, 'hook-client.ts'))
  cpSync(join(SERVER_DIR, 'src', 'pty', 'pty-host.cjs'), join(OUT, 'pty-host.cjs'))
  // Skills pack + burner prompts (read at launch / by the burner workflow).
  cpSync(join(SKILLS_DIR, 'packs'), join(OUT, 'skills', 'packs'), { recursive: true })
  cpSync(join(SKILLS_DIR, 'burner'), join(OUT, 'skills', 'burner'), { recursive: true })
  // Built SPA (served by mountWebAppIfBuilt via RUNCASTLE_WEB_DIST).
  cpSync(join(WEB_DIR, 'dist'), join(OUT, 'web'), { recursive: true })
  // Sandcastle build-context template (scaffolded into `.sandcastle/` on demand by
  // the Enable-AFK card's build-image flow; issue #50).
  cpSync(join(SERVER_DIR, 'src', 'assets', 'sandcastle'), join(OUT, 'sandcastle-template'), {
    recursive: true,
  })

  const readme = join(SERVER_DIR, 'README.md')
  if (existsSync(readme)) cpSync(readme, join(OUT, 'README.md'))

  writeFileSync(join(OUT, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)

  console.log(`✓ publishable package assembled at ${OUT}`)
  console.log(`  next: cd ${OUT} && bun pm pack`)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
