/**
 * Dev-only test-state surgery: `bun run dev:tool <command>`.
 *
 * The CLI shell. The operations live in `packages/server/src/dev/` (state.ts:
 * the db surgery; args.ts: the parse) — this file owns the parts that only make
 * sense as a command: pinning the dev data dir, printing, `git config`, and the
 * whole-tree wipe.
 *
 * Two independent things keep it off a real install:
 *
 *  1. It ALWAYS targets the dev data dir (`~/.runcastle-dev/`, or
 *     `RUNCASTLE_DEV_DATA_DIR`) and hard-refuses if that resolves to
 *     `~/.runcastle/`, the tree a published `runcastle` owns. The guard is on
 *     the resolved path — not on an env var some stray shell could set — so
 *     there is no configuration under which this wipes real projects.
 *  2. It is a root script, and the published package is a bundle of
 *     `src/index.ts` + `src/bin/runcastle.ts` (`scripts/build-package.ts`). None
 *     of this reaches an install, so there is nothing to gate at runtime there.
 *
 * The env pin below must run before anything CALLS a path helper. It does not
 * need to run before the imports: every helper in `@runcastle/core/paths` reads
 * `RUNCASTLE_DATA_DIR` lazily inside its function body and none capture a path
 * at module load, so hoisted imports are harmless.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  dataDir,
  dbPath,
  devDataDir,
  envPath,
  prodDataDir,
  sameDataDir,
} from '../packages/core/src/paths.ts'
import { loadConfig } from '../packages/core/src/config-load.ts'
import {
  USAGE,
  UsageError,
  isMutation,
  needsConfirmation,
  parseArgs,
} from '../packages/server/src/dev/args.ts'
import type { DevCommand } from '../packages/server/src/dev/args.ts'
import * as dev from '../packages/server/src/dev/state.ts'
import type { FeatureRow } from '../packages/server/src/dev/state.ts'
import { createDb } from '../packages/server/src/db/client.ts'
import { runMigrations } from '../packages/server/src/db/migrate.ts'
import type { AppCtx } from '../packages/server/src/db/types.ts'
import { setFeatureStatus, setPhase } from '../packages/server/src/services/repo.ts'
import type { FeatureStatus, Phase } from '../packages/core/src/schemas.ts'

const DEV_DIR = devDataDir()
if (sameDataDir(DEV_DIR, prodDataDir())) {
  console.error(
    `refusing to run: the dev data dir resolves to ${prodDataDir()}, which is a real\n` +
      'runcastle install. Unset RUNCASTLE_DEV_DATA_DIR or point it somewhere else.',
  )
  process.exit(1)
}
process.env.RUNCASTLE_DATA_DIR = DEV_DIR
process.env.RUNCASTLE_DEV = '1'

const log = (msg = ''): void => void process.stdout.write(`${msg}\n`)
const notes = (lines: string[]): void => {
  for (const n of lines) log(`  note: ${n}`)
}

// --- entry -----------------------------------------------------------------

async function main(argv: string[]): Promise<number> {
  let cmd: DevCommand
  try {
    cmd = parseArgs(argv)
  } catch (e) {
    if (!(e instanceof UsageError)) throw e
    log(`error: ${e.message}`)
    log('')
    log(USAGE)
    return 1
  }

  if (cmd.kind === 'help') {
    log(USAGE)
    return 0
  }

  if (needsConfirmation(cmd)) {
    log(`this destroys state under ${dataDir()} — re-run with --yes to confirm.`)
    return 1
  }

  // `reset` wipes the tree wholesale, so it must not open the db first.
  if (cmd.kind === 'reset') return resetDataDir()

  if (!existsSync(dbPath())) {
    log(`no dev database yet at ${dbPath()}`)
    log('start it once with `bun run dev` (it creates the tree at boot).')
    return cmd.kind === 'status' ? 0 : 1
  }

  const db = createDb(dbPath())
  runMigrations(db)
  const ctx: AppCtx = { db, config: loadConfig() }

  const code = await run(ctx, cmd)
  if (code === 0 && isMutation(cmd)) await warnIfServerRunning(ctx)
  return code
}

async function run(ctx: AppCtx, cmd: DevCommand): Promise<number> {
  switch (cmd.kind) {
    case 'status':
      return status(ctx)
    case 'project-ls':
      return projectLs(ctx)
    case 'project-rm':
      return projectRm(ctx, cmd.target, cmd.branches)
    case 'prep-reset':
      return prepReset(ctx, cmd.target)
    case 'feature-ls':
      return featureLs(ctx, cmd.project)
    case 'feature-phase':
      return featurePhase(ctx, cmd.feature, cmd.phase)
    case 'feature-status':
      return featureStatus(ctx, cmd.feature, cmd.status)
    case 'feature-rm':
      return featureRm(ctx, cmd.target, cmd.branches)
    case 'onboarding-reset':
      return onboardingReset(ctx, cmd.branches)
    case 'onboarding-git':
      return cmd.action === 'clear' ? gitIdentityClear() : gitIdentityRestore()
    default:
      return 0
  }
}

// --- status ----------------------------------------------------------------

function status(ctx: AppCtx): number {
  const c = dev.counts(ctx)
  log(`data dir  ${dataDir()}`)
  log(`db        ${dbPath()}`)
  log(`projects  ${c.projects} (${c.openProjects} open)`)
  log(`features  ${c.features}`)
  log(`tickets   ${c.tickets}`)
  log(`afk token ${hasAfkToken() ? 'captured' : 'absent'} — ${envPath()}`)
  log(`git ident ${describeGitIdentity()} — global, shared with your real install`)
  log('')
  log(
    c.projects === 0
      ? 'no projects → `bun run dev` shows the first-run wizard.'
      : 'projects exist → the wizard is skipped; `onboarding reset` brings it back.',
  )
  return 0
}

// --- projects --------------------------------------------------------------

function projectLs(ctx: AppCtx): number {
  const all = dev.allProjects(ctx)
  if (all.length === 0) {
    log('no projects.')
    return 0
  }
  for (const p of all) {
    const state = p.closedAt === null ? 'open  ' : 'closed'
    log(`${p.id}  ${state}  ${p.name.padEnd(24)} ${dev.featuresOf(ctx, p.id).length} feature(s)`)
    log(`${' '.repeat(p.id.length)}          ${p.repoPath}`)
  }
  return 0
}

async function projectRm(ctx: AppCtx, target: string, branches: boolean): Promise<number> {
  const found = dev.resolveProjects(ctx, target)
  if (found.length === 0) {
    log(`no project matches \`${target}\`.`)
    return 1
  }
  for (const p of found) {
    log(`removing ${p.name} (${p.id}) — ${dev.featuresOf(ctx, p.id).length} feature(s)`)
    notes(await dev.removeProject(ctx, p, branches))
  }
  log(`removed ${found.length} project(s).`)
  return 0
}

// --- preparation -----------------------------------------------------------

function prepReset(ctx: AppCtx, target: string): number {
  const found = dev.resolveProjects(ctx, target)
  if (found.length === 0) {
    log(`no project matches \`${target}\`.`)
    return 1
  }
  for (const p of found) {
    const cleared = dev.resetPrep(ctx, p)
    log(`${p.name} (${p.id}): findings deleted, ${cleared} field(s) unset`)
  }
  log('')
  log('open the project to get the preparation call-to-action back.')
  return 0
}

// --- features --------------------------------------------------------------

function featureLs(ctx: AppCtx, projectTarget?: string): number {
  const scope = projectTarget ? dev.resolveProjects(ctx, projectTarget) : dev.allProjects(ctx)
  if (scope.length === 0) {
    log(`no project matches \`${projectTarget}\`.`)
    return 1
  }
  let printed = 0
  for (const p of scope) {
    const feats = dev.featuresOf(ctx, p.id)
    if (feats.length === 0) continue
    log(`${p.name} (${p.id})`)
    for (const f of feats) {
      log(`  ${f.id}  ${f.slug.padEnd(28)} ${f.phase.padEnd(15)} ${f.status}`)
      printed++
    }
  }
  if (printed === 0) log('no features.')
  return 0
}

/** Resolve to exactly one feature, or explain why it could not. */
function oneFeature(ctx: AppCtx, target: string): FeatureRow | number {
  const found = dev.resolveFeatures(ctx, target)
  if (found.length === 0) {
    log(`no feature matches \`${target}\`.`)
    return 1
  }
  if (found.length > 1) {
    log(`\`${target}\` matches ${found.length} features — use an id (\`feature ls\`).`)
    return 1
  }
  return found[0] as FeatureRow
}

