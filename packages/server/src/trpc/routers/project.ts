import * as z from 'zod'
import { ProjectName } from '@runcastle/core'
import { browseDir, listRoots } from '../../services/fsbrowse'
import * as git from '../../services/git'
import { prepView } from '../../services/prep'
import { launchPrepareSession, launchProjectSession } from '../../launcher/launcher'
import { activeProjectSession } from '../../launcher/sessions'
import { conversationTranscript, listProjectConversations } from '../../services/conversations'
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

  /**
   * Where the project session's work lands, as the picker needs it: what a human
   * picked (`stored`, null until one does), what the next launch will actually
   * use (`effective`), and the detected main line behind the unpicked default
   * (`detected`). Reading never writes — the pick is made through
   * `settings.update` with key `sessionBranch`.
   */
  sessionBranch: publicProcedure
    .input(z.object({ projectId: z.string() }))
    .query(({ ctx, input }) => git.sessionBranchView(requireProjectById(ctx, input.projectId))),

  open: publicProcedure
    .input(z.object({ repoPath: z.string().min(1) }))
    .mutation(({ ctx, input }) => openProject(ctx, input.repoPath)),

  close: publicProcedure
    .input(z.object({ projectId: z.string() }))
    .mutation(({ ctx, input }) => closeProject(ctx, input.projectId)),

  rename: publicProcedure
    .input(z.object({ projectId: z.string(), name: ProjectName }))
    .mutation(({ ctx, input }) => renameProject(ctx, input.projectId, input.name)),

  // `project.update` is retired (issue #46): devCommand (and model/sandbox) now
  // read/write through the `settings` router as per-project overrides.

  // --- preparation ----------------------------------------------------------
  // Repo facts an agent establishes once (commands, test baseline, db reset) so
  // no burn agent re-derives them per ticket. See services/prep.ts.

  /**
   * Open the preparation CONVERSATION — a project-scoped terminal on the host,
   * seeded with what is already established and what is not.
   *
   * The only way to prepare a project. The questions that block preparation are
   * not ones a better prompt answers — how this machine's dev server starts,
   * which database a drive should point at — so preparation asks them, and can
   * actually RUN the answers here, which a sandbox never could.
   *
   * `fresh` opens it without picking the last conversation back up: re-preparing
   * a project whose baseline has drifted means re-asking questions the resumed
   * transcript already believes it answered.
   */
  talkToPrep: publicProcedure
    .input(z.object({ projectId: z.string(), fresh: z.boolean().optional() }))
    .mutation(({ ctx, input }) =>
      launchPrepareSession(ctx, { projectId: input.projectId, fresh: input.fresh }),
    ),

  /** The live preparation conversation for this project, if one is open. */
  prepSession: publicProcedure
    .input(z.object({ projectId: z.string() }))
    .query(({ ctx, input }) => activeProjectSession(ctx, input.projectId, 'prepare')),

  /**
   * Open a project intake CONVERSATION (decisions 17–20) — the session that
   * takes a lump of raw intent, grills it until it resolves into N features, and
   * creates them. It runs on a runcastle-owned branch and lands its commits on
   * the base branch when it ends; it never touches the human's checkout.
   *
   * Opens a NEW conversation by default (decision 5). `resumeSessionId` names a
   * row from {@link conversations} to pick back up instead; `fresh` says so
   * explicitly and overrules it.
   */
  talkToProject: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        fresh: z.boolean().optional(),
        resumeSessionId: z.string().optional(),
      }),
    )
    .mutation(({ ctx, input }) => launchProjectSession(ctx, input)),

  /** The live project conversation for this project, if one is open. */
  projectSession: publicProcedure
    .input(z.object({ projectId: z.string() }))
    .query(({ ctx, input }) => activeProjectSession(ctx, input.projectId, 'project')),

  /**
   * Every project conversation, newest first (decision 5) — the workspace's
   * list. Includes the live one, so the list is the whole history rather than
   * "the ones that are over".
   */
  conversations: publicProcedure
    .input(z.object({ projectId: z.string() }))
    .query(({ ctx, input }) => listProjectConversations(ctx, input.projectId)),

  /** One conversation's turns, for the read-only transcript pane; empty when its transcript is gone. */
  conversationTranscript: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .query(({ ctx, input }) => conversationTranscript(ctx, input.sessionId)),

  /**
   * The preparation surface the UI polls: what is still open, every established
   * finding with its provenance and staleness, and whether this project still
   * needs the call-to-action at all.
   */
  prep: publicProcedure
    .input(z.object({ projectId: z.string() }))
    .query(({ ctx, input }) => prepView(ctx, requireProjectById(ctx, input.projectId))),

  /**
   * Tear down a preparation dry-run drive by hand (decision 9). The prep session
   * normally runs both halves itself, but it can die mid-run — and what it
   * leaves up is a dev server and a temp database on the human's machine, so the
   * stop half has to be reachable without it.
   */
  dryRunStop: publicProcedure
    .input(z.object({ projectId: z.string() }))
    .mutation(({ ctx, input }) =>
      git.dryRunDrive(ctx, requireProjectById(ctx, input.projectId), 'stop'),
    ),
})
