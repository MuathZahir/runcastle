import { AgentRuntime, configuredRuntimes, newId } from '@runcastle/core'
import { isNotNull } from 'drizzle-orm'
import * as z from 'zod'
import { projects } from '../../db/schema'
import { runDoctor } from '../../doctor/doctor'
import { createSystemExec } from '../../doctor/system-exec'
import { ptyRegistry } from '../../pty/registry'
import { rosterConfig } from '../../services/model-discovery'
import { seedModelDefaults, terminalSpec, writeGitIdentity } from '../../services/setup'
import { resolveSpawnTarget } from '../../util/resolve-executable'
import { publicProcedure, router } from '../context'

/**
 * Per-command bound on the doctor's probes. The app's landing is held on this
 * report, so a command still waiting at this point is reported as failing.
 */
const DOCTOR_PROBE_TIMEOUT_MS = 10_000

/**
 * First-run wizard backend (issue #50, SPEC §F). Drives the one blocking wizard
 * step (git identity → git config), a live prerequisite report, and the two
 * embedded sign-in terminals over the existing PTY/WS transport.
 */
export const setupRouter = router({
  /** The full prerequisite report the wizard reads (per-runtime readiness, git, ...). */
  doctor: publicProcedure.query(({ ctx }) => {
    // Which runtimes count as errors when they are missing: every one some
    // configured model resolves to. Per-project overrides join the global
    // default and the step matrix here.
    const projectModels = ctx.db
      .select({ model: projects.model })
      .from(projects)
      .where(isNotNull(projects.model))
      .all()
      .map((p) => p.model)
    return runDoctor({
      // The app's first screen waits on this report, so each probe gets a short leash.
      exec: createSystemExec({ timeoutMs: DOCTOR_PROBE_TIMEOUT_MS }),
      runtimes: configuredRuntimes(rosterConfig(ctx), projectModels),
    })
  }),

  /** The wizard's one hard step: write git identity globally, re-probe. */
  gitIdentity: publicProcedure
    .input(z.object({ name: z.string(), email: z.string() }))
    .mutation(({ input }) => writeGitIdentity(createSystemExec(), input)),

  /**
   * Onboarding completion: seed the global default + smoke model from the pair
   * of a runtime the operator actually authed (decision 7). Ordinary settings
   * writes — each emits its own `settings.updated` event.
   */
  seedModelDefaults: publicProcedure
    .input(z.object({ runtimes: z.array(AgentRuntime) }))
    .mutation(({ ctx, input }) => seedModelDefaults(ctx, input.runtimes)),

  /**
   * Spawn one of the embedded sign-in terminals and return its session id; the
   * web `TerminalView` attaches over `/ws/terminal/:sessionId`.
   */
  startTerminal: publicProcedure
    .input(z.object({ kind: z.enum(['claude-login', 'codex-login']) }))
    .mutation(({ input }) => {
      const sessionId = newId('setup')
      const spec = { ...terminalSpec(input.kind), cwd: process.cwd() }
      // Resolve through PATHEXT like the launcher does for `claude` — a bare
      // spawn misses a Windows `.cmd`/`.ps1` shim, and ConPTY can't exec any
      // shim directly, so each goes via its interpreter.
      const { file, args } = resolveSpawnTarget(spec.cmd, spec.args)
      ptyRegistry().create({
        sessionId,
        cmd: file,
        args,
        opts: { cwd: spec.cwd, env: process.env },
      })
      return { sessionId }
    }),
})