function featurePhase(ctx: AppCtx, target: string, phase: Phase): number {
  const feature = oneFeature(ctx, target)
  if (typeof feature === 'number') return feature
  // Through the service, so a forced move lands in the feature's timeline
  // alongside real transitions instead of silently rewriting its history — the
  // event stream is what the UI reads, and a phase that changed with no event is
  // indistinguishable from a bug.
  const after = setPhase(
    ctx,
    feature.id,
    phase,
    'phase.forced',
    `phase ${feature.phase} → ${phase} (forced by the dev tool — gates not checked)`,
  )
  log(`${feature.slug}: ${feature.phase} → ${after.phase}`)
  return 0
}

function featureStatus(ctx: AppCtx, target: string, next: FeatureStatus): number {
  const feature = oneFeature(ctx, target)
  if (typeof feature === 'number') return feature
  const after = setFeatureStatus(ctx, feature.id, next)
  log(`${feature.slug}: ${feature.status} → ${after.status}`)
  return 0
}

async function featureRm(ctx: AppCtx, target: string, branches: boolean): Promise<number> {
  const found = dev.resolveFeatures(ctx, target)
  if (found.length === 0) {
    log(`no feature matches \`${target}\`.`)
    return 1
  }
  for (const f of found) {
    const project = dev.projectOf(ctx, f.projectId)
    if (!project) {
      log(`skipping ${f.slug}: its project row is missing`)
      continue
    }
    log(`removing ${f.slug} (${f.id})`)
    notes(await dev.removeFeature(ctx, project, f, branches))
  }
  log(`removed ${found.length} feature(s).`)
  return 0
}

