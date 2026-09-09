import { join } from 'node:path'
import {
  AgentRuntime,
  DEFAULT_SANDBOX_IMAGE,
  configuredRuntimes,
  newId,
  resolveSandboxImage,
} from '@runcastle/core'
import { isNotNull } from 'drizzle-orm'
import * as z from 'zod'
import { projects } from '../../db/schema'
import type { AppCtx } from '../../db/types'
import { envWithAfkCredentials } from '../../doctor/afk-env'
import { runDoctor, type ExecFn } from '../../doctor/doctor'
import { createSystemExec } from '../../doctor/system-exec'
import { InvalidInputError } from '../../errors'
import { burnerDockerfilePath } from '../../launcher/asset-paths'
import { ptyRegistry } from '../../pty/registry'
import { requireProjectById } from '../../services/repo'
import {
  adoptProjectImage,
  builtDockerfileHash,
  hashDockerfile,
  imageBuildTerminal,
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
  type Runtime,
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
  doctor: publicProcedure.query(({ ctx }) => {
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
    return runDoctor({
      exec: createSystemExec(),
      burnerDockerfile: burnerDockerfilePath(),
      // Read the data-dir `.env` fresh on every query: the AFK card writes the
      // token there through `afkToken` while the server runs, so a probe that
      // saw only `process.env` would keep reporting it missing forever.
      env: envWithAfkCredentials(),
      runtimes: configuredRuntimes(ctx.config, projectModels),
      // Through the one resolver every image consumer shares, rather than the
      // raw config field — the probe must inspect the tag a burn would use.
      imageName: resolveSandboxImage(ctx.config),
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
      const exec = createSystemExec()
      const preferred = ctx.config.sandbox === 'podman' ? 'podman' : 'docker'
      const runtime = await resolveRuntime(exec, preferred)
      const sessionId = newId('setup')

      const { spec, onExit } =
        input.kind === 'build-image'
          ? await buildImageTerminal(ctx, exec, runtime, input.projectId)
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
 * The image build behind the AFK card's Build button: refresh the stock context,
 * ask the built stock image whether it still matches its Dockerfile, and plan
 * the build from the project's own state — stock alone, the two-step chain when
 * the repo carries `.runcastle/sandbox/Dockerfile`, or nothing at all when the
 * resolved image is a tag runcastle does not manage (decision 5 — the button
 * must never build the stock template under someone's custom tag).
 *
 * A chain that exits 0 adopts its project image as the project's `sandboxImage`,
 * on the PTY's own exit: the build IS the event that makes the tag real, and
 * writing the column any earlier would point every image consumer at a tag no
 * image answers to.
 */
async function buildImageTerminal(
  ctx: AppCtx,
  exec: ExecFn,
  runtime: Runtime,
  projectId: string | undefined,
): Promise<{ spec: ImageBuildTerminal; onExit?: (info: { exitCode: number }) => void }> {
  const project = projectId ? requireProjectById(ctx, projectId) : null
  const stockContext = prepareSandboxBuildContext()
  const stockHash = hashDockerfile(join(stockContext, 'Dockerfile'))
  const plan = planImageBuild({
    config: ctx.config,
    project,
    stockContext,
    stockFresh:
      stockHash !== null && (await builtDockerfileHash(exec, runtime, DEFAULT_SANDBOX_IMAGE)) === stockHash,
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
