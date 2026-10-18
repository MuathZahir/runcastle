/**
 * What the "Feature with UI states" scenarios share: the drive data-dir guard,
 * the drive's db, this checkout as a project, a feature at review seeded on the
 * drive's own branch, and the catalogue build run on the host.
 *
 * Nothing here cuts a branch or a worktree in the developer's repo: features
 * are created as drafts (no git work at all) and pointed at the branch the
 * drive already stands on, and the build runs in the checkout itself.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Feature, Project, Ticket, TicketInput } from '../../../packages/core/src/schemas.ts'
import { dbPath } from '../../../packages/core/src/paths.ts'
import { loadConfig } from '../../../packages/core/src/config-load.ts'
import {
  STORIES_CONFIG_REL,
  parseStoriesConfig,
  renderStoriesBuildCommand,
} from '../../../packages/core/src/stories.ts'
import { createDb } from '../../../packages/server/src/db/client.ts'
import { runMigrations } from '../../../packages/server/src/db/migrate.ts'
import type { AppCtx } from '../../../packages/server/src/db/types.ts'
import { createFeature } from '../../../packages/server/src/services/features.ts'
import { openProject } from '../../../packages/server/src/services/projects.ts'
import {
  getProjectByRepoPath,
  setFeatureBranches,
  setFeatureStatus,
  setPhase,
} from '../../../packages/server/src/services/repo.ts'
import { storeTickets, updateTicket } from '../../../packages/server/src/services/tickets.ts'
import type { GateExecResult, WithGateSandbox } from '../../../packages/server/src/workflows/review-gates.ts'
import { DRIVE_PREFIX, isDriveDataDir } from '../../drive-dir.ts'

/**
 * The checkout the scenarios build: this one, or `SCENARIO_REPO` (tests point
 * it at a temp repo).
 */
export function checkoutRoot(): string {
  return resolve(process.env.SCENARIO_REPO || resolve(import.meta.dirname, '../../..'))
}

/**
 * Only ever the drive's own tree. Every path helper reads `RUNCASTLE_DATA_DIR`
 * lazily, so this check runs before the first one is called; unset, they would
 * fall back to the developer's real `~/.runcastle`.
 */
export function driveDataDir(): string {
  const dir = process.env.RUNCASTLE_DATA_DIR
  if (!dir) throw new Error('RUNCASTLE_DATA_DIR is not set — run this inside a test drive')
  if (!isDriveDataDir(resolve(dir))) {
    throw new Error(`refusing to seed ${resolve(dir)} — not a ${DRIVE_PREFIX}* data dir`)
  }
  return resolve(dir)
}

/** Run `seed` against the drive's db, guarded, migrated, and closed after. */
export async function withDriveDb<T>(seed: (ctx: AppCtx) => Promise<T>): Promise<T> {
  process.env.RUNCASTLE_DATA_DIR = driveDataDir()
  const db = createDb(dbPath())
  try {
    runMigrations(db)
    return await seed({ db, config: loadConfig() })
  } finally {
    // Close so the WAL is checkpointed into the db file for any reader after us.
    ;(db as unknown as { $client: { close(): void } }).$client.close()
  }
}

/** This checkout's project row, registered if the drive's db lacks it; nothing is written to the repo. */
export async function checkoutProject(ctx: AppCtx, repoRoot: string): Promise<Project> {
  return getProjectByRepoPath(ctx, repoRoot) ?? (await openProject(ctx, repoRoot))
}

export interface SeededFeature {
  feature: Feature
  reviewTicket: Ticket
}

const IMPLEMENTATION: TicketInput[] = ['Build the coupon field', 'Show the expired state'].map((title) => ({
  title,
  goal: `${title}.`,
  context: 'Seeded by a UI states scenario.',
  acceptanceCriteria: [`${title} works.`],
  seams: [],
  blockedBy: [],
}))

const REVIEW: TicketInput = {
  title: 'Review the integrated change',
  goal: 'Review the integrated feature branch.',
  context: 'Seeded by a UI states scenario.',
  acceptanceCriteria: ['Reviewed.'],
  seams: [],
  blockedBy: [1, 2],
  kind: 'review',
}