// --- onboarding ------------------------------------------------------------

const AFK_TOKEN_KEY = 'CLAUDE_CODE_OAUTH_TOKEN'
const tokenLine = (): RegExp => new RegExp(`^(export\\s+)?${AFK_TOKEN_KEY}=`)
const savedIdentityPath = (): string => join(dataDir(), 'dev-saved-git-identity.json')

function readEnvFile(): string {
  return existsSync(envPath()) ? readFileSync(envPath(), 'utf8') : ''
}

function hasAfkToken(): boolean {
  return readEnvFile().split('\n').some((l) => tokenLine().test(l))
}

/**
 * Put the app back in its first-run state. The wizard shows exactly when the
 * projects table is empty (`Shell.tsx`) and its AFK step reads the data-dir
 * `.env`, so emptying both is the entire reset.
 *
 * The git-identity step is the one piece this cannot cover: it probes
 * `git config --global`, which is host-wide and shared with the real install.
 * `onboarding git clear` handles that separately and reversibly, rather than
 * having a reset silently reach outside the dev tree.
 */
async function onboardingReset(ctx: AppCtx, branches: boolean): Promise<number> {
  const all = dev.allProjects(ctx)
  for (const p of all) {
    log(`removing ${p.name} (${p.id})`)
    notes(await dev.removeProject(ctx, p, branches))
  }

  const before = readEnvFile()
  if (before.length > 0) {
    const kept = before
      .split('\n')
      .filter((l) => !tokenLine().test(l))
      .join('\n')
      .replace(/\n+$/, '')
    // Drop the file entirely when the token was its only content, so the next
    // run sees the same "never captured" state a fresh install has.
    if (kept.trim().length === 0) dev.rmBestEffort(envPath())
    else writeFileSync(envPath(), `${kept}\n`, 'utf8')
    log(`AFK token cleared from ${envPath()}`)
  }

  log('')
  log(`onboarding reset: ${all.length} project(s) removed — the first-run wizard is back.`)
  log(
    describeGitIdentity() === 'unset'
      ? 'git identity is unset, so the wizard will show its git step too.'
      : 'git identity is set globally, so the wizard SKIPS its git step —\n' +
          'run `bun run dev:tool onboarding git clear` to see it (reversible).',
  )
  return 0
}

