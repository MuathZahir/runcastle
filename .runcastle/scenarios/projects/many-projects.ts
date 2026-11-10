/**
 * Scenario: eight open projects, to see the project rail and the All projects
 * page with a real crowd. runcastle-demo is the entry; beside it sit
 * terminal-wait-game, JanaLearn_Updated, clawflow, jev-browser-extension,
 * jewellery-system, mlNotebookSync and tiny-notes.
 *
 * Two projects need the human (clawflow and JanaLearn_Updated): each has an
 * active feature whose lead has asked a question, so the rail shows an amber
 * dot and the All projects page draws a card for each. One project looks
 * running (terminal-wait-game): a feature with a worker in status "working".
 * The other four stay quiet, with no features.
 *
 * Run by the project's scenario runner (`bun {file}`) inside a test drive of
 * runcastle, with the drive identity, the `.runcastle/drive.env` overlay and a
 * fresh `RUNCASTLE_SCENARIO_RUN` in its env. It seeds the DRIVEN instance — the
 * overlay's `RUNCASTLE_DATA_DIR` — and prints runcastle-demo's project page as
 * `ENTRY_URL=…`, which the drive resolves against its own URL.
 *
 * Each project is a small git repo (one commit) under `many-projects/` in the
 * drive's data dir, so it goes away with the drive. Opening is idempotent:
 * a second run reuses the projects and the features it seeded. The worker is a
 * row only; no container is started.
 *
 * `SCENARIO_PROJECT` names the project whose page is the entry (default
 * runcastle-demo); it is opened if it is not already.
 */
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import type { Project } from '../../../packages/core/src/schemas.ts'
import { workers } from '../../../packages/core/src/db-schema.ts'
import { dbPath } from '../../../packages/core/src/paths.ts'
import { loadConfig } from '../../../packages/core/src/config-load.ts'
import { createDb } from '../../../packages/server/src/db/client.ts'
import { runMigrations } from '../../../packages/server/src/db/migrate.ts'
import type { AppCtx } from '../../../packages/server/src/db/types.ts'
import { createFeature, list as listFeatures } from '../../../packages/server/src/services/features.ts'
import { setWaiting } from '../../../packages/server/src/services/lead-status.ts'
import { closeProject, listProjects, openProject } from '../../../packages/server/src/services/projects.ts'
import { createSessionRow, markSessionEnded, setSessionTitle } from '../../../packages/server/src/launcher/sessions.ts'
import { DRIVE_PREFIX, isDriveDataDir } from '../../drive-dir.ts'

const ENTRY = process.env.SCENARIO_PROJECT || 'runcastle-demo'
const NAMES = [
  ENTRY,
  'terminal-wait-game',
  'JanaLearn_Updated',
  'clawflow',
  'jev-browser-extension',
  'jewellery-system',
  'mlNotebookSync',
  'tiny-notes',
]
const FIXTURE = resolve(import.meta.dirname, '..', '_fixtures', 'tiny-notes')
const MODEL = 'claude-opus-5-5'
const MINUTE = 60_000

/** Only ever the drive's own tree — see feature-with-workers.ts. */
function driveDataDir(): string {
  const dir = process.env.RUNCASTLE_DATA_DIR
  if (!dir) throw new Error('RUNCASTLE_DATA_DIR is not set — run this inside a test drive')
  if (!isDriveDataDir(resolve(dir))) {
    throw new Error(`refusing to seed ${resolve(dir)} — not a ${DRIVE_PREFIX}* data dir`)
  }
  return resolve(dir)
}

function git(cwd: string, args: string[]): void {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr.trim()}`)
}

/** A one-commit repo at `repo`, unless it is one already. */
function makeRepo(repo: string, name: string): void {
  if (existsSync(join(repo, '.git'))) return
  mkdirSync(repo, { recursive: true })
  if (name === 'tiny-notes') cpSync(FIXTURE, repo, { recursive: true })
  else writeFileSync(join(repo, 'README.md'), `# ${name}\n\nSeeded by the Many projects scenario.\n`)
  // The drive's global git config is empty by design, so the identity is explicit.
  git(repo, ['init', '-b', 'main'])
  git(repo, ['add', '-A'])
  git(repo, ['-c', 'user.name=Scenario', '-c', 'user.email=scenario@example.com', 'commit', '-m', 'Initial commit'])
}

