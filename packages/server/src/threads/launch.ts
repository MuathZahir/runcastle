import { DEFAULT_RUNTIME, resolveModelEntry, type ModelStep, type SessionRow } from '@runcastle/core'
import type { AppCtx } from '../db/types'
import { GateError } from '../errors'
import { serverUrlFor } from '../launcher/artifacts'
import { isUnguardedLead } from '../launcher/edit-guard'
import { buildPrepareBrief, ensureFeatureWorktree } from '../launcher/launcher'
import { runtimeAdapterFor } from '../launcher/runtimes'
import type { AcpLaunchSpec, RuntimeLaunchInput } from '../launcher/runtimes/types'
import * as git from '../services/git'
import { rosterConfig } from '../services/model-discovery'
import { orchestratorCatchUp } from '../services/orchestrator-notify'
import { openCount as openProjectNoteCount } from '../services/project-notes'
import { getFeatureRow, projectForFeature, requireProjectById } from '../services/repo'
import { listScenarioPaths } from '../services/scenarios'

/**
 * How a thread's agent is launched over ACP: its runtime's {@link AcpLaunchSpec}
 * for the row, briefed as the terminal launch briefed the same kind. The brief
 * is written each time the thread's process starts, so it carries the state of
 * that moment (the feature, the failing drive, the open notes) rather than the
 * state of the click that created the row.
 */
export async function acpLaunchFor(ctx: AppCtx, row: SessionRow): Promise<AcpLaunchSpec> {
  const runtime = runtimeAdapterFor(row.runtime ?? DEFAULT_RUNTIME)
  if (!runtime.acpLaunch) throw new GateError(`${runtime.id} conversations do not run over ACP`)
  const ready = runtime.checkReady()
  if (!ready.ok) throw new GateError(`${ready.reason}. ${ready.doctorHint}`)
  return runtime.acpLaunch(await acpLaunchInput(ctx, row))
}

/** The model step each conversation kind runs on when its row recorded none. */
const STEP: Record<SessionRow['kind'], ModelStep> = {
  chat: 'chat',
  // A side thread is the main chat's sibling, on its step.
  side: 'chat',
  // Host-side environment work, on preparation's step.
  scenario: 'prepare',
  'drive-fix': 'prepare',
  project: 'project',
  prepare: 'prepare',
}

/**
 * What the thread's runtime is handed: the row's kind's brief, as each of
 * today's launchers wrote it, and the kind's permission posture (which
 * `acpLaunch` turns into the session mode).
 */
export async function acpLaunchInput(ctx: AppCtx, row: SessionRow): Promise<RuntimeLaunchInput> {
  const runtime = row.runtime ?? DEFAULT_RUNTIME
  const project = row.featureId ? projectForFeature(ctx, getFeatureRow(ctx, row.featureId)) : requireProjectById(ctx, row.projectId as string)
  const base = {
    session: row,
    project,
    config: ctx.config,
    worktreePath: row.worktreePath,
    serverUrl: serverUrlFor(ctx.config),
    model: row.model ?? resolveModelEntry(STEP[row.kind], rosterConfig(ctx), project).id,
  }
  switch (row.kind) {
    case 'chat':
    case 'side': {
      const feature = getFeatureRow(ctx, row.featureId as string)
      return {
        ...base,
        // The talk worktree may have gone since the row was made (an archive, a merge).
        worktreePath: await ensureFeatureWorktree(ctx, project, feature),
        feature,
        ...(row.purpose ? { purpose: row.purpose } : {}),
        // The feature's lead works while the human is away, and an approval
        // nobody answers stalls it; the line guard holds under bypass.
        ...(runtime === 'claude-code' && isUnguardedLead(row.kind) ? { permissionMode: 'bypassPermissions' } : {}),
      }
    }
    case 'prepare':
      return { ...base, prepare: await buildPrepareBrief(ctx, project) }
    case 'project': {
      const { worktreePath, base: branchBase } = await git.ensureProjectWorktree(project)
      return {
        ...base,
        worktreePath,
        projectBrief: {
          project,
          branch: git.PROJECT_BRANCH,
          worktreePath,
          base: branchBase,
          openNotes: openProjectNoteCount(ctx, project.id),
          // A conversation already under way heard what ended as it happened.
          ...(row.ccSessionId ? {} : { catchUp: orchestratorCatchUp(ctx, project) }),
        },
        // The orchestrator works while the human is away (`one-orchestrator-no-mode` decision 1).
        permissionMode: 'bypassPermissions',
      }
    }
    case 'drive-fix': {
      const feature = getFeatureRow(ctx, row.featureId as string)
      const drive = git.activeDriveInfo(project.id)
      if (drive?.featureId !== feature.id || !drive.hookFailure) {
        throw new GateError(`no failed drive of ${feature.slug} to fix — the Fix-it chat works from a drive whose setup failed`)
      }
      return {
        ...base,
        driveFix: {
          project,
          feature,
          failure: drive.hookFailure,
          envKeys: drive.envKeys ?? [],
          delta: await git.featureBranchDelta(project, feature),
        },
      }
    }
    case 'scenario': {
      const drive = git.activeDriveInfo(project.id)
      const driveEnv = git.scenarioDriveEnv(ctx, project.id)
      if (!drive || !driveEnv) {
        throw new GateError('a scenario chat lands scenarios on a running test drive — start one first')
      }
      return {
        ...base,
        // What the human asks for comes in the thread's prompts.
        scenario: {
          project,
          ...(row.featureId ? { feature: getFeatureRow(ctx, row.featureId) } : {}),
          branch: drive.branch,
          identity: driveEnv.identity,
          envOverlay: driveEnv.envOverlay,
          driveUrl: drive.devUrl,
          runner: project.scenarioRunner ?? undefined,
          files: await listScenarioPaths(project.repoPath, 'HEAD'),
          setup: row.purpose === 'scenario-setup',
        },
      }
    }
  }
}
