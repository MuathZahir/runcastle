import type { FindingSource, PreparedKey, Project, ProjectFinding } from '@runcastle/core'
import { PREPARED_KEYS } from '@runcastle/core'
import { and, eq } from 'drizzle-orm'
import type { AppCtx } from '../db/types'
import { projectFindings, projects } from '../db/schema'
import { commitsSince } from './git'

/**
 * Prepared-field provenance (project preparation).
 *
 * The VALUE of every prepared field lives in its own `projects` column, so the
 * settings resolver, the burner and the launcher all read it through the paths
 * they already used. This service owns the *other* half: who established it,
 * what justified it, and how far the repo has moved since — the half that makes
 * an automatically-discovered value safe to trust.
 *
 * Two rules carry the design:
 *
 * 1. **A human value is never auto-overwritten.** `recordHuman` stamps `human`
 *    on any manual settings write, and {@link isOverwritable} is what a prep run
 *    consults before writing. An operator who typed the right answer once should
 *    not have to re-type it after every re-prepare.
 * 2. **Staleness is measured, not assumed.** Findings are pinned to the main-
 *    branch sha they were measured at. A stale test baseline is actively worse
 *    than an absent one — an agent trusts it and files its own breakage under
 *    "already red on main" — so the distance is computed from git and surfaced,
 *    and an uncomputable distance reports `undefined` (unknown), never zero.
 */

/** Project columns holding prepared values, by key (mirrors `PREPARED_KEYS`). */
const VALUE_COLUMN = {
  setupCommand: projects.setupCommand,
  verifyCommands: projects.verifyCommands,
  knownFailures: projects.knownFailures,
  devCommand: projects.devCommand,
  driveSetupCommand: projects.driveSetupCommand,
  driveStopCommand: projects.driveStopCommand,
  driveEnv: projects.driveEnv,
  dbResetCommand: projects.dbResetCommand,
} as const satisfies Record<PreparedKey, unknown>

/** Drizzle column NAME for a prepared key, for the `.set()` object literal. */
const COLUMN_NAME: Record<PreparedKey, string> = {
  setupCommand: 'setupCommand',
  verifyCommands: 'verifyCommands',
  knownFailures: 'knownFailures',
  devCommand: 'devCommand',
  driveSetupCommand: 'driveSetupCommand',
  driveStopCommand: 'driveStopCommand',
  driveEnv: 'driveEnv',
  dbResetCommand: 'dbResetCommand',
}

const PREPARED_SET = new Set<string>(PREPARED_KEYS)

/** Whether `key` names a prepared field (i.e. one preparation can establish). */
export function isPreparedKey(key: string): key is PreparedKey {
  return PREPARED_SET.has(key)
}

/** The stored provenance row for one field, or `undefined`. */
function findingRow(
  ctx: AppCtx,
  projectId: string,
  key: PreparedKey,
): { source: FindingSource; evidence: string | null; establishedAt: number; establishedSha: string | null } | undefined {
  return ctx.db
    .select({
      source: projectFindings.source,
      evidence: projectFindings.evidence,
      establishedAt: projectFindings.establishedAt,
      establishedSha: projectFindings.establishedSha,
    })
    .from(projectFindings)
    .where(and(eq(projectFindings.projectId, projectId), eq(projectFindings.key, key)))
    .get()
}

/**
 * Whether a preparation run may write `key`. Anything a human set is off
 * limits, unconditionally — there is deliberately no override flag. Re-running
 * preparation is a routine action (a re-prepare button, a stale baseline), and
 * an override that quietly discards a hand-typed answer would eventually fire
 * on someone who did not mean it.
 *
 * The way to hand a field back to preparation is to CLEAR it: clearing drops
 * the provenance row with the value, which makes the key writable again. That
 * keeps "let the agent redo this" an explicit, per-field, visible act.
 */
export function isOverwritable(ctx: AppCtx, projectId: string, key: PreparedKey): boolean {
  return findingRow(ctx, projectId, key)?.source !== 'human'
}

/**
 * The verification half of a provenance row, reset. Written on every path that
 * establishes a value, because a write is a write: no value-diffing, no "it
 * looks the same so the old proof still holds". The only way back to verified
 * is another clean dry-run pass (decision 6).
 */
const UNVERIFIED = { verifiedAt: null, verifiedSha: null } as const

export interface RecordFindingInput {
  key: PreparedKey
  /** The established value; `null` clears both the value and its provenance. */
  value: string | null
  source: FindingSource
  evidence?: string
  /** Main-branch sha the value was measured at (prep runs only). */
  establishedSha?: string
}

/**
 * Write a prepared value AND its provenance in one transaction — the two must
 * never diverge, or the UI attributes one run's finding to another's evidence.
 * Upserts the provenance row (composite PK `projectId,key`).
 */