/**
 * The project called `name`. A project that gets seeded features always lives
 * in its own repo under `root`: a drive's database may be a copy of the
 * owner's, where a project of the same name points at their real repo, and
 * creating a feature there would cut a real branch and worktree in it. A quiet
 * project (no features seeded) may reuse a registered one, since nothing is
 * written to its repo.
 */
async function projectNamed(ctx: AppCtx, root: string, name: string, seeded: boolean): Promise<Project> {
  const repo = join(root, name)
  const known = listProjects(ctx).find((p) =>
    seeded ? resolve(p.repoPath) === resolve(repo) : p.name === name || basename(p.repoPath) === name,
  )
  if (known) return known
  makeRepo(repo, name)
  return openProject(ctx, repo)
}

/** A feature titled `title` in `project`, created once. */
async function featureIn(ctx: AppCtx, project: Project, title: string) {
  const existing = listFeatures(ctx, project.id).find((f) => f.title === title)
  if (existing) return { id: existing.id, fresh: false, project }
  const feature = await createFeature(ctx, { projectId: project.id, title, oneLiner: 'Seeded by the Many projects scenario.' })
  return { id: feature.id, fresh: true, project, feature }
}

/** The projects this scenario creates features in; each gets its own repo under the drive. */
const SEEDED = new Set(['clawflow', 'JanaLearn_Updated', 'terminal-wait-game'])

async function main(): Promise<void> {
  const dataDir = driveDataDir()
  process.env.RUNCASTLE_DATA_DIR = dataDir
  const root = join(dataDir, 'many-projects')
  const db = createDb(dbPath())
  try {
    runMigrations(db)
    const ctx: AppCtx = { db, config: loadConfig() }

    const opened: Record<string, Project> = {}
    for (const name of NAMES) opened[name] = await projectNamed(ctx, root, name, SEEDED.has(name))

    // On a copy of the owner's database, a seeded project's namesake (their real
    // repo) is open too, so the rail would show it twice. Close the namesake in
    // this drive's database only: closing writes a row here and touches no repo.
    for (const name of SEEDED) {
      const own = opened[name]!.id
      for (const p of listProjects(ctx)) {
        if (p.id === own || (p.name !== name && basename(p.repoPath) !== name)) continue
        try {
          closeProject(ctx, p.id)
        } catch {
          // A run in flight keeps it open; a duplicate tile beats a failed scenario.
        }
      }
    }

    // Needs you: an active feature whose lead has asked something and waits.
    for (const [name, title, ask] of [
      ['clawflow', 'Retry failed claws', 'Retry once, or keep going until it works?'],
      ['JanaLearn_Updated', 'Lesson streaks', 'Should a missed day reset the streak?'],
    ] as const) {
      const f = await featureIn(ctx, opened[name]!, title)
      if (f.fresh) setWaiting(ctx, f.id, ask, 'answer')
    }

    // Running: a feature with a worker at work, as a row only.
    const wait = opened['terminal-wait-game']!
    const running = await featureIn(ctx, wait, 'Wait screen animation')
    if (running.fresh && running.feature) {
      const feature = running.feature
      const now = Date.now()
      const session = createSessionRow(ctx, {
        featureId: feature.id,
        kind: 'worker',
        worktreePath: join(dataDir, 'many-projects', 'worktree-not-started'),
        model: { id: MODEL, runtime: 'claude-code' },
      })
      setSessionTitle(ctx, session.id, 'Animation')
      markSessionEnded(ctx, session.id)
      db.insert(workers)
        .values({
          id: session.id,
          featureId: feature.id,
          projectId: wait.id,
          label: 'Animation',
          purpose: 'Animate the waiting screen',
          kind: 'on-its-own',
          goal: 'Animate the waiting screen',
          doneWhen: 'Its tests pass',
          model: MODEL,
          runtime: 'claude-code',
          startedBy: 'lead',
          status: 'working',
          failure: null,
          engine: 'docker',
          featureBranch: feature.branch,
          createdAt: now - 20 * MINUTE,
          updatedAt: now - MINUTE,
        })
        .run()
    }

    console.log(`ENTRY_URL=/p/${encodeURIComponent(opened[ENTRY]!.id)}`)
  } finally {
    // Checkpoint the WAL into the db file for any reader after us (see feature-with-workers.ts).
    const client = (db as unknown as { $client: { exec(sql: string): void; close(): void } }).$client
    client.exec('PRAGMA wal_checkpoint(TRUNCATE);')
    client.close()
  }
}

try {
  await main()
} catch (e) {
  console.error(`[many-projects] ${e instanceof Error ? e.message : String(e)}`)
  process.exit(1)
}
