import { FilledHttpRequest, MergeBranchPair, SessionKind, SessionPurpose } from '@runcastle/core'
import * as z from 'zod'
import {
  endSession,
  launchDriveFixSession,
  launchScenarioSession,
  launchSession,
  launchSideSession,
} from '../../launcher/launcher'
import { goWarnings } from '../../services/burn-warnings'
import { setDependencies } from '../../services/dependencies'
import { sendDriveCall } from '../../services/drive-call'
import * as features from '../../services/features'
import * as git from '../../services/git'
import { mergeFeatureFlow } from '../../services/merge'
import { getFeatureRow, projectForFeature, tryGetFeature } from '../../services/repo'
import { reconcileStandingConflict } from '../../services/resolved-merge'
import { listRounds } from '../../services/runs'
import { publicProcedure, router } from '../context'

export const featureRouter = router({
  create: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        title: z.string().min(1),
        oneLiner: z.string(),
        brief: z.string().optional(),
        baseBranch: z.string().optional(),
        // Park it instead of starting it (decision 5): the form's "Save as
        // draft" button. No branch, no docs, no commit until Start.
        draft: z.boolean().optional(),
      }),
    )
    .mutation(({ ctx, input }) => features.createFeature(ctx, input)),

  // Start a parked draft (decision 7): cut the branch off a base resolved at
  // this moment, scaffold + commit `brief.md`, activate. The client chains the
  // grill-session launch after it, mirroring the form's create-then-launch.
  start: publicProcedure
    .input(z.object({ featureId: z.string(), baseBranch: z.string().optional() }))
    .mutation(({ ctx, input }) =>
      features.startDraft(ctx, input.featureId, { baseBranch: input.baseBranch }),
    ),

  // Replace a draft's merge-order dependencies (ADR-0013) — the whole set at
  // once, so add and remove are the same call. Refused on a started feature.
  setDependencies: publicProcedure
    .input(z.object({ featureId: z.string(), dependsOn: z.array(z.string()) }))
    .mutation(({ ctx, input }) => setDependencies(ctx, input.featureId, input.dependsOn)),

  // The quick-change door (decision 21) — the second entrance beside `create`,
  // for work too small to deserve a conversation. Creates an ordinary feature
  // born at `implementation` on lap 1 carrying one ticket per sentence the
  // human typed (decisions.md #4). No session is launched: the human reviews
  // the cards and clicks Burn.
  //
  // The list is only checked for being a list here; blank rows are dropped and
  // the "at least one sentence" rule enforced by the service, so the overlay's
  // add/remove list and the MCP door answer to exactly one definition of empty.
  quickChange: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        title: z.string().min(1),
        tickets: z.array(z.string()).min(1),
        baseBranch: z.string().optional(),
      }),
    )
    .mutation(({ ctx, input }) => features.quickChange(ctx, input)),

  list: publicProcedure
    .input(z.object({ projectId: z.string() }))
    .query(({ ctx, input }) => features.list(ctx, input.projectId)),

  get: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      // Reading review is when a stale conflict card would be seen, so a merge
      // committed outside any hook (by hand, or in a chat still live) retires it
      // here. Only at review, where a merge conflict can stand.
      const feature = tryGetFeature(ctx, input.id)
      if (feature?.phase === 'review') await reconcileStandingConflict(ctx, feature)
      return features.getFeatureFull(ctx, input.id)
    }),

  // B1 behavior — the stub throws NotImplementedError('B1').
  // `kickoffLine` is the per-purpose kickoff override (ticket 3 mechanism): the
  // review-phase Iterate action passes its review-iteration briefing here so the
  // revisit session opens on the right first move instead of the generic line.
  // `purpose` + `purposeData` say what the session was opened to DO, which the
  // briefing alone could not: both conflict-resolve sites mark their session
  // `resolve-conflict` and name the merge, so the edit guard can let it write.
  launchSession: publicProcedure
    .input(
      z.object({
        featureId: z.string(),
        kind: SessionKind,
        kickoffLine: z.string().min(1).optional(),
        purpose: SessionPurpose.optional(),
        purposeData: MergeBranchPair.optional(),
      }),
    )
    .mutation(({ ctx, input }) => launchSession(ctx, input)),

  // "Fix drive" — the one click that turns a failed drive into an agent already
  // holding the failure (multi-service decision 9). Its own door rather than a
  // `kind` on launchSession: the session runs in the real checkout beside the
  // failed drive, and is refused when there is no failure to work from.
  fixDrive: publicProcedure
    .input(z.object({ featureId: z.string() }))
    .mutation(({ ctx, input }) => launchDriveFixSession(ctx, { featureId: input.featureId })),

  // New side session, or reopen an ended one by its row id
  // (several-sessions-per-feature): a conversation beside the main chat, never
  // refused for what the main chat is doing. Its own door rather than a `kind`
  // on launchSession, whose chat path is the main chat's alone.
  openSideSession: publicProcedure
    .input(z.object({ featureId: z.string(), reopenSessionId: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const { sessionId } = await launchSideSession(ctx, input)
      return { sessionId }
    }),

  // End a live session (End session button; terminal-tab close is detach only).
  // Route added by W2 (UI-SPEC §6); backed by W1's PTY-killing `endSession`
  // service, re-exported from the launcher so this import path stays stable.
  endSession: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .mutation(({ ctx, input }) => endSession(ctx, input.sessionId)),

  // Archive a feature from any phase (decision #8): ends any live session, hides
  // it behind the sidebar's show-archived filter, keeps all data. Reversible via
  // `unarchive`. Mirrors the `project.close` precedent (a reversible hide).
  archive: publicProcedure
    .input(z.object({ featureId: z.string() }))
    .mutation(({ ctx, input }) => features.archiveFeature(ctx, input.featureId)),

  unarchive: publicProcedure
    .input(z.object({ featureId: z.string() }))
    .mutation(({ ctx, input }) => features.unarchiveFeature(ctx, input.featureId)),

  // Permanently delete a non-shipped feature (decision #8): cancels an active
  // run, ends a live session, stops this feature's test drive, removes the talk
  // worktree, deletes feature + runcastle temp branches, and drops all DB rows +
  // session artifact dirs. Committed docs history is left untouched. Refuses a
  // shipped feature (archive covers those). Behind a confirm dialog in the UI.
  delete: publicProcedure
    .input(z.object({ featureId: z.string() }))
    .mutation(({ ctx, input }) => features.deleteFeature(ctx, input.featureId)),

  // Go (`the-feature-lead-runs-rounds` decision 8): approve the plan, move
  // planning → building and hand the feature to its lead. Starts no run — the
  // lead dispatches every round. Replaces the human's Burn. Before the plan is
  // finished Go is a gate: `overrideReason` is the one line that crosses it.
  go: publicProcedure
    .input(z.object({ featureId: z.string(), overrideReason: z.string().optional() }))
    .mutation(({ ctx, input }) =>
      features.go(ctx, input.featureId, input.overrideReason ? { overrideReason: input.overrideReason } : {}),
    ),

  // Stop (decision 23): cancel the running round, mark the feature stopped so
  // nothing dispatches until the human replies, tell the lead.
  stop: publicProcedure
    .input(z.object({ featureId: z.string() }))
    .mutation(({ ctx, input }) => features.stopFeature(ctx, input.featureId)),

  // The round trail's record (decision 16): every round, numbered from 1.
  rounds: publicProcedure
    .input(z.object({ featureId: z.string() }))
    .query(({ ctx, input }) => listRounds(ctx, input.featureId)),

  readyDeclarations: publicProcedure
    .input(z.object({ featureId: z.string() }))
    .query(({ ctx, input }) => features.listReadyDeclarations(ctx, input.featureId)),

  agenticReview: publicProcedure
    .input(z.object({ featureId: z.string() }))
    .mutation(({ ctx, input }) => features.agenticReview(ctx, input.featureId)),

  // What the Go confirm dialog prints in its warn box, in the `mergeDelta`
  // pattern: computed server-side so the UI never re-derives policy, and never
  // a refusal — the primary button stays enabled. Empty is the common answer
  // and means the dialog shows no box at all.
  goWarnings: publicProcedure
    .input(z.object({ featureId: z.string() }))
    .query(({ ctx, input }) => goWarnings(ctx, input.featureId)),

  // B2 behavior — the git stub throws NotImplementedError('B2').
  testDrive: publicProcedure
    .input(
      z.object({
        featureId: z.string(),
        action: z.enum(['start', 'stop']),
        // A scenario file to land on once the app answers (drive-scenarios).
        scenario: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const feature = getFeatureRow(ctx, input.featureId)
      features.requireNotDraft(feature)
      const project = projectForFeature(ctx, feature)
      return git.testDrive(ctx, project, feature, input.action, 'human', {
        ...(input.scenario ? { scenario: input.scenario } : {}),
      })
    }),

  // Active test-drive info for the review-phase dev pane + Open app link. Polled
  // at 1.5s so the async-sniffed localhost URL surfaces once the dev server boots.
  driveInfo: publicProcedure
    .input(z.object({ projectId: z.string() }))
    .query(({ input }) => git.activeDriveInfo(input.projectId)),

  // The scenarios a drive can land on: a feature's (its own first) or, with no
  // feature, the project's checked-out HEAD. Read from git, so the picker lists
  // them before the drive has checked the branch out.
  driveScenarios: publicProcedure
    .input(z.object({ projectId: z.string(), featureId: z.string().optional() }))
    .query(({ ctx, input }) => git.listDriveScenarios(ctx, input.projectId, input.featureId)),

  // Run a scenario against the live drive without a restart. Fire and forget:
  // the run reports through `driveInfo.scenario` and its events, so the answer
  // here is only whether it started.
  runScenario: publicProcedure
    .input(z.object({ projectId: z.string(), file: z.string().min(1) }))
    .mutation(({ ctx, input }): { ok: true } | { ok: false; denied: string } => {
      const started = git.startScenarioOnDrive(ctx, input.projectId, input.file)
      if (!started.ok) return started
      void started.result
      return { ok: true }
    }),

  // Try it: send an API scenario's filled request from the server to the live
  // human or project drive. A request that cannot be sent answers `ok: false`.
  sendCall: publicProcedure
    .input(z.object({ projectId: z.string(), request: FilledHttpRequest }))
    .mutation(({ ctx, input }) => sendDriveCall(ctx, input.projectId, input.request)),

  // ＋ New scenario / Fix it: the `scenario` session docked beside the drive.
  openScenarioChat: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        description: z.string().optional(),
        fixFile: z.string().optional(),
      }),
    )
    .mutation(({ ctx, input }) => launchScenarioSession(ctx, input)),

  // How many commits the branch actually carries over its merge target, for the
  // review summary and the merge confirmation (findings F23). Its own query
  // because `get` is synchronous and this is a git read; `count` is undefined
  // when git cannot tell, which the UI must not paint as zero.
  commitCount: publicProcedure
    .input(z.object({ featureId: z.string() }))
    .query(({ ctx, input }) => {
      const feature = getFeatureRow(ctx, input.featureId)
      return git.reviewCommitCount(projectForFeature(ctx, feature), feature)
    }),

  mergeDelta: publicProcedure
    .input(z.object({ featureId: z.string() }))
    .query(({ ctx, input }) => {
      const feature = getFeatureRow(ctx, input.featureId)
      return git.mergeDelta(projectForFeature(ctx, feature), feature)
    }),

  // The whole merge — drives stopped, outcome doc, shipped, worktree retired,
  // conflict event — is the service the orchestrator's `merge_feature` shares.
  merge: publicProcedure
    .input(z.object({ featureId: z.string() }))
    .mutation(({ ctx, input }) => mergeFeatureFlow(ctx, input.featureId)),
})
