import { eq } from 'drizzle-orm'
import { DEFAULT_RUNTIME, resolveModelEntry, type ModelEntry, type ModelStep, type Project, type SessionRow } from '@runcastle/core'
import { sessions } from '../db/schema'
import type { AppCtx } from '../db/types'
import { GateError } from '../errors'
import { serverUrlFor } from '../launcher/artifacts'
import { ensureFeatureWorktree } from '../launcher/launcher'
import { runtimeAdapterFor } from '../launcher/runtimes'
import type { AcpLaunchSpec, RuntimeLaunchInput } from '../launcher/runtimes/types'
import * as git from '../services/git'
import { rosterConfig } from '../services/model-discovery'
import { heldSlugs } from '../services/holding'
import { openCount as openProjectNoteCount } from '../services/project-notes'
import { getFeatureRow, projectForFeature, requireProjectById } from '../services/repo'
import { listScenarioPaths } from '../services/scenarios'
import { clearEndedErrand } from '../services/resolved-merge'
import { hostReviewBriefing, hostReviewEnv, isHostReview } from '../workers/review'
import { getWorker } from '../workers/service'
import { driveWorkerBriefing, driveWorkerOf } from '../workers/drive'

/**
 * How a thread's agent is launched over ACP: its runtime's {@link AcpLaunchSpec}
 * for the row, briefed as the terminal launch briefed the same kind. The brief
 * is written each time the thread's process starts, so it carries the state of
 * that moment (the feature, the failing drive, the open notes) rather than the
 * state of the click that created the row.
 */
export async function acpLaunchFor(ctx: AppCtx, row: SessionRow): Promise<AcpLaunchSpec> {
  const runtime = runtimeAdapterFor(row.runtime ?? DEFAULT_RUNTIME)
  const ready = runtime.checkReady()
  if (!ready.ok) throw new GateError(`${ready.reason}. ${ready.doctorHint}`)
  const input = await acpLaunchInput(ctx, row)
  adoptWorktree(ctx, row, input.worktreePath)
  return runtime.acpLaunch(input)
}

/**
 * A thread with no conversation yet starts wherever its kind's worktree is NOW,
 * not where its row was made: the folder may have gone (an archive, a sweep),
 * and in a test drive the row was copied from the live install and names the
 * live install's own worktree (drives-never-touch-real-conversations). The row
 * takes the new folder, so the agent's process and its session open there. A
 * thread with a conversation keeps its folder: its conversation resumes from it.
 */
function adoptWorktree(ctx: AppCtx, row: SessionRow, worktreePath: string): void {
  if (row.ccSessionId || row.worktreePath === worktreePath) return
  ctx.db.update(sessions).set({ worktreePath }).where(eq(sessions.id, row.id)).run()
}

/** The model step each conversation kind runs on when its row recorded none. */
const STEP: Record<SessionRow['kind'], ModelStep> = {
  chat: 'chat',
  // A side thread is the main chat's sibling, on its step.
  side: 'chat',
  // A worker records its model; a row without one runs on the chat's step, as the lead does.
  worker: 'chat',
  // Host-side drive work, on the drive chats' step (`prepare`).
  scenario: 'prepare',
  'drive-fix': 'prepare',
  project: 'project',
}

function rowProject(ctx: AppCtx, row: SessionRow): Project {
  return row.featureId ? projectForFeature(ctx, getFeatureRow(ctx, row.featureId)) : requireProjectById(ctx, row.projectId as string)
}

/**
 * The model runcastle launches a thread of the row's kind on now, as Settings
 * (and its project) resolve it. A drive worker runs on the drive chats' step,
 * as the chats it replaces did (drive-chats-become-workers decision 9).
 */
export function resolvedThreadModel(ctx: AppCtx, row: SessionRow): ModelEntry {
  const step = driveWorkerOf(ctx, row) ? 'prepare' : STEP[row.kind]
  return resolveModelEntry(step, rosterConfig(ctx), rowProject(ctx, row))
}

