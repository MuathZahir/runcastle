/**
 * Scenario: one project whose epic list has an epic in every state
 * (docs/features/epics-that-look-alive), to see the coloured cards, the tinted
 * slim idle rows, the dotted New epic slot and the colour-and-icon picker on
 * real data.
 *
 * The project, epics-demo, holds six orchestrator chats (epics), each with its
 * own colour and icon:
 *
 * - **Checkout Flow** (amber, credit-card) waits on the human: its last turn
 *   showed the plan of "Saved cards" and ended on a question, and that feature
 *   waits for an answer — the yellow band.
 * - **Notes Sync** (teal, database) has features in motion: one in progress,
 *   one that waits on its plan being read, one up next — the in-motion band.
 *   Nothing runs (a scenario starts no agent), so the chat itself reads at rest.
 * - **Dark Mode**, **Search**, **Onboarding** and **Release Tooling** are idle:
 *   slim rows, each having shipped one to three features, last written in
 *   between 20 minutes and 20 hours ago (the human's words keep an epic listed
 *   for a day). Release Tooling has no icon yet, so it wears the default.
 *
 * Run by the project's scenario runner (`bun {file}`) inside a test drive of
 * runcastle, with the drive identity, the `.runcastle/drive.env` overlay and a
 * fresh `RUNCASTLE_SCENARIO_RUN` in its env. It seeds the DRIVEN instance — the
 * overlay's `RUNCASTLE_DATA_DIR` — and prints the project's chats page as
 * `ENTRY_URL=…`, which the drive resolves against its own URL.
 *
 * The project is a copy of the tiny-notes fixture (one commit) under
 * `epics-in-all-states/` in the drive's data dir, so it goes away with the
 * drive. A second run reuses the project and finds its epics by name, seeding
 * nothing twice.
 */
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { EpicColor, EpicIconId } from '../../../packages/core/src/epic-look.ts'
import type { Project } from '../../../packages/core/src/schemas.ts'
import type { ThreadEvent, ThreadEventBody } from '../../../packages/core/src/thread.ts'
import { dbPath } from '../../../packages/core/src/paths.ts'
import { loadConfig } from '../../../packages/core/src/config-load.ts'
import { createDb } from '../../../packages/server/src/db/client.ts'
import { runMigrations } from '../../../packages/server/src/db/migrate.ts'
import type { AppCtx } from '../../../packages/server/src/db/types.ts'
import { createFeature } from '../../../packages/server/src/services/features.ts'
import { setWaiting } from '../../../packages/server/src/services/lead-status.ts'
import { listProjects, openProject } from '../../../packages/server/src/services/projects.ts'
import { createSessionRow, markSessionEnded, projectSessions } from '../../../packages/server/src/launcher/sessions.ts'
import { seedThreadLog } from '../../../packages/server/src/threads/log.ts'
import { DRIVE_PREFIX, isDriveDataDir } from '../../drive-dir.ts'

const NAME = 'epics-demo'
const FIXTURE = resolve(import.meta.dirname, '..', '_fixtures', 'tiny-notes')
const MODEL = { id: 'claude-opus-5-5', runtime: 'claude-code' as const }
const MINUTE = 60_000
const HOUR = 60 * MINUTE

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
  | { title: string; as: 'active'; waiting?: { why: string; kind: 'answer' | 'plan' } }
  | { title: string; as: 'up-next' }

interface EpicSeed {
  name: string
  color: EpicColor
  icon: EpicIconId | null
  /** When the chat was started, and when the human last wrote in it, before now. */
  startedAgo: number
  wroteAgo: number
  /** What the human said, and what the orchestrator answered. */
  said: string
  answered: string
  /** The feature whose plan the last turn showed, by title, so the chat asks about it. */
  asksAbout?: string
  features: FeatureSeed[]
}

