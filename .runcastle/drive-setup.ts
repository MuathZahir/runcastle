/**
 * Bring one test drive's environment up.
 *
 * runcastle drives runcastle, which makes this script unusual in one way worth
 * stating up front: the thing under the wheel is a *runcastle server*, and the
 * server that spawns it is the developer's own installed runcastle. Everything
 * here exists to keep those two apart — a different data dir, a different port,
 * and asset paths pinned to THIS checkout rather than the installed tarball the
 * parent process advertises.
 *
 * Run by the drive's setup hook (`bun .runcastle/drive-setup.ts`) with the
 * identity in `RUNCASTLE_SLUG` / `RUNCASTLE_BRANCH` / `RUNCASTLE_ID`. Everything
 * it computes leaves through `.runcastle/drive.env`, which the server parses on
 * exit and overlays onto the dev pane and the stop hook.
 *
 * Every step runs unconditionally. A branch that adds a package or a migration
 * must not need this file to notice — `bun install` and the SPA build are cheap
 * no-ops on an unchanged tree and the only thing standing between a feature
 * branch and a working drive when they are not.
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

const repoRoot = resolve(import.meta.dirname, '..')
const driveEnvPath = join(repoRoot, '.runcastle', 'drive.env')

/**
 * Identity is server-passed and never derived from git: the preparation dry run
 * drives under a synthetic slug on whatever branch happens to be checked out, so
 * `git rev-parse` would name the wrong drive. Missing means the script was run
 * by hand rather than by the hook, and guessing an identity would build a drive
 * tree nothing ever tears down.
 */
function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set — run this through the drive setup hook`)
  return value
}

const id = required('RUNCASTLE_ID')
const slug = required('RUNCASTLE_SLUG')

/** Truncate first: a rerun must not inherit a stale line from the last drive. */
writeFileSync(driveEnvPath, '')

const emit = (vars: Record<string, string>): void => {
  const body = Object.entries(vars)
    .map(([key, value]) => `${key}=${value}\n`)
    .join('')
  writeFileSync(driveEnvPath, body, { flag: 'a' })
}

/**
 * `process.execPath` rather than the string `bun`: this script is already
 * running under bun, so that is the exact binary the drive should build with,
 * and it sidesteps Windows PATHEXT resolution in a non-shell spawn entirely.
 */
function run(label: string, args: string[]): void {
  console.log(`[drive-setup] ${label}`)
  const result = spawnSync(process.execPath, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    env: process.env,
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${label} failed (exit ${result.status})`)
}

/** Free-port probe. Bind rather than scan: nothing else answers truthfully. */
function isFree(port: number): Promise<boolean> {
  return new Promise((resolveP) => {
    const server = createServer()
    server.once('error', () => resolveP(false))
    server.once('listening', () => server.close(() => resolveP(true)))
    server.listen(port, '127.0.0.1')
  })
}

/**
 * A port derived from the SLUG, not the branch — every lap of a feature keeps
 * the same URL, so a bookmark survives a rethink. The 20000-29999 window is high
 * enough to stay clear of the developer's own install on 4512/4513, and the
 * upward probe covers the case where something else already holds the pick.
 */
async function pickPort(): Promise<number> {
  const digest = createHash('sha1').update(slug).digest()
  const base = 20000 + (digest.readUInt32BE(0) % 10000)
  for (let port = base; port < base + 200; port++) {
    if (await isFree(port)) return port
  }
  throw new Error(`no free port in ${base}..${base + 200}`)
}

run('bun install', ['install'])
run('build the SPA', ['run', '--filter', '@runcastle/web', 'build'])

/**
 * One data dir per drive, named for the identity so the stop hook can find it
 * again and so two drives never share a database. `.runcastle-drive-` is also
 * the prefix the stop hook's safety guard insists on before it deletes
 * anything — the developer's `~/.runcastle` and `~/.runcastle-dev` sit in the
 * same parent directory and must be unreachable from here.
 */
const dataDir = join(homedir(), `.runcastle-drive-${id}`)
mkdirSync(dataDir, { recursive: true })

/**
 * Seed the drive tree from the real install.
 *
 * Without this a drive can click around the UI and nothing else: every path
 * below derives from the data dir, so a fresh tree has no `.env` and therefore
 * no `CLAUDE_CODE_OAUTH_TOKEN` — and `readTokenFromEnvFile(envPath())` is how
 * the ticket burner and the research workflow authenticate. Burning tickets is
 * the product, so a drive that cannot burn is testing the shell.
 *
 * `config.json` comes too, for a subtler reason: a fresh tree falls back to
 * schema defaults, which would silently drive a DIFFERENT model and a different
 * `sandboxImage` than the developer actually runs. A drive is supposed to
 * reproduce their setup, not a hypothetical default one.
 *
 * The credential lands in a scratch tree the stop hook deletes, and never in
 * `drive.env` (whose variable NAMES are printed to the timeline) — this is the
 * same file, in the same role, one directory over.
 */
const prodDir = join(homedir(), '.runcastle')
for (const file of ['.env', 'config.json']) {
  const from = join(prodDir, file)
  if (existsSync(from)) {
    copyFileSync(from, join(dataDir, file))
    console.log(`[drive-setup] seeded ${file} from ${prodDir}`)
  } else {
    console.warn(`[drive-setup] no ${file} at ${prodDir} — the drive will use defaults`)
  }
}

const port = await pickPort()

/**
 * The asset overrides are the subtle half of this file. A published install
 * vendors the migrations, the SPA and the rest beside its bin and points the
 * `RUNCASTLE_*` asset vars at them; `resolveAsset` lets those vars WIN when set.
 * The drive inherits the environment of the server that spawned it — the
 * developer's installed runcastle — so without these lines a drive would boot
 * the checkout's code against the INSTALLED build's migrations and SPA, and a
 * branch that changed the UI or added a migration would be invisible in its own
 * test drive. Pinning each one to the checkout is what makes the drive test the
 * branch.
 */
const pkg = (...parts: string[]): string => join(repoRoot, ...parts)

emit({
  RUNCASTLE_DATA_DIR: dataDir,
  RUNCASTLE_SERVER_PORT: String(port),
  RUNCASTLE_MIGRATIONS_DIR: pkg('packages', 'server', 'drizzle'),
  RUNCASTLE_WEB_DIST: pkg('apps', 'web', 'dist'),
  RUNCASTLE_SKILLS_DIR: pkg('packages', 'skills'),
  RUNCASTLE_HOOK_CLIENT: pkg('packages', 'server', 'src', 'launcher', 'hook-client.ts'),
  RUNCASTLE_PTY_HOST: pkg('packages', 'server', 'src', 'pty', 'pty-host.cjs'),
  RUNCASTLE_SANDCASTLE_TEMPLATE: pkg('packages', 'server', 'src', 'assets', 'sandcastle'),
})

console.log(`[drive-setup] data dir ${dataDir}`)
console.log(`[drive-setup] port ${port}`)