/**
 * The posture of the host-side kinds (`drive-fix`, `scenario`, and the host workers), which
 * work in the human's own checkout. Claude runs them without prompts and the
 * checkout guard (a pre-tool hook, which holds under bypass) refuses what the
 * prompts used to catch. Codex never asks, and passes no mode so it keeps its
 * `workspace-write` sandbox: the only bound on shell writes in that checkout.
 */
function hostSidePosture(runtime: string): { permissionMode?: string } {
  return runtime === 'claude-code' ? { permissionMode: 'bypassPermissions' } : {}
}

/**
 * Why an old side chat takes no message and starts no agent (interactive-workers
 * decisions 7, 23): workers replaced side chats, and the ones made before stay
 * as read-only transcripts.
 */
export const OLD_SIDE_CHAT_READ_ONLY =
  'this is an old side chat, kept as a read-only transcript since workers replaced side chats — ' +
  'to carry it on, start a worker with "+" on the feature and paste what it needs'

/**
 * What the thread's runtime is handed: the row's kind's brief, as each of
 * today's launchers wrote it, and the kind's permission posture (which
 * `acpLaunch` turns into the session mode).
 */
export async function acpLaunchInput(ctx: AppCtx, thread: SessionRow): Promise<RuntimeLaunchInput> {
  // An errand that is over is not handed on (`honest-token-counts` decision 12).
  const row = clearEndedErrand(ctx, thread)
  const runtime = row.runtime ?? DEFAULT_RUNTIME
  const project = rowProject(ctx, row)
  const base = {
    session: row,
    project,
    config: ctx.config,
    worktreePath: row.worktreePath,
    serverUrl: serverUrlFor(ctx.config),
    model: row.model ?? resolvedThreadModel(ctx, row).id,
  }
  switch (row.kind) {
    case 'side':
      throw new GateError(OLD_SIDE_CHAT_READ_ONLY)
    case 'chat': {
      const feature = getFeatureRow(ctx, row.featureId as string)
      return {
        ...base,
        // The talk worktree may have gone since the row was made (an archive, a merge).
        worktreePath: await ensureFeatureWorktree(ctx, project, feature),
        feature,
        ...(row.purpose ? { purpose: row.purpose } : {}),
        // The feature's lead works while the human is away, and an approval
        // nobody answers stalls it; the line guard holds under bypass. On Codex
        // this is also what lifts the sandbox (`danger-full-access`): the lead
        // must install dependencies, which workspace-write cannot (no network,
        // package cache outside its folder). Codex never asks either way.
        permissionMode: 'bypassPermissions',
      }
    }
    case 'worker': {
      // A drive worker runs on the host, in the checkout the drive switched to, under the drive chats' posture
      // (drive-chats-become-workers decisions 1, 9); a project drive's Scenarios worker has no feature.
      const drive = driveWorkerOf(ctx, row)
      if (drive) {
        return {
          ...base,
          worktreePath: project.repoPath,
          ...(row.featureId ? { feature: getFeatureRow(ctx, row.featureId) } : {}),
          hostWorker: { briefing: await driveWorkerBriefing(ctx, drive, row, project), env: {} },
          ...hostSidePosture(runtime),
        }
      }
      const feature = getFeatureRow(ctx, row.featureId as string)
      const w = getWorker(ctx, row.id)
      // A drive review runs here, on the host, in the checkout the review drive holds (burns-become-workers decision 3).
      if (w && isHostReview(w)) {
        return {
          ...base,
          worktreePath: project.repoPath,
          feature,
          hostWorker: { briefing: hostReviewBriefing(w, project.repoPath), env: hostReviewEnv(w.id) },
          ...hostSidePosture(runtime),
        }
      }
      // Its process runs in its sandbox (`withWorkers`), which says where its
      // session opens and briefs it; only the model is read from this launch.
      return { ...base, feature, permissionMode: 'bypassPermissions' }
    }
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
          // A thread not yet started holds something only by replacing a capped one.
          ...(row.ccSessionId ? {} : { held: heldSlugs(ctx, row.id) }),
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
        ...hostSidePosture(runtime),
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
        ...hostSidePosture(runtime),
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