/**
 * A feature at review on the drive's branch (`RUNCASTLE_BRANCH`), based on
 * main (or `origin/main`, see {@link mainBranch}), its tickets and one review ticket done. Created as a draft so no
 * `feature/<slug>` branch is cut, then pointed at branches that already exist.
 */
export async function seedFeatureAtReview(
  ctx: AppCtx,
  project: Project,
  title: string,
): Promise<SeededFeature> {
  const branch = process.env.RUNCASTLE_BRANCH
  if (!branch) throw new Error('RUNCASTLE_BRANCH is not set — run this inside a test drive')
  const draft = await createFeature(ctx, {
    projectId: project.id,
    title,
    oneLiner: 'Seeded by a UI states scenario.',
    draft: true,
  })
  setFeatureBranches(ctx, draft.id, { branch, baseBranch: await mainBranch(project.repoPath) })
  setFeatureStatus(ctx, draft.id, 'active')
  const stored = storeTickets(ctx, draft.id, [...IMPLEMENTATION, REVIEW])
  const done = stored.map((ticket) => updateTicket(ctx, ticket.id, { status: 'done' }))
  const feature = setPhase(ctx, draft.id, 'review')
  return { feature, reviewTicket: done.find((t) => t.kind === 'review')! }
}

/** `main`, or `origin/main` in a clone that never checked main out locally. */
async function mainBranch(repoRoot: string): Promise<string> {
  const local = await hostExec('git rev-parse --verify --quiet main', repoRoot)
  return local.exitCode === 0 ? 'main' : 'origin/main'
}

/** The feature page the drive opens, relative to the driven runcastle. */
export function featureUrl(project: Project, feature: Feature): string {
  return `/p/${encodeURIComponent(project.id)}/f/${encodeURIComponent(feature.slug)}`
}

/** One shell command in `cwd` on this machine, its output collected. */
export async function hostExec(command: string, cwd: string): Promise<GateExecResult> {
  const argv = process.platform === 'win32' ? ['cmd.exe', '/d', '/s', '/c', command] : ['sh', '-c', command]
  const child = Bun.spawn(argv, { cwd, stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  return { exitCode, stdout, stderr }
}

/**
 * A sandbox that is the checkout itself, already installed by drive-setup: its
 * `outDir` is used as a host path, as under `noSandbox`. It stands on the
 * checkout's HEAD and nothing else, so any branch but `branch` is refused — a
 * base build at another commit comes back failed rather than building the
 * wrong tree.
 */
export function hostSandbox(repoRoot: string, branch: string): WithGateSandbox {
  return async (requested, use, options) => {
    if (requested !== branch) throw new Error(`a host sandbox builds only the checkout, not ${requested}`)
    return use({
      ...(options?.outDir ? { outPath: options.outDir } : {}),
      exec: (command) => hostExec(command, repoRoot),
    })
  }
}

/** The checkout's commit at HEAD. */
export async function headCommit(repoRoot: string): Promise<string> {
  const out = await hostExec('git rev-parse HEAD', repoRoot)
  if (out.exitCode !== 0) throw new Error(`git rev-parse HEAD failed: ${out.stderr.trim()}`)
  return out.stdout.trim()
}

/** Build the checkout's catalogue on the host into `outDir`, with its own `stories.json`. */
export async function buildCatalogueOnHost(repoRoot: string, outDir: string): Promise<void> {
  const cfg = parseStoriesConfig(readFileSync(resolve(repoRoot, STORIES_CONFIG_REL), 'utf8'))
  if (!cfg) throw new Error(`${STORIES_CONFIG_REL} has no usable build command`)
  const out = await hostExec(renderStoriesBuildCommand(cfg, outDir), repoRoot)
  if (out.exitCode !== 0) {
    throw new Error(`the stories build exited ${out.exitCode}:\n${out.stdout}\n${out.stderr}`)
  }
}
