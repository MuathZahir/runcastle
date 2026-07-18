import * as z from 'zod'
import {
  closeProject,
  listProjects,
  openProject,
  renameProject,
  updateProject,
} from '../../services/projects'
import { publicProcedure, router } from '../context'

export const projectRouter = router({
  list: publicProcedure.query(({ ctx }) => listProjects(ctx)),

  open: publicProcedure
    .input(z.object({ repoPath: z.string().min(1) }))
    .mutation(({ ctx, input }) => openProject(ctx, input.repoPath)),

  close: publicProcedure
    .input(z.object({ projectId: z.string() }))
    .mutation(({ ctx, input }) => closeProject(ctx, input.projectId)),

  rename: publicProcedure
    .input(z.object({ projectId: z.string(), name: z.string().min(1) }))
    .mutation(({ ctx, input }) => renameProject(ctx, input.projectId, input.name)),

  // Retired by the settings ticket; kept explicit-by-id through the singleton removal.
  update: publicProcedure
    .input(z.object({ projectId: z.string(), devCommand: z.string().optional() }))
    .mutation(({ ctx, input }) =>
      updateProject(ctx, input.projectId, { devCommand: input.devCommand }),
    ),
})
