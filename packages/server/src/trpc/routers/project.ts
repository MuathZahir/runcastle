import * as z from 'zod'
import * as git from '../../services/git'
import { closeProject, listProjects, openProject, renameProject } from '../../services/projects'
import { requireProjectById } from '../../services/repo'
import { publicProcedure, router } from '../context'

export const projectRouter = router({
  list: publicProcedure.query(({ ctx }) => listProjects(ctx)),

  // Local branches for the create-feature base picker (§4). Returns the current
  // checkout branch, the project default, and all non-`feature/*` local branches.
  branches: publicProcedure
    .input(z.object({ projectId: z.string() }))
    .query(({ ctx, input }) => git.listBranches(requireProjectById(ctx, input.projectId))),

  open: publicProcedure
    .input(z.object({ repoPath: z.string().min(1) }))
    .mutation(({ ctx, input }) => openProject(ctx, input.repoPath)),

  close: publicProcedure
    .input(z.object({ projectId: z.string() }))
    .mutation(({ ctx, input }) => closeProject(ctx, input.projectId)),

  rename: publicProcedure
    .input(z.object({ projectId: z.string(), name: z.string().min(1) }))
    .mutation(({ ctx, input }) => renameProject(ctx, input.projectId, input.name)),

  // `project.update` is retired (issue #46): devCommand (and model/sandbox) now
  // read/write through the `settings` router as per-project overrides.
})
