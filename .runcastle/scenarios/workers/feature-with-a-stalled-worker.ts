/**
 * Scenario: a feature in runcastle-demo with one "on its own" worker that
 * stalled (a-worker-never-shows-working-with-nothing-running decisions 4–6):
 * its turn ended without a handback, runcastle nudged it once in its own chat,
 * and the turn the nudge opened ended quietly too. The worker reads "Stalled ·
 * stopped twice without handing back" in amber under the feature's sidebar row
 * and in its chat's header, and the lead's chat holds runcastle's stalled
 * notice with "Open its chat".
 *
 * Run like feature-with-workers.ts (see it for the drive, the env and what
 * `ENTRY_URL=` means): the scenario runner (`bun {file}`) inside a test drive
 * of runcastle, seeding the drive's own data dir. The worker is a row only: no
 * agent is started, so it does not answer.
 *
 * `SCENARIO_PROJECT` names a different project to seed (tests register a temp
 * repo under its own name).
 */
import { randomBytes } from 'node:crypto'
import { basename, resolve } from 'node:path'
import type { Feature, WorkerRow } from '../../../packages/core/src/schemas.ts'
import type { PromptDisplay } from '../../../packages/core/src/thread.ts'
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

const WORKER = {
  label: 'Worker list data',
  purpose: 'Group and order workers by status',
  kind: 'on-its-own' as const,
}

/**
 * Runcastle's nudge, as the worker service sends it to an "on its own" worker
 * (`workerNudgeText` in packages/server/src/workers/service.ts), and what its
 * chat shows of it.
 */
const NUDGE =
  '[runcastle] Your turn ended without a handback. Carry on with your assignment. ' +
  'When it is done, hand back; if you are blocked on the human, call wait_for_you.'
const NUDGE_DISPLAY = 'Turn ended without a handback: runcastle nudged it to carry on'

/** Only ever the drive's own tree (see feature-with-workers.ts). */
function driveDataDir(): string {
  const dir = process.env.RUNCASTLE_DATA_DIR
  if (!dir) throw new Error('RUNCASTLE_DATA_DIR is not set — run this inside a test drive')
  if (!isDriveDataDir(resolve(dir))) {
    throw new Error(`refusing to seed ${resolve(dir)} — not a ${DRIVE_PREFIX}* data dir`)
  }
  return resolve(dir)
}

/** One finished turn in a worker's chat: runcastle's prompt, then the agent's words, ending with no handback. */
function quietTurn(threadId: string, n: number, text: string, agent: string, display?: PromptDisplay): void {
  appendThreadEvent(threadId, { type: 'prompt', id: `p_${n}`, text, source: 'runcastle', ...(display ? { display } : {}) })
  appendThreadEvent(threadId, { type: 'turn_started' })
  appendThreadEvent(threadId, { type: 'agent_text', messageId: `m_${n}`, text: agent })
  appendThreadEvent(threadId, { type: 'turn_ended', reason: 'end_turn' })
}

/** The stalled worker's chat and row: its assignment, a quiet turn, the nudge, another quiet turn. */
function seedStalledWorker(ctx: AppCtx, feature: Feature, leadId: string, now: number): WorkerRow['id'] {
  const session = createSessionRow(ctx, {
    featureId: feature.id,
    kind: 'worker',
    worktreePath: worktreeDir(feature.projectId, feature.slug),
    model: { id: MODEL, runtime: 'claude-code' },
    openedBeside: leadId,
  })
  setSessionTitle(ctx, session.id, WORKER.label)
  markSessionEnded(ctx, session.id)
  quietTurn(
    session.id,
    1,
    `Start your assignment: ${WORKER.purpose}. Done when its tests pass; then hand back.`,
    'Read the worker list code. The grouping lives in `workerGroups`; I will order each lane by status next.',
  )
  quietTurn(session.id, 2, NUDGE, 'Looked at the lane order again. The queued workers should sort last.', { summary: NUDGE_DISPLAY })
  const createdAt = now - 50 * MINUTE
  ctx.db
    .insert(workers)
    .values({
      id: session.id,
      featureId: feature.id,
      projectId: feature.projectId,
      label: WORKER.label,
      purpose: WORKER.purpose,
      kind: WORKER.kind,
      goal: WORKER.purpose,
      doneWhen: 'Its tests pass',
      model: MODEL,
      runtime: 'claude-code',
      startedBy: 'lead',
      status: 'stalled',
      failure: null,
      folder: worktreeDir(feature.projectId, feature.slug),
      featureBranch: feature.branch,
      handbackSummary: null,
      handbackCommits: null,
      handbackFiles: null,
      outcome: null,
      outcomeNote: null,
      createdAt,
      updatedAt: now - 5 * MINUTE,
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

    const project = listProjects(ctx).find(
      (p) => p.name === PROJECT || basename(p.repoPath) === PROJECT,
    )
    if (!project) throw new Error(`${PROJECT} is not registered in this drive's data dir`)

    const run = process.env.RUNCASTLE_SCENARIO_RUN || randomBytes(3).toString('hex')
    const feature = await createFeature(ctx, {
      projectId: project.id,
      title: `Stalled worker ${run}`,
      oneLiner: 'Seeded by the Feature with a stalled worker scenario.',
    })
    const worktree = worktreeDir(project.id, feature.slug)
    const now = Date.now()

    // The lead's chat: the turn that started the worker, then runcastle's stalled notice.
    const lead = createSessionRow(ctx, { featureId: feature.id, kind: 'chat', worktreePath: worktree, model: { id: MODEL, runtime: 'claude-code' } })
    markSessionEnded(ctx, lead.id)
    const id = seedStalledWorker(ctx, feature, lead.id, now)

    appendThreadEvent(lead.id, { type: 'prompt', id: 'p_1', text: 'The plan looks right. Go.', source: 'human' })
    appendThreadEvent(lead.id, { type: 'turn_started' })
    appendThreadEvent(lead.id, { type: 'tool', call: { id: `start_${id}`, kind: 'other', title: 'mcp__runcastle__start_worker', status: 'completed' } })
    appendThreadEvent(lead.id, { type: 'agent_text', messageId: 'm_1', text: 'Started a worker on the worker list data; it hands back when its tests pass.' })
    appendThreadEvent(lead.id, { type: 'worker_started', workerId: id, label: WORKER.label, purpose: WORKER.purpose, kind: WORKER.kind })
    appendThreadEvent(lead.id, { type: 'turn_ended', reason: 'end_turn' })

    // Runcastle's line to the lead, as the worker service's stallWorker delivers it.
    appendThreadEvent(lead.id, {
      type: 'prompt',
      id: 'r_1',
      text:
        `[runcastle] Worker "${WORKER.label}" stalled (worker ${id}): its turn ended without a handback twice, the second time after runcastle nudged it. ` +
        'Nothing of it is running.\n\n' +
        `Next: read its chat, then message_worker({ workerId: "${id}", text }) with what to do (that counts as a try), ` +
        `drop_worker({ workerId: "${id}" }), or do the job yourself.`,
      source: 'runcastle',
      display: { workerStalled: { workerId: id, label: WORKER.label } },
    })

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
  console.error(`[feature-with-a-stalled-worker] ${e instanceof Error ? e.message : String(e)}`)
  process.exit(1)
}
