import { FeatureSize, SessionKind } from '@runcastle/core'
import * as z from 'zod'
import { launchSession } from '../../launcher/launcher'
import { emit } from '../../services/events'
import * as features from '../../services/features'
import { overrideGate } from '../../services/gates'
import * as git from '../../services/git'
import { getFeatureRow, requireProject, setFeatureStatus, setPhase } from '../../services/repo'
import { publicProcedure, router } from '../context'

const gateId = z.enum(['G1', 'G2', 'G3', 'G4', 'G5'])

export const featureRouter = router({
  create: publicProcedure
    .input(z.object({ title: z.string().min(1), oneLiner: z.string(), size: FeatureSize }))
    .mutation(({ ctx, input }) => features.createFeature(ctx, input)),

  list: publicProcedure.query(({ ctx }) => features.list(ctx)),

  get: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(({ ctx, input }) => features.getFeatureFull(ctx, input.id)),

  // B1 behavior — the stub throws NotImplementedError('B1').
  launchSession: publicProcedure
    .input(z.object({ featureId: z.string(), kind: SessionKind }))
    .mutation(({ ctx, input }) => launchSession(ctx, input)),

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
      const project = requireProject(ctx)
      const feature = getFeatureRow(ctx, input.featureId)
      return git.testDrive(ctx, project, feature, input.action)
    }),

  // B2 behavior — the git stub throws; the success path (set phase shipped) is
  // wired now so B2 only fills in `mergeFeature`.
  merge: publicProcedure
    .input(z.object({ featureId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const project = requireProject(ctx)
      const feature = getFeatureRow(ctx, input.featureId)
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
