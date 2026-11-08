/**
 * Scenario: a feature in runcastle-demo with its drive's two workers beside an
 * ordinary one (drive-chats-become-workers decisions 2, 3, 10, 11): a build
 * worker working, the Scenarios worker needing the human with a chat that ends
 * on the branch it committed on, the Fix-drive worker handed back with its
 * quiet card held in the lead's chat, and one old Fix-drive chat from before
 * workers. Beside the feature, the project's own Scenarios worker, handed back
 * on main from a project drive.
 *
 * Run by the project's scenario runner (`bun {file}`) inside a test drive of
 * runcastle, with the drive identity, the `.runcastle/drive.env` overlay and a
 * fresh `RUNCASTLE_SCENARIO_RUN` in its env. It seeds the DRIVEN instance — the
 * overlay's `RUNCASTLE_DATA_DIR`, through this checkout's own services — and
 * prints the inner runcastle's page for that feature as `ENTRY_URL=…`, which
 * the drive resolves against its own URL.
 *
 * Rows only: no agent runs and no drive is held, so a message to a drive
 * worker is refused. The sidebar's worker lanes, the drive workers' chats with
 * their headers and assignment cards, the old drive chat's read-only note and
 * the lead's handback card naming the branch are what this lands on.
 *
 * `SCENARIO_PROJECT` names a different project to seed (tests register a temp
 * repo under its own name).
 */
import { randomBytes } from 'node:crypto'
import { basename, resolve } from 'node:path'
import type { WorkerKind, WorkerRow, WorkerStatus } from '../../../packages/core/src/schemas.ts'
import { workers } from '../../../packages/core/src/db-schema.ts'
import { dbPath, worktreeDir } from '../../../packages/core/src/paths.ts'
import { loadConfig } from '../../../packages/core/src/config-load.ts'
import { createDb } from '../../../packages/server/src/db/client.ts'
import { runMigrations } from '../../../packages/server/src/db/migrate.ts'
import type { AppCtx } from '../../../packages/server/src/db/types.ts'
import { createSessionRow, markSessionEnded, setSessionTitle } from '../../../packages/server/src/launcher/sessions.ts'
import { createFeature } from '../../../packages/server/src/services/features.ts'
import { listProjects } from '../../../packages/server/src/services/projects.ts'
import { appendThreadEvent } from '../../../packages/server/src/threads/log.ts'
import { DRIVE_PREFIX, isDriveDataDir } from '../../drive-dir.ts'

const PROJECT = process.env.SCENARIO_PROJECT || 'runcastle-demo'
const MODEL = 'claude-opus-5-5'
const MINUTE = 60_000

/** One seeded worker row, owned by a feature or (featureId null) by the project. */
interface SeededWorker {
  featureId: string | null
  projectId: string
  label: string
  purpose: string
  kind: WorkerKind
  status: WorkerStatus
  startedBy: WorkerRow['startedBy']
  /** The branch it works on: the feature's, or the one a project drive drove. */
  branch: string
  /** How long ago it started, in minutes: the order inside its lane. */
  ago: number
  goal?: string
  handback?: { summary: string; commits: string[]; files: string[] }
}

/** Only ever the drive's own tree; unset, the path helpers would fall back to the developer's real `~/.runcastle`. */
function driveDataDir(): string {
  const dir = process.env.RUNCASTLE_DATA_DIR
  if (!dir) throw new Error('RUNCASTLE_DATA_DIR is not set — run this inside a test drive')
  if (!isDriveDataDir(resolve(dir))) {
    throw new Error(`refusing to seed ${resolve(dir)} — not a ${DRIVE_PREFIX}* data dir`)
  }
  return resolve(dir)
}

/** A finished exchange in a thread's log: the human's words, then the agent's answer. */
function exchange(threadId: string, n: number, human: string, agent: string): void {
  appendThreadEvent(threadId, { type: 'prompt', id: `p_${n}`, text: human, source: 'human' })
  appendThreadEvent(threadId, { type: 'turn_started' })
  appendThreadEvent(threadId, { type: 'agent_text', messageId: `m_${n}`, text: agent })
  appendThreadEvent(threadId, { type: 'turn_ended', reason: 'end_turn' })
}

/** A worker's thread and its row, settled in `w.status`, with no sandbox and no agent. */
function seedWorker(ctx: AppCtx, w: SeededWorker, worktreePath: string, now: number, openedBeside?: string): WorkerRow['id'] {
  const session = createSessionRow(ctx, {
    ...(w.featureId ? { featureId: w.featureId } : { projectId: w.projectId }),
    kind: 'worker',
    worktreePath,
    model: { id: MODEL, runtime: 'claude-code' },
    ...(openedBeside ? { openedBeside } : {}),
  })
  setSessionTitle(ctx, session.id, w.label)
  markSessionEnded(ctx, session.id)
  const createdAt = now - w.ago * MINUTE
  ctx.db
    .insert(workers)
    .values({
      id: session.id,
      featureId: w.featureId,
      projectId: w.projectId,
      label: w.label,
      purpose: w.purpose,
      kind: w.kind,
      goal: w.goal ?? null,
      doneWhen: w.goal ? 'Its tests pass' : null,
      model: MODEL,
      runtime: 'claude-code',
      startedBy: w.startedBy,
      status: w.status,
      failure: null,
      engine: 'docker',
      featureBranch: w.branch,
      handbackSummary: w.handback?.summary ?? null,
      handbackCommits: w.handback?.commits ?? null,
      handbackFiles: w.handback?.files ?? null,
      outcome: null,
      outcomeNote: null,
      createdAt,
      updatedAt: createdAt + MINUTE,
    })
    .run()
  return session.id
}

