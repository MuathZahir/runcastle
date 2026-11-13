/**
 * Scenario: features returned to the human when autopilot ended
 * (docs/features/epics-on-autopilot, decisions 6, 8, 20).
 *
 * The project, became-yours-demo, holds one orchestrator chat, **Notes
 * Export** (blue, package). The human agreed its run plan and put it on
 * autopilot with two features, then ended autopilot from a lock note:
 *
 * - **Export as PDF** is the human's again. Its lead was told so, and re-asked
 *   its open question with `wait_for_you`: the row reads "Needs you · …",
 *   yellow, and its chat takes messages again.
 * - **Export as Markdown** is the human's again too, idle.
 *
 * The epic's chat ends on runcastle's line that the human ended autopilot.
 *
 * Run by the project's scenario runner (`bun {file}`) inside a test drive of
 * runcastle, with the drive identity, the `.runcastle/drive.env` overlay and a
 * fresh `RUNCASTLE_SCENARIO_RUN` in its env. It seeds the DRIVEN instance — the
 * overlay's `RUNCASTLE_DATA_DIR` — and prints the page of the feature that
 * became the human's as `ENTRY_URL=…`, which the drive resolves against its own URL.
 *
 * The project is a copy of the tiny-notes fixture (one commit) under
 * `feature-that-became-yours/` in the drive's data dir, so it goes away with
 * the drive. A second run reuses the project and seeds nothing twice.
 */
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { Project } from '../../../packages/core/src/schemas.ts'
import type { ThreadEvent, ThreadEventBody } from '../../../packages/core/src/thread.ts'
import { dbPath, worktreeDir } from '../../../packages/core/src/paths.ts'
import { loadConfig } from '../../../packages/core/src/config-load.ts'
import { createDb } from '../../../packages/server/src/db/client.ts'
import { runMigrations } from '../../../packages/server/src/db/migrate.ts'
import type { AppCtx } from '../../../packages/server/src/db/types.ts'
import { createFeature } from '../../../packages/server/src/services/features.ts'
import { setWait } from '../../../packages/server/src/services/waits.ts'
import { listProjects, openProject } from '../../../packages/server/src/services/projects.ts'
import { createSessionRow, markSessionEnded, projectSessions } from '../../../packages/server/src/launcher/sessions.ts'
import { seedThreadLog } from '../../../packages/server/src/threads/log.ts'
import { DRIVE_PREFIX, isDriveDataDir } from '../../drive-dir.ts'

const NAME = 'became-yours-demo'
const FIXTURE = resolve(import.meta.dirname, '..', '_fixtures', 'tiny-notes')
const MODEL = { id: 'claude-opus-5-5', runtime: 'claude-code' as const }
const MINUTE = 60_000

const EPIC = 'Notes Export'
const YOURS = 'Export as PDF'
const EPICS = 'Export as Markdown'
const QUESTION =
  'The brief does not say who gets the PDF. Should the export button be on every note for everyone, ' +
  'or only for notes you own?'

/** Only ever the drive's own tree — see feature-with-workers.ts. */
function driveDataDir(): string {
  const dir = process.env.RUNCASTLE_DATA_DIR
  if (!dir) throw new Error('RUNCASTLE_DATA_DIR is not set — run this inside a test drive')
  if (!isDriveDataDir(resolve(dir))) throw new Error(`refusing to seed ${resolve(dir)} — not a ${DRIVE_PREFIX}* data dir`)
  return resolve(dir)
}

