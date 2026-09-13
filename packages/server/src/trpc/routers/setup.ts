import { join } from 'node:path'
import {
  AgentRuntime,
  DEFAULT_SANDBOX_IMAGE,
  configuredRuntimes,
  newId,
  resolveSandboxImage,
  type Project,
} from '@runcastle/core'
import { isNotNull } from 'drizzle-orm'
import * as z from 'zod'
import { projects } from '../../db/schema'
import type { AppCtx } from '../../db/types'
import { envWithAfkCredentials } from '../../doctor/afk-env'
import { runDoctor, type ProjectImageEnv } from '../../doctor/doctor'
import { createSystemExec } from '../../doctor/system-exec'
import { InvalidInputError } from '../../errors'
import { burnerDockerfilePath } from '../../launcher/asset-paths'
import { ptyRegistry } from '../../pty/registry'
import { isOverwritable } from '../../services/findings'
import { adoptProjectImage, releaseProjectImage } from '../../services/project-image'
import { allProjects, requireProjectById } from '../../services/repo'
import {
  hashDockerfile,
  imageBuildTerminal,
  inspectBuiltImage,
  planImageBuild,
  stockBuildArgs,
  type ImageBuildTerminal,
} from '../../services/sandbox-image'
import {
  fileAfkTokenIo,
  prepareSandboxBuildContext,
  resolveRuntime,
  runtimeInstallGuide,
  saveAfkCredential,
  seedModelDefaults,
  terminalSpec,
  writeGitIdentity,
} from '../../services/setup'
import { resolveSpawnTarget } from '../../util/resolve-executable'
import { publicProcedure, router } from '../context'

/**
 * First-run wizard + Enable-AFK card backend (issue #50, SPEC §F). Drives the
 * one blocking wizard step (git identity → git config) and the AFK card's
 * non-blocking setup: a live prerequisite report, the OS-specific runtime
 * install guide, capturing the `claude setup-token` output into the data-dir env
 * file with a validity check, and spawning the two embedded-terminal flows
 * (setup-token login, image build) over the existing PTY/WS transport.
 */
