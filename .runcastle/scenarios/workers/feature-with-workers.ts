/**
 * Scenario: a feature in runcastle-demo whose lead has handed work to workers,
 * one in every status — two needing the human, two working, one queued, one
 * handed back, one landed, one dropped, one failed — beside one old side chat
 * from before workers. The lead's chat holds the handbacks and the failure as
 * runcastle's lines, so its cards draw (interactive-workers decisions 3, 21, 23,
 * 24), and the turns that started the workers, so its "Started N workers" cards
 * draw with each worker's live status (calmer-worker-chats decision 6).
 *
 * Run by the project's scenario runner (`bun {file}`) inside a test drive of
 * runcastle, with the drive identity, the `.runcastle/drive.env` overlay and a
 * fresh `RUNCASTLE_SCENARIO_RUN` in its env. It seeds the DRIVEN instance — the
 * overlay's `RUNCASTLE_DATA_DIR`, through this checkout's own services — and
 * prints the inner runcastle's page for that feature as `ENTRY_URL=…`, which
 * the drive resolves against its own URL.
 *
 * The workers are rows only: no container is started, so a worker's preview
 * and its agent do not answer. The page's lanes, the worker chats' assignment
 * cards and headers, and the lead's handback cards are what this lands on.
 *
 * `SCENARIO_PROJECT` names a different project to seed (tests register a temp
 * repo under its own name).
 */
import { randomBytes } from 'node:crypto'
import { basename, resolve } from 'node:path'
import type { Feature, WorkerKind, WorkerRow, WorkerStatus } from '../../../packages/core/src/schemas.ts'
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

/** One seeded worker: what its row says, and the human's and its own first words. */
interface SeededWorker {
  label: string
  purpose: string
  kind: WorkerKind
  status: WorkerStatus
  /** How long ago it started, in minutes: the order inside its lane. */
  ago: number
  failure?: string
  handback?: { summary: string; commits: string[]; files: string[] }
  outcome?: { kind: 'landed' | 'sent-back' | 'dropped'; note?: string }
}

const WORKERS: SeededWorker[] = [
  { label: 'Header', purpose: 'The sidebar header: back, title and "+"', kind: 'with-you', status: 'needs-you', ago: 40 },
  { label: 'Thread list', purpose: 'Rows grouped by status, done folded', kind: 'with-you', status: 'needs-you', ago: 38 },
  { label: 'Worker list data', purpose: 'Group and order workers by status', kind: 'on-its-own', status: 'working', ago: 36 },
  { label: 'Amber dot rule', purpose: 'Light the feature row while a worker needs you', kind: 'on-its-own', status: 'working', ago: 34 },
  { label: 'Empty states', purpose: 'What the page says with no workers', kind: 'on-its-own', status: 'queued', ago: 5 },
  {
    label: 'Handback card',
    purpose: 'The card the lead reads a handback in',
    kind: 'with-you',
    status: 'handed-back',
    ago: 90,
    handback: {
      // Several paragraphs, so the card shows its first and folds the rest behind "Show more" (calmer-worker-chats decision 2).
      summary: [
        'The card shows the summary, the commit count and the files, folded. **You asked** for the link to the worker on the right.',
        '## What I built',
        '- The card itself, in `WorkerParts.tsx`, with its header, summary and files.\n- The link to the worker, on the right of the header.',
        '## What I tested',
        '- A handback with no files, one file and many.\n- The link opens the worker’s chat.',
      ].join('\n\n'),
      commits: ['a1b2c3d Handback card layout', 'd4e5f6a Link to the worker'],
      files: ['apps/web/src/components/workers/WorkerParts.tsx', 'apps/web/test/worker-cards.test.tsx'],
    },
  },
  {
    label: 'Status words',
    purpose: 'The words each status reads as',
    kind: 'on-its-own',
    status: 'landed',
    ago: 180,
    handback: {
      summary: 'Every status has its words and its dot; the tests pass.',
      commits: ['0a1b2c3 Status words and tones'],
      files: ['apps/web/src/lib/workers.ts'],
    },
    outcome: { kind: 'landed' },
  },
  {
    label: 'Old shelf spacing',
    purpose: 'Tighten the shelf spacing',
    kind: 'on-its-own',
    status: 'dropped',
    ago: 240,
    handback: { summary: 'Shelves sit 16px apart.', commits: ['9f8e7d6 Shelf spacing'], files: ['apps/web/src/components/SidebarParts.tsx'] },
    outcome: { kind: 'dropped' },
  },
  { label: 'Search box', purpose: 'Filter the worker list', kind: 'on-its-own', status: 'failed', ago: 60, failure: 'its container stopped unexpectedly' },
]

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

/** A finished exchange in a thread's log: the human's words, then the agent's answer. */
function exchange(threadId: string, n: number, human: string, agent: string): void {
  appendThreadEvent(threadId, { type: 'prompt', id: `p_${n}`, text: human, source: 'human' })
  appendThreadEvent(threadId, { type: 'turn_started' })
  appendThreadEvent(threadId, { type: 'agent_text', messageId: `m_${n}`, text: agent })
  appendThreadEvent(threadId, { type: 'turn_ended', reason: 'end_turn' })
}

/**
 * A lead's turn that starts workers: its `start_worker` calls, its words, then a
 * `worker_started` event per worker, as the worker service appends them — the
 * chat folds them into one "Started N workers" card (calmer-worker-chats decision 6).
 */
