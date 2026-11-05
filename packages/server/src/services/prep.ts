import type { PreparedKey, Project, ProjectFinding } from '@runcastle/core'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { AppCtx } from '../db/types'
import { hasFinding, listFindings, unsetPreparedKeys } from './findings'
import { activeDriveInfo, type DriveInfo } from './git'

/**
 * Project preparation state — which prepared settings are still open.
 *
 * Preparation is a CONVERSATION on the developer's own machine, held by the
 * project orchestrator itself: it prepares first on a new project with code,
 * and fixes a setting whenever it sees one is wrong. Asking beats guessing, and
 * asking is only possible with someone there.
 *
 * This module is the read side of that: it answers "what is left" for the
 * orchestrator's start-of-session note and for the UI. Values and provenance
 * are written by `record_finding` through {@link recordFinding} in `findings.ts`.
 */

/**
 * Which prepared keys are still OPEN: those with no value and no finding. A
 * finding closes a key even without a value — that is how a deliberate "none"
 * ("this repo has no database") is recorded, so a key that is legitimately empty
 * forever stops being asked about. Clearing a field by hand drops its finding
 * with its value, which is how you hand a key back.
 */
export function keysToPrepare(ctx: AppCtx, project: Project): PreparedKey[] {
  return unsetPreparedKeys(project).filter((key) => !hasFinding(ctx, project.id, key))
}

/** The preparation surface the UI polls. */
export interface PrepView {
  pendingKeys: PreparedKey[]
  findings: ProjectFinding[]
  /** No project files exist outside git metadata and runcastle's docs scaffolding. */
  empty: boolean
  /**
   * The preparation dry-run drive, while one is up (decision 9) — the same
   * `DriveInfo` a feature drive surfaces, with no feature on it. It is here so
   * the workspace can show the run and offer a Stop: a session that died
   * mid-run leaves services and a temp database behind, and the human needs the
   * teardown half by hand. `null` whenever the slot is empty or a feature drive
   * holds it.
   */
  dryRun: DriveInfo | null
}

/**
 * The `docs/` subdirectories runcastle scaffolds itself — feature knowledge
 * (`featureDocsRel`) and project ADRs (`ADR_DIR_REL`). Anything else under
 * `docs/` is the project's own, a documentation site's sources as much as code,
 * and ends its emptiness like a file at the root would.
 */
const SCAFFOLDED_DOCS_DIRS = ['adr', 'features']

/**
 * Whether the working tree holds no project files besides git metadata and
 * runcastle's own docs scaffolding (decision 5). Computed live per request and
 * never stored — emptiness ends the moment code appears.
 */
export async function isEmptyRepo(repoPath: string): Promise<boolean> {
  const rootEntries = await readdir(repoPath)
  if (!rootEntries.every((entry) => entry === '.git' || entry === 'docs')) return false
  if (!rootEntries.includes('docs')) return true

  const docsEntries = await readdir(join(repoPath, 'docs'))
  return docsEntries.every((entry) => SCAFFOLDED_DOCS_DIRS.includes(entry))
}

export async function prepView(ctx: AppCtx, project: Project): Promise<PrepView> {
  const drive = activeDriveInfo(project.id)
  return {
    pendingKeys: keysToPrepare(ctx, project),
    findings: await listFindings(ctx, project),
    empty: await isEmptyRepo(project.repoPath),
    dryRun: drive?.dryRun ? drive : null,
  }
}
