import { FeatureSize, SessionKind } from '@runcastle/core'
import * as z from 'zod'
import { converge, endSession, launchSession, workWaypoint } from '../../launcher/launcher'
import { emit } from '../../services/events'
import * as features from '../../services/features'
import { overrideGate } from '../../services/gates'
import * as git from '../../services/git'
import { getFeatureRow, projectForFeature, setFeatureStatus, setPhase } from '../../services/repo'
import { publicProcedure, router } from '../context'

const gateId = z.enum(['G1', 'G2', 'G3', 'G4', 'G5'])

export const featureRouter = router({
  create: publicProcedure
    .input(
      z.object({
        title: z.string().min(1),
        oneLiner: z.string(),
        size: FeatureSize,
        mapped: z.boolean().optional(),
      }),
    )
    .mutation(({ ctx, input }) => features.createFeature(ctx, input)),

  list: publicProcedure.query(({ ctx }) => features.list(ctx)),

  get: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(({ ctx, input }) => features.getFeatureFull(ctx, input.id)),

  // B1 behavior — the stub throws NotImplementedError('B1').
  launchSession: publicProcedure
    .input(z.object({ featureId: z.string(), kind: SessionKind }))
    .mutation(({ ctx, input }) => launchSession(ctx, input)),

  // Work a frontier waypoint (ADR-0001 §13.2): claim it transactionally, then
  // open a kind=waypoint session on it. Refuses a waypoint not on the frontier,
  // or when a waypoint session is already live (one HITL session per feature).
  workWaypoint: publicProcedure
    .input(z.object({ featureId: z.string(), waypointId: z.string() }))
    .mutation(({ ctx, input }) => workWaypoint(ctx, input)),

  // Converge a mapped feature (ADR-0001 §13.2): crosses G1 (all-waypoints-
  // terminal) into spec and spawns a fresh kind=converge session that runs the
  // existing spec → tickets skills over the compressed knowledge. `overrideReason`
  // forces convergence past open/claimed waypoints (records a G1 override).
  converge: publicProcedure
    .input(z.object({ featureId: z.string(), overrideReason: z.string().min(1).optional() }))
    .mutation(({ ctx, input }) =>
      converge(ctx, { featureId: input.featureId, overrideReason: input.overrideReason }),
    ),

  // End a live session (End session button; terminal-tab close is detach only).
  // Route added by W2 (UI-SPEC §6); backed by W1's PTY-killing `endSession`
  // service, re-exported from the launcher so this import path stays stable.
  endSession: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .mutation(({ ctx, input }) => endSession(ctx, input.sessionId)),

  advance: publicProcedure
    .input(z.object({ featureId: z.string() }))
    .mutation(({ ctx, input }) => features.advance(ctx, input.featureId)),

  overrideGate: publicProcedure
    .input(z.object({ featureId: z.string(), gate: gateId, reason: z.string().min(1) }))
    .mutation(({ ctx, input }) => overrideGate(ctx, input.featureId, input.gate, input.reason)),

  burn: publicProcedure
    .input(z.object({ featureId: z.string() }))
    .mutation(({ ctx, input }) => features.burn(ctx, input.featureId)),

  // B2 behavior — the git stub throws NotImplementedError('B2').
  testDrive: publicProcedure
    .input(z.object({ featureId: z.string(), action: z.enum(['start', 'stop']) }))
    .mutation(async ({ ctx, input }) => {
      const feature = getFeatureRow(ctx, input.featureId)
      const project = projectForFeature(ctx, feature)
      return git.testDrive(ctx, project, feature, input.action)
    }),

  // B2 behavior — the git stub throws; the success path (set phase shipped) is
  // wired now so B2 only fills in `mergeFeature`.
  merge: publicProcedure
    .input(z.object({ featureId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const feature = getFeatureRow(ctx, input.featureId)
      const project = projectForFeature(ctx, feature)
      // A test drive of THIS feature holds the main checkout on the feature
      // branch; stop it first (restores main) so the merge can proceed. This lets
      // the Merge button work whether or not the branch is currently test-driven.
      if (git.activeTestDriveFeatureId() === feature.id) {
        await git.testDrive(ctx, project, feature, 'stop')
      }
      const res = await git.mergeFeature(project, feature)
      if (res.ok) {
        setPhase(ctx, input.featureId, 'shipped', 'feature.shipped', `merged to ${project.mainBranch}`)
        setFeatureStatus(ctx, input.featureId, 'shipped')
      } else {
        emit(ctx, input.featureId, {
          type: 'merge.conflict',
          message: 'merge conflict — resolve and retry',
          data: { conflict: res.conflict },
        })
      }
      return { ok: res.ok, conflict: res.conflict }
    }),
})
