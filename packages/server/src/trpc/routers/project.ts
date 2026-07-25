import * as z from 'zod'
import { browseDir, listRoots } from '../../services/fsbrowse'
import * as git from '../../services/git'
import { closeProject, listProjects, openProject, renameProject } from '../../services/projects'
import { requireProjectById } from '../../services/repo'
import { publicProcedure, router } from '../context'

export const projectRouter = router({
  list: publicProcedure.query(({ ctx }) => listProjects(ctx)),

  // --- repo picker ----------------------------------------------------------
  // These two back the browse dialog in front of `open`. They live on the
  // project router (rather than a new top-level one) because they exist purely
  // to produce a `repoPath` for `project.open`. They read the *server's*
  // filesystem by design — see services/fsbrowse.ts for why a browser-side
  // picker cannot work here.

  /** Filesystem roots + home/common-code jump-off points for the picker rail. */
  roots: publicProcedure.query(() => listRoots()),

  /** Subdirectories of `dir` (default: home), each flagged if it is a git repo. */
  browse: publicProcedure
    .input(
      z
        .object({ dir: z.string().optional(), showHidden: z.boolean().optional() })
        .optional(),
    )
    .query(({ input }) => browseDir(input?.dir, input?.showHidden ?? false)),

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
