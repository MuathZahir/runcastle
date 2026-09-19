import { MergeBranchPair, SessionKind, SessionPurpose, unresolvedMergeConflict } from '@runcastle/core'
import * as z from 'zod'
import {
  converge,
  endSession,
  launchDriveFixSession,
  launchSession,
  workWaypoint,
} from '../../launcher/launcher'
import { burnWarnings } from '../../services/burn-warnings'
import { emit, listAfter } from '../../services/events'
import * as features from '../../services/features'
import * as git from '../../services/git'
import { promoteOutcomeDoc } from '../../services/outcome'
import { getFeatureRow, projectForFeature, setFeatureStatus, setPhase } from '../../services/repo'
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
    .query(({ ctx, input }) => features.getFeatureFull(ctx, input.id)),

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

  // Work a frontier waypoint (ADR-0001 §13.2): claim it transactionally, then
  // open a kind=waypoint session on it. Refuses a waypoint not on the frontier,
  // or when a waypoint session is already live (one HITL session per feature).
  // A finished live session is ended for us; `endLive` — set only after the human
  // confirms — additionally abandons one that is still mid-work (decision #8).
  workWaypoint: publicProcedure
    .input(
      z.object({ featureId: z.string(), waypointId: z.string(), endLive: z.boolean().optional() }),
    )
    .mutation(({ ctx, input }) => workWaypoint(ctx, input)),

  // Converge a mapped feature (ADR-0001 §13.2): spawns a fresh kind=converge
  // session that runs the existing spec → tickets skills over the compressed
  // knowledge. The feature remains in Planning throughout.
  converge: publicProcedure
    .input(z.object({ featureId: z.string() }))
    .mutation(({ ctx, input }) => converge(ctx, { featureId: input.featureId })),

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

  burn: publicProcedure
    // `model` is a per-run override (issue #48) — the scripted smoke passes its
    // cheap model here instead of the retired RUNCASTLE_MODEL env hack.
    .input(z.object({ featureId: z.string(), model: z.string().min(1).optional() }))
    .mutation(({ ctx, input }) => features.burn(ctx, input.featureId, { modelOverride: input.model })),

  agenticReview: publicProcedure
    .input(z.object({ featureId: z.string() }))
    .mutation(({ ctx, input }) => features.agenticReview(ctx, input.featureId)),

  // What the Burn confirm dialog prints in its warn box (decisions §5), in the
  // `mergeDelta` pattern: computed server-side so the UI never re-derives
  // policy, and never a refusal — the primary button stays enabled. Empty is
  // the common answer and means the dialog shows no box at all.
  burnWarnings: publicProcedure
    .input(z.object({ featureId: z.string() }))
    .query(({ ctx, input }) => burnWarnings(ctx, input.featureId)),

  // B2 behavior — the git stub throws NotImplementedError('B2').
  testDrive: publicProcedure
    .input(z.object({ featureId: z.string(), action: z.enum(['start', 'stop']) }))
    .mutation(async ({ ctx, input }) => {
      const feature = getFeatureRow(ctx, input.featureId)
      features.requireNotDraft(feature)
      const project = projectForFeature(ctx, feature)
      return git.testDrive(ctx, project, feature, input.action)
    }),

  // Active test-drive info for the review-phase dev pane + Open app link. Polled
  // at 1.5s so the async-sniffed localhost URL surfaces once the dev server boots.
  driveInfo: publicProcedure.query(() => git.activeDriveInfo()),

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

  // B2 behavior — the git stub throws; the success path (set phase shipped) is
  // wired now so B2 only fills in `mergeFeature`.
  merge: publicProcedure
    .input(z.object({ featureId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const feature = getFeatureRow(ctx, input.featureId)
      features.requireNotDraft(feature)
      const project = projectForFeature(ctx, feature)
      // A test drive of THIS feature holds the main checkout on the feature
      // branch; stop it first (restores main) so the merge can proceed. This lets
      // the Merge button work whether or not the branch is currently test-driven.
      if (git.activeTestDriveFeatureId() === feature.id) {
        await git.testDrive(ctx, project, feature, 'stop')
      }
      const delta = await git.mergeDelta(project, feature)
      const standingConflict = unresolvedMergeConflict(listAfter(ctx, feature.id, 0))
      const res = await git.mergeFeature(project, feature)
      if (res.ok) {
        if (standingConflict) {
          emit(ctx, input.featureId, {
            type: 'merge.resolved',
            message: 'conflict retired by the merge',
          })
        }
        await promoteOutcomeDoc(ctx, project, feature, res.target, delta)
        setPhase(ctx, input.featureId, 'shipped', 'feature.shipped', `merged to ${res.target}`)
        setFeatureStatus(ctx, input.featureId, 'shipped')
      } else {
        // Carry the base branch + conflicting files on the event so the review
        // UI can surface the conflict card after a reload and brief the
        // resolve-with-agent session (kickoff needs both).
        emit(ctx, input.featureId, {
          type: 'merge.conflict',
          message: 'merge conflict — resolve and retry',
          data: { conflict: res.conflict, base: res.target, files: res.files ?? [] },
        })
      }
      return { ok: res.ok, conflict: res.conflict, base: res.target, files: res.files ?? [] }
    }),
})