const EPICS: EpicSeed[] = [
  {
    name: 'Checkout Flow',
    color: 'amber',
    icon: 'credit-card',
    startedAgo: 3 * HOUR,
    wroteAgo: 25 * MINUTE,
    said: 'People should be able to save a card and pay with one tap next time.',
    answered: 'Here is the plan for Saved cards. Should a saved card expire after a year of no use, or never?',
    asksAbout: 'Saved cards',
    features: [{ title: 'Saved cards', as: 'active', waiting: { why: 'Should a saved card expire after a year of no use?', kind: 'answer' } }],
  },
  {
    name: 'Notes Sync',
    color: 'teal',
    icon: 'database',
    startedAgo: 5 * HOUR,
    wroteAgo: 40 * MINUTE,
    said: 'Notes should sync between my laptop and my phone.',
    answered: 'Cut into three: the sync engine is being built, conflict handling waits on its plan, and offline edits come next.',
    features: [
      { title: 'Sync engine', as: 'active' },
      { title: 'Conflict handling', as: 'active', waiting: { why: 'Plan to read', kind: 'plan' } },
      { title: 'Offline edits', as: 'up-next' },
    ],
  },
  {
    name: 'Dark Mode',
    color: 'violet',
    icon: 'palette',
    startedAgo: 2 * 24 * HOUR,
    wroteAgo: 20 * MINUTE,
    said: 'Add a dark theme that follows the system setting.',
    answered: 'Both shipped: the dark theme and the system-setting switch.',
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
    said: 'Find notes by any word in them, fast.',
    answered: 'Shipped: full-text search, highlighted matches and search-as-you-type.',
    features: [
      { title: 'Full-text search', as: 'shipped' },
      { title: 'Highlight matches', as: 'shipped' },
      { title: 'Search as you type', as: 'shipped' },
    ],
  },
  {
    name: 'Onboarding',
    color: 'rose',
    icon: 'users',
    startedAgo: 4 * 24 * HOUR,
    wroteAgo: 9 * HOUR,
    said: 'A first-run tour for new people.',
    answered: 'The welcome tour shipped.',
    features: [{ title: 'Welcome tour', as: 'shipped' }],
  },
  {
    name: 'Release Tooling',
    color: 'rust',
    icon: null,
    startedAgo: 5 * 24 * HOUR,
    wroteAgo: 20 * HOUR,
    said: 'What would it take to publish releases from CI?',
    answered: 'Two pieces: a changelog from the commits and a tagged build. Nothing to cut yet; say when.',
    features: [],
  },
]

/** The chat's log: the human's message, then the orchestrator's turn, ending on its words (a question asks). */
function conversation(epic: EpicSeed, at: number, featureIds: Map<string, string>): ThreadEvent[] {
  const shown = epic.asksAbout ? featureIds.get(epic.asksAbout) : undefined
  const bodies: [number, ThreadEventBody][] = [
    [0, { type: 'prompt', id: 'p_1', text: epic.said, source: 'human' }],
    [1, { type: 'turn_started' }],
    [2, { type: 'title', title: epic.name, by: 'orchestrator' }],
    ...(shown ? ([[20, { type: 'plan_shown', featureId: shown }]] as [number, ThreadEventBody][]) : []),
    [30, { type: 'agent_text', messageId: 'm_1', text: epic.answered }],
    [31, { type: 'turn_ended', reason: 'end_turn' }],
  ]
  return bodies.map(([seconds, body], i) => ({ ...body, i, at: at + seconds * 1000 }) as ThreadEvent)
}

/** One write straight to the drive's database: the backdating and states no service sets by itself. */
function exec(ctx: AppCtx, sql: string, ...params: (string | number | null)[]): void {
  ;(ctx.db as unknown as { $client: { run(sql: string, params: (string | number | null)[]): void } }).$client.run(sql, params)
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
      'UPDATE features SET chat_id = ?, held_by = ?, status = ?, up_next = ?, created_at = ? WHERE id = ?',
      row.id,
      // The epic runs what it cut, until it shipped.
      seed.as === 'shipped' ? null : row.id,
      seed.as === 'shipped' ? 'shipped' : feature.status,
      seed.as === 'up-next' ? 1 : 0,
      now - epic.startedAgo + MINUTE,
      feature.id,
    )
    if (seed.as === 'active' && seed.waiting) setWaiting(ctx, feature.id, seed.waiting.why, seed.waiting.kind)
  }
  seedThreadLog(row.id, conversation(epic, now - epic.wroteAgo, ids))
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
    console.log(`ENTRY_URL=/p/${encodeURIComponent(project.id)}/chat`)
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