export function recordFinding(ctx: AppCtx, projectId: string, input: RecordFindingInput): void {
  const { key, value, source, evidence, establishedSha } = input
  ctx.db.transaction((tx) => {
    tx.update(projects)
      .set({ [COLUMN_NAME[key]]: value })
      .where(eq(projects.id, projectId))
      .run()

    if (value === null) {
      tx.delete(projectFindings)
        .where(and(eq(projectFindings.projectId, projectId), eq(projectFindings.key, key)))
        .run()
      return
    }

    tx.insert(projectFindings)
      .values({
        projectId,
        key,
        source,
        evidence: evidence ?? null,
        establishedAt: Date.now(),
        establishedSha: establishedSha ?? null,
        ...UNVERIFIED,
      })
      .onConflictDoUpdate({
        target: [projectFindings.projectId, projectFindings.key],
        set: {
          source,
          evidence: evidence ?? null,
          establishedAt: Date.now(),
          establishedSha: establishedSha ?? null,
          ...UNVERIFIED,
        },
      })
      .run()
  })
}

/**
 * Stamp a manual settings write as human-established. Called from the settings
 * service for prepared keys only; a no-op for everything else. Clearing a field
 * (`value === null`) drops the provenance row too, which deliberately makes the
 * field prep-writable again — clearing is how you ask prep to re-derive it.
 */
export function recordHuman(
  ctx: AppCtx,
  projectId: string,
  key: string,
  value: string | null,
): void {
  if (!isPreparedKey(key)) return
  const existing = findingRow(ctx, projectId, key)
  if (value === null) {
    if (existing) {
      ctx.db
        .delete(projectFindings)
        .where(and(eq(projectFindings.projectId, projectId), eq(projectFindings.key, key)))
        .run()
    }
    return
  }
  ctx.db
    .insert(projectFindings)
    .values({
      projectId,
      key,
      source: 'human',
      evidence: null,
      establishedAt: Date.now(),
      establishedSha: null,
      ...UNVERIFIED,
    })
    .onConflictDoUpdate({
      target: [projectFindings.projectId, projectFindings.key],
      // Evidence belongs to the value that produced it: a human overwriting a
      // prep finding invalidates prep's justification, so it is cleared rather
      // than left pointing at a command output that no longer explains the value.
      set: {
        source: 'human',
        evidence: null,
        establishedAt: Date.now(),
        establishedSha: null,
        ...UNVERIFIED,
      },
    })
    .run()
}

/**
 * Stamp `keys` as verified — the drive machinery observed each of these values
 * working on a clean dry-run pass, at `sha` (null when the repo has no
 * resolvable commit).
 *
 * Existing provenance rows only: a key with no row stays unverified rather than
 * gaining a fabricated provenance it never had. The prep session that runs a dry
 * run has just recorded rows for everything it exercised, so in practice this
 * only skips legacy values, and skipping them is the honest outcome.
 *
 * Deliberately emits no event, against the usual convention for a mutating
 * service function: the dry-run service owns the timeline entry for a
 * verification pass, so stamping here too would double-report one pass.
 */
export function markVerified(
  ctx: AppCtx,
  projectId: string,
  keys: PreparedKey[],
  sha: string | null,
): void {
  const verifiedAt = Date.now()
  for (const key of keys) {
    ctx.db
      .update(projectFindings)
      .set({ verifiedAt, verifiedSha: sha })
      .where(and(eq(projectFindings.projectId, projectId), eq(projectFindings.key, key)))
      .run()
  }
}

/**
 * Every finding for a project, with staleness resolved against the repo's
 * current main branch. One `git rev-list --count` per distinct sha (prep stamps
 * all of a run's findings with the same one, so this is normally a single git
 * call for the whole set).
 */
export async function listFindings(ctx: AppCtx, project: Project): Promise<ProjectFinding[]> {
  const rows = ctx.db
    .select()
    .from(projectFindings)
    .where(eq(projectFindings.projectId, project.id))
    .all()

  const distances = new Map<string, number | undefined>()
  for (const row of rows) {
    const sha = row.establishedSha
    if (!sha || distances.has(sha)) continue
    distances.set(sha, await commitsSince(project.repoPath, sha, project.mainBranch))
  }

  const order = new Map<string, number>(PREPARED_KEYS.map((k, i) => [k, i]))
  return rows
    .filter((row): row is typeof row & { key: PreparedKey } => isPreparedKey(row.key))
    .sort((a, b) => (order.get(a.key) ?? 0) - (order.get(b.key) ?? 0))
    .map((row) => {
      const staleCommits = row.establishedSha ? distances.get(row.establishedSha) : undefined
      return {
        key: row.key,
        source: row.source,
        ...(row.evidence ? { evidence: row.evidence } : {}),
        establishedAt: row.establishedAt,
        ...(row.establishedSha ? { establishedSha: row.establishedSha } : {}),
        ...(staleCommits !== undefined ? { staleCommits } : {}),
        ...(row.verifiedAt !== null ? { verifiedAt: row.verifiedAt } : {}),
        ...(row.verifiedSha ? { verifiedSha: row.verifiedSha } : {}),
      }
    })
}

/** Prepared keys with no value set on the project — what a prep run should fill. */
export function unsetPreparedKeys(project: Project): PreparedKey[] {
  return PREPARED_KEYS.filter((key) => {
    const value = project[key]
    return value === undefined || value.trim() === ''
  })
}

/** Test/inspection helper: the value currently stored for a prepared key. */
export function preparedValue(ctx: AppCtx, projectId: string, key: PreparedKey): string | null {
  const row = ctx.db
    .select({ value: VALUE_COLUMN[key] })
    .from(projects)
    .where(eq(projects.id, projectId))
    .get()
  return (row?.value as string | null) ?? null
}