function git(cwd: string, args: string[]): void {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr.trim()}`)
}

/** The project, in its own one-commit repo under the drive (never a registered namesake: features cut branches in it). */
async function demoProject(ctx: AppCtx, root: string): Promise<Project> {
  const repo = join(root, NAME)
  const known = listProjects(ctx).find((p) => resolve(p.repoPath) === resolve(repo))
  if (known) return known
  if (!existsSync(join(repo, '.git'))) {
    mkdirSync(repo, { recursive: true })
    cpSync(FIXTURE, repo, { recursive: true })
    // The drive's global git config is empty by design, so the identity is explicit.
    git(repo, ['init', '-b', 'main'])
    git(repo, ['add', '-A'])
    git(repo, ['-c', 'user.name=Scenario', '-c', 'user.email=scenario@example.com', 'commit', '-m', 'Initial commit'])
  }
  return openProject(ctx, repo)
}

/** One write straight to the drive's database: the backdating and look no service sets by itself. */
function exec(ctx: AppCtx, sql: string, ...params: (string | number | null)[]): void {
  ;(ctx.db as unknown as { $client: { run(sql: string, params: (string | number | null)[]): void } }).$client.run(sql, params)
}

/** One read straight from the drive's database. */
function one<T>(ctx: AppCtx, sql: string, ...params: (string | number | null)[]): T | null {
  const client = (ctx.db as unknown as { $client: { query(sql: string): { get(...params: (string | number | null)[]): T | null } } }).$client
  return client.query(sql).get(...params)
}

/** A log from `[seconds after at, body]` pairs. */
function log(at: number, bodies: [number, ThreadEventBody][]): ThreadEvent[] {
  return bodies.map(([seconds, body], i) => ({ ...body, i, at: at + seconds * 1000 }) as ThreadEvent)
}

async function seed(ctx: AppCtx, project: Project, now: number): Promise<string> {
  const epic = createSessionRow(ctx, { projectId: project.id, kind: 'project', worktreePath: project.repoPath, model: MODEL })
  exec(ctx, 'UPDATE sessions SET created_at = ?, epic_color = ?, epic_icon = ? WHERE id = ?', now - 90 * MINUTE, 'blue', 'package', epic.id)
  markSessionEnded(ctx, epic.id)

  // The epic cut both; autopilot is over, so neither is in a run and the epic's switch is off.
  const pdf = await createFeature(ctx, { projectId: project.id, title: YOURS, oneLiner: 'Download a note as a PDF.', chat: { threadId: epic.id } })
  const md = await createFeature(ctx, { projectId: project.id, title: EPICS, oneLiner: 'Download a note as Markdown.', chat: { threadId: epic.id } })
  for (const f of [pdf, md]) exec(ctx, 'UPDATE features SET created_at = ? WHERE id = ?', now - 85 * MINUTE, f.id)

  // The PDF lead was told it is the human's again, and re-asked its open question with wait_for_you.
  const lead = createSessionRow(ctx, { featureId: pdf.id, kind: 'chat', worktreePath: worktreeDir(project.id, pdf.slug), model: MODEL })
  markSessionEnded(ctx, lead.id)
  setWait(ctx, lead.id, 'Who gets the PDF export?')
  seedThreadLog(
    lead.id,
    log(now - 20 * MINUTE, [
      [0, { type: 'prompt', id: 'p_1', text: '[runcastle] Plan this feature by yourself.', source: 'runcastle', display: { summary: 'Started automatic planning for this feature' } }],
      [1, { type: 'turn_started' }],
      [40, { type: 'agent_text', messageId: 'm_1', text: 'I read the brief and the notes screen. The export itself is clear; one thing is not mine to decide, so I asked the epic.' }],
      [41, { type: 'turn_ended', reason: 'end_turn' }],
      [600, {
        type: 'prompt',
        id: 'p_2',
        text: "[runcastle] This feature is the human's again: autopilot is off for it. Re-ask any open question with wait_for_you.",
        source: 'runcastle',
      }],
      [601, { type: 'turn_started' }],
      [620, { type: 'agent_text', messageId: 'm_2', text: QUESTION }],
      [621, { type: 'turn_ended', reason: 'end_turn' }],
    ]),
  )

  // The epic: the run plan and the human's yes, autopilot on, then the human ending it from a lock note.
  seedThreadLog(
    epic.id,
    log(now - 90 * MINUTE, [
      [0, { type: 'prompt', id: 'p_1', text: 'Notes should export as PDF and as Markdown. Take both to ready to merge while I sleep.', source: 'human' }],
      [1, { type: 'turn_started' }],
      [2, { type: 'title', title: EPIC, by: 'orchestrator' }],
      [20, { type: 'feature_acted', featureId: pdf.id, title: YOURS, action: 'created' }],
      [21, { type: 'feature_acted', featureId: md.id, title: EPICS, action: 'created' }],
      [30, { type: 'agent_text', messageId: 'm_1', text: 'Run plan: I plan both myself and take them to ready to merge, one at a time. Say yes and I go on autopilot.' }],
      [31, { type: 'turn_ended', reason: 'end_turn' }],
      [60, { type: 'prompt', id: 'p_2', text: 'Yes, go on autopilot.', source: 'human' }],
      [61, { type: 'turn_started' }],
      [62, { type: 'feature_acted', featureId: pdf.id, title: YOURS, action: 'autopilotOn' }],
      [63, { type: 'feature_acted', featureId: md.id, title: EPICS, action: 'autopilotOn' }],
      [70, { type: 'agent_text', messageId: 'm_2', text: 'On autopilot with both. I will post one summary when the run plan is done.' }],
      [71, { type: 'turn_ended', reason: 'end_turn' }],
      [70 * 60, {
        type: 'prompt',
        id: 'p_3',
        text:
          `[runcastle] The human ended autopilot for this epic from a feature's lock note. ${pdf.slug}, ${md.slug} are the human's again; ` +
          'stop answering for them, and do not message, drive or merge them. Their leads re-ask what is open in their own chats.',
        source: 'runcastle',
        display: { summary: 'You ended autopilot' },
      }],
      [70 * 60 + 1, { type: 'turn_started' }],
      [70 * 60 + 10, { type: 'agent_text', messageId: 'm_3', text: `Autopilot is off. ${YOURS} asks you who gets the PDF: answer in its chat.` }],
      [70 * 60 + 11, { type: 'turn_ended', reason: 'end_turn' }],
    ]),
  )
  return pdf.slug
}

async function main(): Promise<void> {
  const dataDir = driveDataDir()
  process.env.RUNCASTLE_DATA_DIR = dataDir
  const db = createDb(dbPath())
  try {
    runMigrations(db)
    const ctx: AppCtx = { db, config: loadConfig() }
    const project = await demoProject(ctx, join(dataDir, 'feature-that-became-yours'))
    const seeded = projectSessions(ctx, project.id, 'project').length > 0
    const slug = seeded
      ? one<{ slug: string }>(ctx, 'SELECT slug FROM features WHERE project_id = ? AND title = ?', project.id, YOURS)?.slug
      : await seed(ctx, project, Date.now())
    if (!slug) throw new Error(`${YOURS} is missing from a project seeded before`)
    console.log(`ENTRY_URL=/p/${encodeURIComponent(project.id)}/f/${encodeURIComponent(slug)}`)
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
  console.error(`[feature-that-became-yours] ${e instanceof Error ? e.message : String(e)}`)
  process.exit(1)
}
