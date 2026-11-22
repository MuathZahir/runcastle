/**
 * Scenario: one project whose epic list shows epics in each state, beside the
 * coloured cards, tinted slim idle rows and dotted New epic slot of
 * docs/features/epics-that-look-alive.
 *
 * The project, epics-demo, holds four orchestrator chats (epics), each with its
 * own colour and icon:
 *
 * - **Notes Sync** (teal, database) has one feature in progress and one whose
 *   plan waits for the human's yes (that feature's own row reads Needs you).
 *   The epic itself needs the human too: the orchestrator asked a question
 *   with `wait_for_you`, so its card carries the amber dot.
 * - **Dark Mode**, **Search** and **Release Tooling** are idle: slim rows,
 *   having shipped a few features each (Release Tooling none, and no icon yet).
 *
 * Nothing runs (a scenario starts no agent), so the chats read at rest and the
 * in-motion features read Idle rather than Working.
 *
 * Run by the project's scenario runner (`bun {file}`) inside a test drive of
 * runcastle, with the drive identity, the `.runcastle/drive.env` overlay and a
 * fresh `RUNCASTLE_SCENARIO_RUN` in its env. It seeds the DRIVEN instance — the
 * overlay's `RUNCASTLE_DATA_DIR` — and prints the page of Conflict handling (a
 * feature waiting for the human, with the sidebar beside it) as `ENTRY_URL=…`, which the drive
 * resolves against its own URL.
 *
 * The project is a copy of the tiny-notes fixture (one commit) under
 * `epics-in-all-states/` in the drive's data dir, so it goes away with the
 * drive. A second run reuses the project and finds its features by name,
 * seeding nothing twice.
 */
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { EpicColor, EpicIconId } from '../../../packages/core/src/epic-look.ts'
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

const NAME = 'epics-demo'
const FIXTURE = resolve(import.meta.dirname, '..', '_fixtures', 'tiny-notes')
const MODEL = { id: 'claude-opus-5-5', runtime: 'claude-code' as const }
const MINUTE = 60_000
const HOUR = 60 * MINUTE

/** The feature the drive opens on. */
const ENTRY = 'Conflict handling'

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

/** What each seeded feature becomes. */
type FeatureSeed =
  | { title: string; as: 'shipped' }
  | {
      title: string
      as: 'active'
      /** Its lead waits on the human, so its own row needs them. */
      waiting?: string
    }
  | { title: string; as: 'up-next' }

interface EpicSeed {
  name: string
  color: EpicColor
  icon: EpicIconId | null
  /** When the chat was started, and when the human last wrote in it, before now. */
  startedAgo: number
  wroteAgo: number
  /** The conversation, the human's words and the orchestrator's answers in turn. */
  turns: { said: string; answered: string }[]
  /** The chat's own `wait_for_you` line: only its agent's call makes the epic need the human. */
  asks?: string
  features: FeatureSeed[]
}

const EPICS: EpicSeed[] = [
  {
    name: 'Notes Sync',
    color: 'teal',
    icon: 'database',
    startedAgo: 5 * HOUR,
    wroteAgo: 40 * MINUTE,
    turns: [
      {
        said: 'Notes should sync between my laptop and my phone.',
        answered: 'Cut into three: the sync engine, conflict handling and offline edits. Start them in their own chats when you like.',
      },
    ],
    asks: 'Which feature first? Pick one',
    features: [
      { title: 'Sync engine', as: 'active' },
      { title: 'Conflict handling', as: 'active', waiting: 'Plan ready for your yes' },
      { title: 'Offline edits', as: 'up-next' },
    ],
  },
  {
    name: 'Dark Mode',
    color: 'amber',
    icon: 'palette',
    startedAgo: 2 * 24 * HOUR,
    wroteAgo: 20 * MINUTE,
    turns: [{ said: 'Add a dark theme that follows the system setting.', answered: 'Both shipped: the dark theme and the system-setting switch.' }],
    features: [
      { title: 'Dark theme', as: 'shipped' },
      { title: 'Follow the system theme', as: 'shipped' },
    ],
  },
  {
    name: 'Search',
    color: 'green',
    icon: 'compass',
    startedAgo: 3 * 24 * HOUR,
    wroteAgo: 3 * HOUR,
    turns: [{ said: 'Find notes by any word in them, fast.', answered: 'Shipped: full-text search, highlighted matches and search-as-you-type.' }],
    features: [
      { title: 'Full-text search', as: 'shipped' },
      { title: 'Highlight matches', as: 'shipped' },
      { title: 'Search as you type', as: 'shipped' },
    ],
  },
  {
    name: 'Release Tooling',
    color: 'rust',
    icon: null,
    startedAgo: 5 * 24 * HOUR,
    wroteAgo: 20 * HOUR,
    turns: [
      {
        said: 'What would it take to publish releases from CI?',
        answered: 'Two pieces: a changelog from the commits and a tagged build. Nothing to cut yet; say when.',
      },
    ],
    features: [],
  },
]

