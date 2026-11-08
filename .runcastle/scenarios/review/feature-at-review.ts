/**
 * Scenario: a feature in runcastle-demo whose Review worker has handed back
 * (burns-become-workers decisions 3, 4): the review is in the feature's worker
 * list, its findings are recorded against it, its Review Package (a screenshot
 * and the findings) is the card in the lead's chat, and the lead has declared
 * the feature ready — the feature waits on the human ("ready to test").
 *
 * Run by the project's scenario runner (`bun {file}`) inside a test drive of
 * runcastle, with the drive identity, the `.runcastle/drive.env` overlay and a
 * fresh `RUNCASTLE_SCENARIO_RUN` in its env. It seeds the DRIVEN instance — the
 * overlay's `RUNCASTLE_DATA_DIR`, through this checkout's own services — and
 * prints the inner runcastle's page for that feature as `ENTRY_URL=…`, which
 * the drive resolves against its own URL.
 *
 * Review is the step runcastle drives most often and, by hand, costs a real
 * review to reach. The Review worker is a row only: no agent runs. Runcastle
 * has no sign-in, so the URL is a plain one.
 *
 * `SCENARIO_PROJECT` names a different project to seed (tests register a temp
 * repo under its own name).
 */
import { randomBytes } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import type { ReviewFindingInput } from '../../../packages/core/src/schemas.ts'
import { workers } from '../../../packages/core/src/db-schema.ts'
import { dbPath, reviewSawDir, reviewShotPath, worktreeDir } from '../../../packages/core/src/paths.ts'
import { loadConfig } from '../../../packages/core/src/config-load.ts'
import { createDb } from '../../../packages/server/src/db/client.ts'
import { runMigrations } from '../../../packages/server/src/db/migrate.ts'
import type { AppCtx } from '../../../packages/server/src/db/types.ts'
import { createSessionRow, markSessionEnded, setSessionTitle } from '../../../packages/server/src/launcher/sessions.ts'
import { createFeature, declareReady } from '../../../packages/server/src/services/features.ts'
import { listProjects } from '../../../packages/server/src/services/projects.ts'
import { reportFinding } from '../../../packages/server/src/services/review-findings.ts'
import { appendSaw, startSaw } from '../../../packages/server/src/services/review-saw.ts'
import { appendThreadEvent } from '../../../packages/server/src/threads/log.ts'
import { DRIVE_PREFIX, isDriveDataDir } from '../../drive-dir.ts'

const PROJECT = process.env.SCENARIO_PROJECT || 'runcastle-demo'
const MODEL = 'claude-opus-5-5'
const MINUTE = 60_000

/** The review's account: its first line leads the package. */
const ACCOUNT =
  'Drive review: the list view and the save button work end to end · 1 defect, 1 observation\n\n' +
  'The list shows every saved item and the save button stores a new one; an empty title is accepted where the spec says it should be refused.'

const FINDINGS: ReviewFindingInput[] = [
  {
    kind: 'defect',
    severity: 'high',
    title: 'An empty title is saved',
    location: 'List view › New item › Save',
    citation: 'spec.md: "a title is required"',
    detail: 'Saving with an empty title stored an untitled row; the spec asks for the button to refuse it.',
    reproStep: 'Open the list, press New item, leave the title empty, press Save.',
  },
  {
    kind: 'observation',
    severity: 'low',
    title: 'The list has no empty state',
    location: 'List view, with no items',
    citation: 'spec.md: out of scope',
    detail: 'With nothing saved the list is blank; the spec leaves an empty state for later.',
  },
]

/** A 1×1 PNG: the package's one screenshot, a picture the card can draw. */
const SHOT = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')

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

    const run = process.env.RUNCASTLE_SCENARIO_RUN || randomBytes(3).toString('hex')
    const feature = await createFeature(ctx, {
      projectId: project.id,
      title: `Scenario feature ${run}`,
      oneLiner: 'Seeded by the Feature at review scenario.',
    })
    const now = Date.now()

    const lead = createSessionRow(ctx, {
      featureId: feature.id,
      kind: 'chat',
      worktreePath: worktreeDir(project.id, feature.slug),
      model: { id: MODEL, runtime: 'claude-code' },
    })
    markSessionEnded(ctx, lead.id)

    // The Review worker: a drive review, on the host in the project's checkout, handed back.
    const review = createSessionRow(ctx, {
      featureId: feature.id,
      kind: 'worker',
      worktreePath: project.repoPath,
      model: { id: MODEL, runtime: 'claude-code' },
      openedBeside: lead.id,
    })
    setSessionTitle(ctx, review.id, 'Review')
    markSessionEnded(ctx, review.id)
    appendThreadEvent(review.id, { type: 'prompt', id: 'p_1', text: '# Review this feature', source: 'runcastle' })
    appendThreadEvent(review.id, { type: 'turn_started' })
    appendThreadEvent(review.id, { type: 'agent_text', messageId: 'm_1', text: 'Reviewed and handed back.' })
    appendThreadEvent(review.id, { type: 'turn_ended', reason: 'end_turn' })
    ctx.db
      .insert(workers)
      .values({
        id: review.id,
        featureId: feature.id,
        label: 'Review',
        purpose: 'Drives the feature for review',
        kind: 'review',
        goal: 'Drives the feature for review',
        doneWhen: null,
        model: MODEL,
        runtime: 'claude-code',
        startedBy: 'lead',
        status: 'handed-back',
        engine: 'docker',
        featureBranch: feature.branch,
        handbackSummary: ACCOUNT,
        handbackCommits: [],
        handbackFiles: [],
        reviewMode: 'drive',
        createdAt: now - 20 * MINUTE,
        updatedAt: now - 5 * MINUTE,
      })
      .run()

    // What it left: its findings, against itself, and one screenshot in its log.
    const worker = ctx.db.select().from(workers).all().find((w) => w.id === review.id)!
    const reported = FINDINGS.map((input) => reportFinding(ctx, { featureId: feature.id, reviewWorker: worker, input }).finding)
    startSaw(review.id)
    mkdirSync(reviewSawDir(review.id), { recursive: true })
    writeFileSync(reviewShotPath(review.id, 'shot-1.png'), SHOT)
    appendSaw(review.id, { kind: 'shot', at: now - 10 * MINUTE, caption: 'The list after saving a new item', image: 'shot-1.png' })

    // Its handback in the lead's chat: the Review Package card.
    appendThreadEvent(lead.id, {
      type: 'prompt',
      id: 'r_1',
      text: `[runcastle] Review worker "Review" handed back (worker ${review.id}). Findings: ${reported.map((f) => f.title).join('; ')}`,
      source: 'runcastle',
      display: { reviewPackage: { workerId: review.id, label: 'Review' } },
    })

    // The lead's own last word before the human drives: the declaration sets
    // the waiting reason to "ready to test", which is what puts it under Needs you.
    declareReady(ctx, feature.id, { scenario: 'review/feature-at-review.ts' })

    console.log(`ENTRY_URL=/p/${encodeURIComponent(project.id)}/f/${encodeURIComponent(feature.slug)}`)
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
  console.error(`[feature-at-review] ${e instanceof Error ? e.message : String(e)}`)
  process.exit(1)
}