async function main(): Promise<void> {
  process.env.RUNCASTLE_DATA_DIR = driveDataDir()
  const db = createDb(dbPath())
  try {
    runMigrations(db)
    const ctx: AppCtx = { db, config: loadConfig() }

    const project = listProjects(ctx).find((p) => p.name === PROJECT || basename(p.repoPath) === PROJECT)
    if (!project) throw new Error(`${PROJECT} is not registered in this drive's data dir`)

    const run = process.env.RUNCASTLE_SCENARIO_RUN || randomBytes(3).toString('hex')
    const feature = await createFeature(ctx, {
      projectId: project.id,
      title: `Drive workers feature ${run}`,
      oneLiner: 'Seeded by the Feature with drive workers scenario.',
    })
    const worktree = worktreeDir(project.id, feature.slug)
    const now = Date.now()
    const owner = { featureId: feature.id, projectId: project.id, branch: feature.branch }

    // The lead's chat: the plan the human said yes to, which started the build worker.
    const lead = createSessionRow(ctx, { featureId: feature.id, kind: 'chat', worktreePath: worktree, model: { id: MODEL, runtime: 'claude-code' } })
    markSessionEnded(ctx, lead.id)
    exchange(lead.id, 1, 'The plan looks right. Go.', 'Started a worker on the coupon form. Take it for a drive whenever you like.')

    seedWorker(
      ctx,
      { ...owner, label: 'Coupon form', purpose: 'The form that applies a coupon', kind: 'on-its-own', status: 'working', startedBy: 'lead', ago: 30, goal: 'Apply a coupon at checkout' },
      worktree,
      now,
      lead.id,
    )

    // The Scenarios worker, waiting on the human: its last turn committed a scenario and named the branch.
    const scenarios = seedWorker(
      ctx,
      { ...owner, label: 'Scenarios', purpose: 'Writes and fixes this drive’s scenarios', kind: 'scenario', status: 'needs-you', startedBy: 'human', ago: 8 },
      project.repoPath,
      now,
    )
    exchange(
      scenarios,
      1,
      'A signed-in shopper with an expired coupon in the cart.',
      `Wrote \`.runcastle/scenarios/expired-coupon.ts\` and ran it: the cart shows the expired coupon. Committed it on \`${feature.branch}\` (b7c8d9e Expired-coupon scenario). Want a variant with a valid one?`,
    )

    // The Fix-drive worker, handed back once the app answered again, its card held for the lead's next message.
    const fixHandback = {
      summary: 'The setup script waited on a port the database never opened; it now reads the port from `drive.env`. The app answers again.',
      commits: ['c4d5e6f Read the database port from drive.env'],
      files: ['.runcastle/drive-setup.sh'],
    }
    const fixDrive = seedWorker(
      ctx,
      { ...owner, label: 'Fix drive', purpose: 'Fixes this drive’s setup', kind: 'fix-drive', status: 'handed-back', startedBy: 'human', ago: 20, handback: fixHandback },
      project.repoPath,
      now,
    )
    exchange(fixDrive, 1, 'The test drive’s setup failed; you pressed Fix drive', `Fixed the port in \`.runcastle/drive-setup.sh\` and committed it on \`${feature.branch}\`. Retried the drive: the app answers.`)
    appendThreadEvent(lead.id, {
      type: 'prompt',
      id: 'r_1',
      text: `[runcastle] Drive worker "Fix drive" handed back (worker ${fixDrive}). Its commits are already on ${feature.branch}: nothing waits to land.`,
      source: 'runcastle',
      held: true,
      display: { handback: { workerId: fixDrive, label: 'Fix drive', kind: 'fix-drive', ...fixHandback, threadId: fixDrive, branch: feature.branch } },
    })

    // A Fix-drive chat from before workers: listed in Done as an old drive chat, read-only (decision 10).
    const old = createSessionRow(ctx, { featureId: feature.id, kind: 'drive-fix', worktreePath: project.repoPath })
    setSessionTitle(ctx, old.id, 'Fix the seed step')
    markSessionEnded(ctx, old.id)
    exchange(old.id, 1, 'The seed step failed.', 'The seed ran before the migration; I reordered the two in `.runcastle/drive-setup.sh`.')

    // The project's own Scenarios worker, handed back from a project drive of main (decision 2).
    const projectScenarios = seedWorker(
      ctx,
      {
        featureId: null,
        projectId: project.id,
        branch: 'main',
        label: 'Scenarios',
        purpose: 'Writes and fixes this drive’s scenarios',
        kind: 'scenario',
        status: 'handed-back',
        startedBy: 'human',
        ago: 120,
        handback: {
          summary: 'The drive stopped.\n\nWrote the signed-out scenario and set the runner to `bun {file}`.',
          commits: ['a1b2c3d Signed-out scenario'],
          files: ['.runcastle/scenarios/signed-out.ts'],
        },
      },
      project.repoPath,
      now,
    )
    exchange(projectScenarios, 1, 'A signed-out visitor on the home page.', 'Wrote `.runcastle/scenarios/signed-out.ts` and committed it on `main` (a1b2c3d Signed-out scenario).')

    console.log(`ENTRY_URL=/p/${encodeURIComponent(project.id)}/f/${encodeURIComponent(feature.slug)}`)
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
  console.error(`[feature-with-drive-workers] ${e instanceof Error ? e.message : String(e)}`)
  process.exit(1)
}