/** A log from `[seconds after at, body]` pairs. */
function log(at: number, bodies: [number, ThreadEventBody][]): ThreadEvent[] {
  return bodies.map(([seconds, body], i) => ({ ...body, i, at: at + seconds * 1000 }) as ThreadEvent)
}

/** The epic's log: each of the human's messages and the orchestrator's answer, and the features it cut. */
function epicLog(epic: EpicSeed, at: number, featureIds: Map<string, string>): ThreadEvent[] {
  const bodies: [number, ThreadEventBody][] = []
  epic.turns.forEach((turn, k) => {
    const t = k * 120
    bodies.push([t, { type: 'prompt', id: `p_${k + 1}`, text: turn.said, source: 'human' }], [t + 1, { type: 'turn_started' }])
    if (k === 0) {
      bodies.push([t + 2, { type: 'title', title: epic.name, by: 'orchestrator' }])
      for (const [title, featureId] of featureIds) bodies.push([t + 20, { type: 'feature_acted', featureId, title, action: 'created' }])
    }
    bodies.push([t + 30, { type: 'agent_text', messageId: `m_${k + 1}`, text: turn.answered }], [t + 31, { type: 'turn_ended', reason: 'end_turn' }])
  })
  return log(at, bodies)
}

/** One write straight to the drive's database: the backdating and states no service sets by itself. */
function exec(ctx: AppCtx, sql: string, ...params: (string | number | null)[]): void {
  ;(ctx.db as unknown as { $client: { run(sql: string, params: (string | number | null)[]): void } }).$client.run(sql, params)
}

/** One read straight from the drive's database. */
function one<T>(ctx: AppCtx, sql: string, ...params: (string | number | null)[]): T | null {
  const client = (ctx.db as unknown as { $client: { query(sql: string): { get(...params: (string | number | null)[]): T | null } } }).$client
  return client.query(sql).get(...params)
}

async function seedEpic(ctx: AppCtx, project: Project, epic: EpicSeed, now: number): Promise<void> {
  const row = createSessionRow(ctx, { projectId: project.id, kind: 'project', worktreePath: project.repoPath, model: MODEL })
  exec(
    ctx,
    'UPDATE sessions SET created_at = ?, epic_color = ?, epic_icon = ? WHERE id = ?',
    now - epic.startedAgo,
    epic.color,
    epic.icon,
    row.id,
  )
  markSessionEnded(ctx, row.id)

  const ids = new Map<string, string>()
  for (const seed of epic.features) {
    const feature = await createFeature(ctx, {
      projectId: project.id,
      title: seed.title,
      oneLiner: `Seeded by the Epics in all states scenario (${epic.name}).`,
      ...(seed.as === 'active' ? {} : { draft: true }),
    })
    ids.set(seed.title, feature.id)
    exec(
      ctx,
      'UPDATE features SET chat_id = ?, status = ?, up_next = ?, created_at = ? WHERE id = ?',
      row.id,
      seed.as === 'shipped' ? 'shipped' : feature.status,
      seed.as === 'up-next' ? 1 : 0,
      now - epic.startedAgo + MINUTE,
      feature.id,
    )
    if (seed.as !== 'active' || !seed.waiting) continue
    const lead = createSessionRow(ctx, { featureId: feature.id, kind: 'chat', worktreePath: worktreeDir(project.id, feature.slug), model: MODEL })
    markSessionEnded(ctx, lead.id)
    if (seed.waiting) setWait(ctx, lead.id, seed.waiting)
  }
  seedThreadLog(row.id, epicLog(epic, now - epic.wroteAgo, ids))
  if (epic.asks) setWait(ctx, row.id, epic.asks)
}

async function main(): Promise<void> {
  const dataDir = driveDataDir()
  process.env.RUNCASTLE_DATA_DIR = dataDir
  const db = createDb(dbPath())
  try {
    runMigrations(db)
    const ctx: AppCtx = { db, config: loadConfig() }
    const project = await demoProject(ctx, join(dataDir, 'epics-in-all-states'))
    const seeded = projectSessions(ctx, project.id, 'project').length > 0
    if (!seeded) {
      const now = Date.now()
      for (const epic of EPICS) await seedEpic(ctx, project, epic, now)
    }
    const slug = one<{ slug: string }>(ctx, 'SELECT slug FROM features WHERE project_id = ? AND title = ?', project.id, ENTRY)?.slug
    if (!slug) throw new Error(`${ENTRY} is missing from a project seeded before`)
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
  console.error(`[epics-in-all-states] ${e instanceof Error ? e.message : String(e)}`)
  process.exit(1)
}
