import { Effort, FeatureFinish, FilledHttpRequest, MergeBranchPair, SessionKind, SessionPurpose } from '@runcastle/core'
import * as z from 'zod'
import { endSession, launchSession } from '../../launcher/launcher'
import { listFeatureSessions } from '../../services/conversations'
import { setDependencies, setUpNext } from '../../services/dependencies'
import { sendDriveCall } from '../../services/drive-call'
import * as features from '../../services/features'
import * as git from '../../services/git'
import { setOwner } from '../../services/holding'
import { mergeFeatureFlow } from '../../services/merge'
import { getFeatureRow, projectForFeature, tryGetFeature } from '../../services/repo'
import { reconcileStandingConflict } from '../../services/resolved-merge'
import { listRounds } from '../../services/runs'
import { startDriveWorker } from '../../workers/drive'
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

  // Set or clear the up-next mark on a draft (`waiting-is-not-backlog`): the
  // page's "Start when ready" / "Move to backlog" buttons.
  setUpNext: publicProcedure
    .input(z.object({ featureId: z.string(), upNext: z.boolean() }))
    .mutation(({ ctx, input }) => setUpNext(ctx, input.featureId, input.upNext)),

  // The owner control and the row menu (every-feature-has-one-owner decisions
  // 11, 21): `you` makes the feature the human's; `show` / `merge` give it to
  // its chat, refused (BAD_REQUEST) when it has none.
  setOwner: publicProcedure
    .input(z.object({ featureId: z.string(), choice: FeatureFinish }))
    .mutation(({ ctx, input }) => setOwner(ctx, input.featureId, input.choice)),

  list: publicProcedure
    .input(z.object({ projectId: z.string() }))
    .query(({ ctx, input }) => features.list(ctx, input.projectId)),

  get: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      // Reading the feature is when a stale conflict card would be seen, so a
      // merge committed outside any hook (by hand, or in a chat still live)
      // retires it here. Only on an active feature, where a conflict can stand.
      const feature = tryGetFeature(ctx, input.id)
      if (feature?.status === 'active') await reconcileStandingConflict(ctx, feature)
      return features.getFeatureFull(ctx, input.id)
    }),

  // `kickoffLine` is the per-purpose kickoff override (ticket 3 mechanism): the
  // review-phase Iterate action passes its review-iteration briefing here so the
  // revisit session opens on the right first move instead of the generic line.
  // `purpose` + `purposeData` say what the session was opened to DO, which the
  // briefing alone could not: both conflict-resolve sites mark their session
  // `resolve-conflict` and name the merge, so the edit guard can let it write.
  // `holdOpening` keeps the opening for the human's first message, which the
  // web sends next: one prompt, one answer (chat-as-web-components decision 12).
  launchSession: publicProcedure
    .input(
      z.object({
        featureId: z.string(),
        kind: SessionKind,
        kickoffLine: z.string().min(1).optional(),
        purpose: SessionPurpose.optional(),
        purposeData: MergeBranchPair.optional(),
        holdOpening: z.boolean().optional(),
        // The composer's pick for a chat not started yet (a-new-feature-waits-for-start decision 10).
        model: z.string().optional(),
        effort: Effort.optional(),
        fast: z.boolean().optional(),
      }),
    )
    .mutation(({ ctx, input: { holdOpening, model, effort, fast, ...input } }) => {
      const pick = model || effort || fast !== undefined ? { model, effort, fast } : undefined
      return launchSession(ctx, { ...input, ...(pick ? { pick } : {}) }, { holdOpening })
    }),

  // "Fix drive" — the one click that turns a failed drive into an agent already
  // holding the failure (multi-service decision 9): the feature's Fix-drive
  // worker, started or resumed (drive-chats-become-workers decision 5). It runs
  // in the real checkout beside the failed drive, and is refused when there is
  // no failure to work from.
  fixDrive: publicProcedure
    .input(z.object({ featureId: z.string() }))
    .mutation(({ ctx, input }) => startDriveWorker(ctx, { kind: 'fix-drive', featureId: input.featureId })),

  // The feature's sessions (decision 10): the main chat and a live scenario
  // chat. Side chats are retired (interactive-workers decision 7); the old ones
  // are read-only threads in `thread.list`, and a feature's other conversations
  // are its workers (`worker.list`).
  sessions: publicProcedure
    .input(z.object({ featureId: z.string() }))
    .query(({ ctx, input }) => listFeatureSessions(ctx, input.featureId)),

  // End a live session (End session button; terminal-tab close is detach only).
  // Route added by W2 (UI-SPEC §6); backed by W1's PTY-killing `endSession`
  // service, re-exported from the launcher so this import path stays stable.
  endSession: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .mutation(({ ctx, input }) => endSession(ctx, input.sessionId)),

  // Archive a started feature (decision #8): ends any live session, hides
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

  // Stop (decision 23): cancel the running round, mark the feature stopped so
  // nothing dispatches until the human replies, tell the lead.
  stop: publicProcedure
    .input(z.object({ featureId: z.string() }))
    .mutation(({ ctx, input }) => features.stopFeature(ctx, input.featureId)),

  // Resume after a provider halt: one message to the lead as the human, which
  // clears the wait. Refused unless the feature waits on the provider.
  resume: publicProcedure
    .input(z.object({ featureId: z.string() }))
    .mutation(({ ctx, input }) => features.resumeFeature(ctx, input.featureId)),

  // The round trail's record (decision 16): every round, numbered from 1.
  rounds: publicProcedure
    .input(z.object({ featureId: z.string() }))
    .query(({ ctx, input }) => listRounds(ctx, input.featureId)),

  readyDeclarations: publicProcedure
    .input(z.object({ featureId: z.string() }))
    .query(({ ctx, input }) => features.listReadyDeclarations(ctx, input.featureId)),

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

  // ＋ New scenario / Fix it: the drive owner's Scenarios worker, started or
  // resumed and docked beside the drive (drive-chats-become-workers decisions 2, 5).
  openScenarioChat: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        description: z.string().optional(),
        fixFile: z.string().optional(),
      }),
    )
    .mutation(({ ctx, input }) => startDriveWorker(ctx, { kind: 'scenario', ...input })),

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
