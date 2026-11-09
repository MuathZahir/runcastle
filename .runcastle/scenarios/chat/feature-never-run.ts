/**
 * Scenario: a started feature in runcastle-demo that has never run
 * (a-new-feature-waits-for-start decisions 1, 5): its branch is cut and its
 * brief is on disk, and it has no session, ticket or run. Its chat waits on
 * Start, with Plan it yourself beside it and the composer locked; opening it
 * launches nothing.
 *
 * Run by the project's scenario runner (`bun {file}`) inside a test drive of
 * runcastle, with the drive identity, the `.runcastle/drive.env` overlay and a
 * fresh `RUNCASTLE_SCENARIO_RUN` in its env. It seeds the DRIVEN instance — the
 * overlay's `RUNCASTLE_DATA_DIR`, through this checkout's own services — and
 * prints the inner runcastle's page for that feature's chat as `ENTRY_URL=…`,
 * which the drive resolves against its own URL.
 *
 * Pressing Start in the drive launches a real agent; the scenario itself runs
 * none. Runcastle has no sign-in, so the URL is a plain one.
 *
 * `SCENARIO_PROJECT` names a different project to seed (tests register a temp
 * repo under its own name).
 */
import { randomBytes } from 'node:crypto'
import { basename, resolve } from 'node:path'
import { dbPath } from '../../../packages/core/src/paths.ts'
import { loadConfig } from '../../../packages/core/src/config-load.ts'
import { createDb } from '../../../packages/server/src/db/client.ts'
import { runMigrations } from '../../../packages/server/src/db/migrate.ts'
import type { AppCtx } from '../../../packages/server/src/db/types.ts'
import { createFeature } from '../../../packages/server/src/services/features.ts'
import { listProjects } from '../../../packages/server/src/services/projects.ts'
import { DRIVE_PREFIX, isDriveDataDir } from '../../drive-dir.ts'

const PROJECT = process.env.SCENARIO_PROJECT || 'runcastle-demo'

/** The brief the agent would read on Start: written to `brief.md` on the feature branch. */
const BRIEF = `# A notes export

## Problem
Notes can only be read in the app. People want to take them elsewhere.

## Goal
A button on the notes list that downloads every note as one Markdown file.
`

/**
 * Only ever the drive's own tree. Every path helper reads `RUNCASTLE_DATA_DIR`
 * lazily, so this check runs before the first one is called; unset, they would
 * fall back to the developer's real `~/.runcastle`.
 */
function driveDataDir(): string {
  const dir = process.env.RUNCASTLE_DATA_DIR
  if (!dir) throw new Error('RUNCASTLE_DATA_DIR is not set — run this inside a test drive')
  if (!isDriveDataDir(resolve(dir))) {
    throw new Error(`refusing to seed ${resolve(dir)} — not a ${DRIVE_PREFIX}* data dir`)
  }
  return resolve(dir)
}

async function main(): Promise<void> {
  process.env.RUNCASTLE_DATA_DIR = driveDataDir()
  const db = createDb(dbPath())
  try {
    runMigrations(db)
    const ctx: AppCtx = { db, config: loadConfig() }

    const project = listProjects(ctx).find(
      (p) => p.name === PROJECT || basename(p.repoPath) === PROJECT,
    )
    if (!project) throw new Error(`${PROJECT} is not registered in this drive's data dir`)

    // A live create (no `draft`): the branch is cut and the brief written to
    // disk, and nothing is launched — no session, ticket or run.
    const run = process.env.RUNCASTLE_SCENARIO_RUN || randomBytes(3).toString('hex')
    const feature = await createFeature(ctx, {
      projectId: project.id,
      title: `Never run ${run}`,
      oneLiner: 'Seeded by the Feature never run scenario.',
      brief: BRIEF,
    })

    console.log(`ENTRY_URL=/p/${encodeURIComponent(project.id)}/f/${encodeURIComponent(feature.slug)}/chat`)
  } finally {
    // Checkpoint the WAL into the db file for any reader after us. Closing alone
    // is not enough: with drizzle's statements still open, bun defers the close
    // and the process can exit with the rows only in the WAL.
    const client = (db as unknown as { $client: { exec(sql: string): void; close(): void } }).$client
    client.exec('PRAGMA wal_checkpoint(TRUNCATE);')
    client.close()
  }
}

try {
  await main()
} catch (e) {
  console.error(`[feature-never-run] ${e instanceof Error ? e.message : String(e)}`)
  process.exit(1)
}
