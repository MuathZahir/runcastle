import * as z from 'zod'
import { getProject, initProject, updateProject } from '../../services/projects'
import { publicProcedure, router } from '../context'

export const projectRouter = router({
  get: publicProcedure.query(({ ctx }) => getProject(ctx)),

  init: publicProcedure
    .input(z.object({ repoPath: z.string().min(1) }))
    .mutation(({ ctx, input }) => initProject(ctx, input.repoPath)),

  update: publicProcedure
    .input(z.object({ devCommand: z.string().optional() }))
    .mutation(({ ctx, input }) => updateProject(ctx, input)),
})
