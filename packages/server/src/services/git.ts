import type { Feature, Project } from '@runcastle/core'
import type { AppCtx } from '../db/types'
import { NotImplementedError } from '../errors'

/**
 * Git service — WAVE B2 (SPEC §7). Typed stub: signatures are final so wave B2
 * replaces the bodies, not the shapes. Use `simple-git`. Every function throws
 * `NotImplementedError('B2')` until implemented; A1 callers that must stay
 * usable pre-B2 (`features.createFeature`, `projects.initProject`) tolerate that
 * error explicitly.
 */

export interface TestDriveResult {
  ok: boolean
  deniedReason?: string
  branch?: string
}

export interface MergeResult {
  ok: boolean
  conflict?: boolean
}

/** Assert `repoPath` is a git repository (else throw). */
export async function assertRepo(repoPath: string): Promise<void> {
  void repoPath
  throw new NotImplementedError('B2')
}

/** Detect the repo's main branch (e.g. `main` / `master`). */
export async function detectMainBranch(repoPath: string): Promise<string> {
  void repoPath
  throw new NotImplementedError('B2')
}

/** Create branch `feature/<slug>` from mainBranch; returns the branch name. */
export async function createFeatureBranch(project: Project, slug: string): Promise<string> {
  void project
  void slug
  throw new NotImplementedError('B2')
}

/** Ensure the docs-only talk worktree for a feature exists; returns its path. */
export async function ensureTalkWorktree(project: Project, feature: Feature): Promise<string> {
  void project
  void feature
  throw new NotImplementedError('B2')
}

/** Stage `docs/features/<slug>` only and commit if there are changes. */
export async function commitDocs(worktreePath: string, message: string): Promise<void> {
  void worktreePath
  void message
  throw new NotImplementedError('B2')
}

/**
 * Guarded checkout-switch test drive of the feature branch on the main checkout
 * (SPEC §7). `ctx` is provided so the implementation can enforce the
 * active-run guard from the db.
 */
export async function testDrive(
  ctx: AppCtx,
  project: Project,
  feature: Feature,
  action: 'start' | 'stop',
): Promise<TestDriveResult> {
  void ctx
  void project
  void feature
  void action
  throw new NotImplementedError('B2')
}

/** Merge `feature/<slug>` into mainBranch with `--no-ff`; conflict-aware. */
export async function mergeFeature(project: Project, feature: Feature): Promise<MergeResult> {
  void project
  void feature
  throw new NotImplementedError('B2')
}