function leadStarts(leadId: string, n: number, human: string, agent: string, started: { id: string; w: SeededWorker }[]): void {
  appendThreadEvent(leadId, { type: 'prompt', id: `p_${n}`, text: human, source: 'human' })
  appendThreadEvent(leadId, { type: 'turn_started' })
  for (const { id } of started) {
    appendThreadEvent(leadId, { type: 'tool', call: { id: `start_${id}`, kind: 'other', title: 'mcp__runcastle__start_worker', status: 'completed' } })
  }
  appendThreadEvent(leadId, { type: 'agent_text', messageId: `m_${n}`, text: agent })
  for (const { id, w } of started) {
    appendThreadEvent(leadId, { type: 'worker_started', workerId: id, label: w.label, purpose: w.purpose, kind: w.kind })
  }
  appendThreadEvent(leadId, { type: 'turn_ended', reason: 'end_turn' })
}

/** Runcastle's line to the lead, as the worker service delivers it. */
function toLead(leadId: string, n: number, text: string, display: PromptDisplay): void {
  appendThreadEvent(leadId, { type: 'prompt', id: `r_${n}`, text: `[runcastle] ${text}`, source: 'runcastle', display })
}

/** A worker's thread and its row, settled in `w.status`, with no sandbox. */
function seedWorker(ctx: AppCtx, feature: Feature, leadId: string, w: SeededWorker, now: number): WorkerRow['id'] {
  const session = createSessionRow(ctx, {
    featureId: feature.id,
    kind: 'worker',
    worktreePath: worktreeDir(feature.projectId, feature.slug),
    model: { id: MODEL, runtime: 'claude-code' },
    openedBeside: leadId,
  })
  setSessionTitle(ctx, session.id, w.label)
  markSessionEnded(ctx, session.id)
  exchange(session.id, 1, `Start your assignment: ${w.purpose}`, `On it: ${w.purpose.toLowerCase()}.`)
  const createdAt = now - w.ago * MINUTE
  ctx.db
    .insert(workers)
    .values({
      id: session.id,
      featureId: feature.id,
      projectId: feature.projectId,
      label: w.label,
      purpose: w.purpose,
      kind: w.kind,
      goal: w.purpose,
      doneWhen: w.kind === 'with-you' ? 'The human is happy with it' : 'Its tests pass',
      model: MODEL,
      runtime: 'claude-code',
      startedBy: 'lead',
      status: w.status,
      failure: w.failure ?? null,
      engine: 'docker',
      featureBranch: feature.branch,
      handbackSummary: w.handback?.summary ?? null,
      handbackCommits: w.handback?.commits ?? null,
      handbackFiles: w.handback?.files ?? null,
      outcome: w.outcome?.kind ?? null,
      outcomeNote: w.outcome?.note ?? null,
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

    const project = listProjects(ctx).find(
      (p) => p.name === PROJECT || basename(p.repoPath) === PROJECT,
    )
    if (!project) throw new Error(`${PROJECT} is not registered in this drive's data dir`)

    const run = process.env.RUNCASTLE_SCENARIO_RUN || randomBytes(3).toString('hex')
    const feature = await createFeature(ctx, {
      projectId: project.id,
      title: `Workers feature ${run}`,
      oneLiner: 'Seeded by the Feature with workers scenario.',
    })
    const worktree = worktreeDir(project.id, feature.slug)
    const now = Date.now()

    // The lead's chat: the plan the human said yes to, which started the workers.
    const lead = createSessionRow(ctx, { featureId: feature.id, kind: 'chat', worktreePath: worktree, model: { id: MODEL, runtime: 'claude-code' } })
    markSessionEnded(ctx, lead.id)
    const seeded = WORKERS.map((w) => ({ id: seedWorker(ctx, feature, lead.id, w, now), w }))
    // The plan's turn started all but the newest; a later turn, after the handbacks, started that one.
    const later = seeded.filter(({ w }) => w.status === 'queued')
    leadStarts(
      lead.id,
      1,
      'The plan looks right. Go.',
      'Started the workers: the header and the thread list with you, the data changes on their own. I will land each handback as it comes.',
      seeded.filter((s) => !later.includes(s)),
    )

    let line = 0
    for (const { id, w } of seeded) {
      if (w.handback) {
        toLead(lead.id, ++line, `Worker "${w.label}" handed back.`, {
          handback: { workerId: id, label: w.label, kind: w.kind, ...w.handback, threadId: id },
        })
      }
      if (w.failure) {
        toLead(lead.id, ++line, `Worker "${w.label}" failed: ${w.failure}`, {
          workerFailed: { workerId: id, label: w.label, failure: w.failure },
        })
      }
    }
    leadStarts(lead.id, 2, 'What about the empty page?', 'Started one more worker for the empty states; it waits for a slot.', later)

    // A side chat from before workers: listed in Done, read-only (decision 23).
    const side = createSessionRow(ctx, { featureId: feature.id, kind: 'side', worktreePath: worktree, openedBeside: lead.id })
    setSessionTitle(ctx, side.id, 'Why is the PDF font blurry?')
    markSessionEnded(ctx, side.id)
    exchange(side.id, 1, 'Why is the PDF font blurry?', 'The export rasterises at 72 dpi; rendering at 2x fixes it.')

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
  console.error(`[feature-with-workers] ${e instanceof Error ? e.message : String(e)}`)
  process.exit(1)
}