function gitConfigGet(key: string): string | null {
  try {
    const out = execFileSync('git', ['config', '--global', '--get', key], {
      encoding: 'utf8',
    }).trim()
    return out.length > 0 ? out : null
  } catch {
    // `--get` exits 1 when the key is unset; that is the answer, not a failure.
    return null
  }
}

function describeGitIdentity(): string {
  const name = gitConfigGet('user.name')
  const email = gitConfigGet('user.email')
  return name === null && email === null ? 'unset' : `${name ?? '?'} <${email ?? '?'}>`
}

/**
 * Unset the GLOBAL git identity so the wizard's one blocking step is reachable,
 * saving the previous values into the dev data dir first.
 *
 * This is the only dev command that reaches outside the dev tree, because git
 * identity is host-wide by construction and there is nowhere else it could live.
 * That is precisely why it is a separate, explicitly-named command with an exact
 * inverse, instead of a side effect of `onboarding reset`.
 */
function gitIdentityClear(): number {
  const name = gitConfigGet('user.name')
  const email = gitConfigGet('user.email')
  if (name === null && email === null) {
    log('git identity is already unset — the wizard will show its git step.')
    return 0
  }

  mkdirSync(dataDir(), { recursive: true })
  writeFileSync(savedIdentityPath(), JSON.stringify({ name, email }, null, 2), 'utf8')
  for (const key of ['user.name', 'user.email']) {
    try {
      execFileSync('git', ['config', '--global', '--unset', key], { stdio: 'ignore' })
    } catch {
      // `--unset` exits non-zero when the key was already absent — not an error.
    }
  }
  log(`git identity cleared (was ${name ?? '?'} <${email ?? '?'}>)`)
  log(`saved to ${savedIdentityPath()}`)
  log('restore with: bun run dev:tool onboarding git restore')
  return 0
}

function gitIdentityRestore(): number {
  const path = savedIdentityPath()
  if (!existsSync(path)) {
    log(`nothing saved at ${path} — set it by hand:`)
    log('  git config --global user.name "Your Name"')
    log('  git config --global user.email you@example.com')
    return 1
  }
  const saved = JSON.parse(readFileSync(path, 'utf8')) as { name?: string; email?: string }
  for (const [key, value] of [
    ['user.name', saved.name],
    ['user.email', saved.email],
  ] as const) {
    if (value) execFileSync('git', ['config', '--global', key, value], { stdio: 'ignore' })
  }
  rmSync(path, { force: true })
  log(`git identity restored: ${saved.name ?? '?'} <${saved.email ?? '?'}>`)
  return 0
}

// --- whole-tree reset ------------------------------------------------------

function resetDataDir(): number {
  const dir = dataDir()
  if (!existsSync(dir)) {
    log(`${dir} does not exist — nothing to reset.`)
    return 0
  }
  rmSync(dir, { recursive: true, force: true })
  log(`deleted ${dir}`)
  log('restart `bun run dev` — the server recreates the tree at boot.')
  return 0
}

// --- helpers ---------------------------------------------------------------

/**
 * The dev server holds state the db knows nothing about (the PTY registry,
 * in-flight prep/run controllers). `bun --hot` reloads modules but preserves
 * that state, so after a destructive change the honest advice is a full restart
 * rather than "it'll pick it up".
 *
 * `/health` reports the server's data dir, which is what makes this precise: a
 * real install and a dev server both listen on 4512, so a bare port check would
 * tell you to restart dev because something else answered.
 */
async function warnIfServerRunning(ctx: AppCtx): Promise<void> {
  const url = `http://localhost:${ctx.config.serverPort}/health`
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(500) })
    if (!res.ok) return
    const body = (await res.json()) as { dataDir?: string }
    // An older build has no `dataDir` — warn rather than stay silent, since a
    // missed restart is the more confusing of the two failure modes.
    if (body.dataDir !== undefined && !sameDataDir(body.dataDir, dataDir())) return
  } catch {
    return
  }
  log('')
  log(`note: a server on ${url} is serving this data dir — restart \`bun run dev\``)
  log('      so its in-memory session/run state matches the db you just changed.')
}

const exitCode = await main(process.argv.slice(2))
if (exitCode !== 0) process.exit(exitCode)
