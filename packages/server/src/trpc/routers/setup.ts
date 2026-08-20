import { AgentRuntime, configuredRuntimes, newId, resolveSandboxImage } from '@runcastle/core'
import { isNotNull } from 'drizzle-orm'
import * as z from 'zod'
import { projects } from '../../db/schema'
import { runDoctor } from '../../doctor/doctor'
import { createSystemExec } from '../../doctor/system-exec'
import { ptyRegistry } from '../../pty/registry'
import {
  fileAfkTokenIo,
  prepareSandboxBuildContext,
  resolveRuntime,
  resolveSandcastleBin,
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
      runtimes: configuredRuntimes(ctx.config, projectModels),
      ...(ctx.config.sandboxImage ? { imageName: ctx.config.sandboxImage } : {}),
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
    .input(z.object({ kind: z.enum(['setup-token', 'build-image', 'claude-login', 'codex-login']) }))
    .mutation(async ({ ctx, input }) => {
      const exec = createSystemExec()
      const preferred = ctx.config.sandbox === 'podman' ? 'podman' : 'docker'
      const runtime = await resolveRuntime(exec, preferred)
      const imageName = resolveSandboxImage(ctx.config)
      // `build-image` runs the vendored sandcastle CLI, whose bin is never on the
      // user's PATH in a global install — resolve its entrypoint so we can launch
      // it under node instead of a bare (missing) `sandcastle`.
      const sandcastleBin =
        input.kind === 'build-image' ? (resolveSandcastleBin() ?? undefined) : undefined
      const spec = terminalSpec(input.kind, { runtime, imageName, sandcastleBin })
      const sessionId = newId('setup')
      // `build-image` runs `sandcastle <runtime> build-image`, which fails with
      // "No .sandcastle/ found" unless its cwd holds a `.sandcastle/` build
      // context. Scaffold a vetted one into a runcastle-owned dir first so a
      // fresh install never dead-ends (issue #50) — create-only, both runtimes.
      const cwd = input.kind === 'build-image' ? prepareSandboxBuildContext() : process.cwd()
      // Resolve through PATHEXT like the launcher does for `claude` — a bare
      // `spawn('sandcastle'|'claude')` misses a Windows `.cmd`/`.ps1` shim, and
      // ConPTY can't exec any shim directly, so each goes via its interpreter.
      const { file, args } = resolveSpawnTarget(spec.cmd, spec.args)
      ptyRegistry().create({
        sessionId,
        cmd: file,
        args,
        opts: { cwd, env: process.env },
      })
      return { sessionId }
    }),
})
