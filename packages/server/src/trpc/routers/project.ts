import { PreparedKey } from '@runcastle/core'
import * as z from 'zod'
import { listFindings } from '../../services/findings'
import { browseDir, listRoots } from '../../services/fsbrowse'
import * as git from '../../services/git'
import { cancelPrep, isPreparing, keysToPrepare, latestPrep, startPrep } from '../../services/prep'
import { launchPrepareSession, launchProjectSession } from '../../launcher/launcher'
import { activeProjectSession } from '../../launcher/sessions'
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

  // --- preparation ----------------------------------------------------------
  // Repo facts an agent establishes once (commands, test baseline, db reset) so
  // no burn agent re-derives them per ticket. See services/prep.ts.

  /**
   * Kick off a preparation run. Returns as soon as the row exists — progress
   * arrives as project events, and `prep` below reports the outcome. `keys: []`
   * means there was nothing left to establish.
   */
  prepare: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        /** Re-measure fields a previous prep run set, not only the empty ones. */
        refresh: z.boolean().optional(),
        /** Restrict the run to specific fields (default: everything in scope). */
        keys: z.array(PreparedKey).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { prepId, keys } = await startPrep(ctx, input.projectId, {
        ...(input.refresh !== undefined ? { refresh: input.refresh } : {}),
        ...(input.keys ? { keys: input.keys } : {}),
      })
      return { prepId, keys }
    }),

  /**
   * Open a preparation CONVERSATION — a project-scoped terminal on the host,
   * seeded with whatever the last headless run established and, more usefully,
   * with what it could not.
   *
   * The headless run measures; this one asks. It exists because the questions
   * that block preparation are not ones a better prompt answers — a real run
   * established seven of eight keys and declined the eighth because supplying it
   * meant inventing a bootstrap step the repo documents nowhere. Unlike the
   * container, this session can also RUN the host-only keys it proposes.
   */
  talkToPrep: publicProcedure
    .input(z.object({ projectId: z.string() }))
    .mutation(({ ctx, input }) => launchPrepareSession(ctx, { projectId: input.projectId })),

  /** The live preparation conversation for this project, if one is open. */
  prepSession: publicProcedure
    .input(z.object({ projectId: z.string() }))
    .query(({ ctx, input }) => activeProjectSession(ctx, input.projectId, 'prepare')),

  /**
   * Open the project's intake CONVERSATION (decisions 17–20) — the session that
   * takes a lump of raw intent, grills it until it resolves into N features, and
   * creates them. It runs on a runcastle-owned branch and lands its commits on
   * the base branch when it ends; it never touches the human's checkout.
   */
  talkToProject: publicProcedure
    .input(z.object({ projectId: z.string() }))
    .mutation(({ ctx, input }) => launchProjectSession(ctx, { projectId: input.projectId })),

  /** The live project conversation for this project, if one is open. */
  projectSession: publicProcedure
    .input(z.object({ projectId: z.string() }))
    .query(({ ctx, input }) => activeProjectSession(ctx, input.projectId, 'project')),

  /** Abort an in-flight preparation run. */
  cancelPrepare: publicProcedure
    .input(z.object({ projectId: z.string() }))
    .mutation(({ input }) => {
      cancelPrep(input.projectId)
      return { ok: true }
    }),

  /**
   * The preparation surface the UI polls: the last run, whether one is live,
   * what would be established if you started one now, and every established
   * finding with its provenance and staleness.
   */
  prep: publicProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      const project = requireProjectById(ctx, input.projectId)
      return {
        latest: latestPrep(ctx, project.id),
        running: isPreparing(project.id),
        pendingKeys: keysToPrepare(ctx, project),
        findings: await listFindings(ctx, project),
      }
    }),
})