export const setupRouter = router({
  /** The full prerequisite report the wizard and AFK card read (per-runtime readiness, runtime, image, …). */
  doctor: publicProcedure
    .input(
      z
        .object({
          /**
           * Whose image row this report is about. Absent in the first-run
           * wizard, which may run before any project exists — there the image
           * question is the machine-wide one.
           */
          projectId: z.string().optional(),
        })
        .optional(),
    )
    .query(({ ctx, input }) => {
      // Which runtimes count as errors when they are missing: every one some
      // configured model resolves to. Per-project overrides join the global
      // default and the step matrix here; per-ticket assignments will too once
      // tickets carry a model of their own.
      const projectModels = ctx.db
        .select({ model: projects.model })
        .from(projects)
        .where(isNotNull(projects.model))
        .all()
        .map((p) => p.model)
      const project = input?.projectId ? requireProjectById(ctx, input.projectId) : null
      return runDoctor({
        exec: createSystemExec(),
        burnerDockerfile: burnerDockerfilePath(),
        // Read the data-dir `.env` fresh on every query: the AFK card writes the
        // token there through `afkToken` while the server runs, so a probe that
        // saw only `process.env` would keep reporting it missing forever.
        env: envWithAfkCredentials(),
        runtimes: configuredRuntimes(ctx.config, projectModels),
        // Deliberately WITHOUT the project: the probe layers the project column
        // over this itself, so that clearing an orphaned column (decision 8)
        // leaves it reporting on the image resolution falls back to.
        imageName: resolveSandboxImage(ctx.config),
        // Every project on this install, so the image row can tell a legacy
        // machine-wide tag (named after a project runcastle no longer has, or
        // never had) from an image someone chose on purpose.
        knownProjectIds: allProjects(ctx).map((p) => p.id),
        ...(project ? { projectImage: projectImageEnv(ctx, project) } : {}),
      })
    }),

  /** OS-specific guided-manual runtime install line + follow-up note. */
  runtimeGuide: publicProcedure.query(() => runtimeInstallGuide(process.platform)),

  /** The wizard's one hard step: write git identity globally, re-probe. */
  gitIdentity: publicProcedure
    .input(z.object({ name: z.string(), email: z.string() }))
    .mutation(({ input }) => writeGitIdentity(createSystemExec(), input)),

  /**
   * Capture a runtime's AFK credential into `~/.runcastle/.env` (Claude Code's
   * OAuth token, Codex's `CODEX_API_KEY`) and validity-check it.
   */
  afkToken: publicProcedure
    .input(z.object({ token: z.string(), runtime: AgentRuntime.default('claude-code') }))
    .mutation(({ input }) =>
      saveAfkCredential(
        fileAfkTokenIo(createSystemExec(), input.runtime),
        input.token,
        input.runtime,
      ),
    ),

  /**
   * Onboarding completion: seed the global default + smoke model from the pair
   * of a runtime the operator actually authed (decision 7). Ordinary settings
   * writes — each emits its own `settings.updated` event.
   */
  seedModelDefaults: publicProcedure
    .input(z.object({ runtimes: z.array(AgentRuntime) }))
    .mutation(({ ctx, input }) => seedModelDefaults(ctx, input.runtimes)),

  /**
   * Spawn one of the embedded-terminal flows and return its session id; the web
   * `TerminalView` attaches over `/ws/terminal/:sessionId`. `build-image` streams
   * its output there; `claude-login`/`codex-login` run each runtime's own
   * interactive sign-in; `setup-token` runs Claude Code's long-lived AFK-token
   * flow (which self-heals its own host-login prompt on the way).
   */
  startTerminal: publicProcedure
    .input(
      z.object({
        kind: z.enum(['setup-token', 'build-image', 'claude-login', 'codex-login']),
        /**
         * Whose image `build-image` builds. Absent in the first-run wizard,
         * which may run before any project exists — that build is the stock one.
         */
        projectId: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const sessionId = newId('setup')
      const { spec, onExit } =
        input.kind === 'build-image'
          ? await buildImageTerminal(ctx, input.projectId)
          : { spec: { ...terminalSpec(input.kind), cwd: process.cwd() }, onExit: undefined }

      // Resolve through PATHEXT like the launcher does for `claude` — a bare
      // `spawn('docker'|'claude')` misses a Windows `.cmd`/`.ps1` shim, and
      // ConPTY can't exec any shim directly, so each goes via its interpreter.
      const { file, args } = resolveSpawnTarget(spec.cmd, spec.args)
      ptyRegistry().create({
        sessionId,
        cmd: file,
        args,
        opts: { cwd: spec.cwd, env: process.env },
        ...(onExit ? { onExit } : {}),
      })
      return { sessionId }
    }),
})

/**
 * The db half of the doctor's image row: what the project stores, whether
 * runcastle may rewrite it, and how it lets go of a value whose Dockerfile has
 * been deleted (decision 8). Kept here rather than in the probe so the doctor
 * library stays injected and testable without a database.
 */
function projectImageEnv(ctx: AppCtx, project: Project): ProjectImageEnv {
  return {
    id: project.id,
    repoPath: project.repoPath,
    stored: project.sandboxImage ?? null,
    overwritable: isOverwritable(ctx, project.id, 'sandboxImage'),
    clearStored: () => releaseProjectImage(ctx, project.id),
  }
}

/**
 * The image build behind the AFK card's Build button: refresh the stock context,
 * ask the built stock image whether it still matches its Dockerfile, and plan
 * the build from the project's own state — stock alone, the two-step chain when
 * the repo carries `.runcastle/sandbox/Dockerfile`, or nothing at all when the
 * image is a tag runcastle does not manage (decision 5 — the button must never
 * build the stock template under someone's custom tag, and must not build a
 * project image a hand-typed setting would keep every burn away from).
 *
 * A chain that exits 0 adopts its project image as the project's `sandboxImage`,
 * on the PTY's own exit: the build IS the event that makes the tag real, and
 * writing the column any earlier would point every image consumer at a tag no
 * image answers to.
 */
async function buildImageTerminal(
  ctx: AppCtx,
  projectId: string | undefined,
): Promise<{ spec: ImageBuildTerminal; onExit?: (info: { exitCode: number }) => void }> {
  const exec = createSystemExec()
  const runtime = await resolveRuntime(exec, ctx.config.sandbox === 'podman' ? 'podman' : 'docker')
  const project = projectId ? requireProjectById(ctx, projectId) : null
  const stockContext = prepareSandboxBuildContext()
  const stockHash = hashDockerfile(join(stockContext, 'Dockerfile'))
  const plan = planImageBuild({
    config: ctx.config,
    project: project
      ? {
          id: project.id,
          repoPath: project.repoPath,
          sandboxImage: project.sandboxImage,
          sandboxImageOverwritable: isOverwritable(ctx, project.id, 'sandboxImage'),
        }
      : null,
    stockContext,
    stockFresh:
      stockHash !== null &&
      (await inspectBuiltImage(exec, runtime, DEFAULT_SANDBOX_IMAGE)).hash === stockHash,
    buildArgs: stockBuildArgs(runtime),
  })
  if (plan.kind === 'refused') throw new InvalidInputError(plan.reason)

  const spec = imageBuildTerminal(runtime, plan)
  if (plan.kind !== 'chain' || !project) return { spec }
  const { projectTag } = plan
  return {
    spec,
    onExit: ({ exitCode }) => {
      if (exitCode === 0) adoptProjectImage(ctx, project.id, projectTag)
    },
  }
}
