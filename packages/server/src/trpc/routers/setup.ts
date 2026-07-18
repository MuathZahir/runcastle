import { newId } from '@runcastle/core'
import * as z from 'zod'
import { runDoctor } from '../../doctor/doctor'
import { createSystemExec } from '../../doctor/system-exec'
import { ptyRegistry } from '../../pty/registry'
import {
  fileAfkTokenIo,
  resolveRuntime,
  runtimeInstallGuide,
  saveAfkToken,
  terminalSpec,
  writeGitIdentity,
} from '../../services/setup'
import { resolveExecutable } from '../../util/resolve-executable'
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
  /** The full prerequisite report the AFK card reads (runtime, image, token, …). */
  doctor: publicProcedure.query(({ ctx }) =>
    runDoctor({
      exec: createSystemExec(),
      ...(ctx.config.sandboxImage ? { imageName: ctx.config.sandboxImage } : {}),
    }),
  ),

  /** OS-specific guided-manual runtime install line + follow-up note. */
  runtimeGuide: publicProcedure.query(() => runtimeInstallGuide(process.platform)),

  /** The wizard's one hard step: write git identity globally, re-probe. */
  gitIdentity: publicProcedure
    .input(z.object({ name: z.string(), email: z.string() }))
    .mutation(({ input }) => writeGitIdentity(createSystemExec(), input)),

  /** Capture the AFK OAuth token into `~/.runcastle/.env` and validity-check it. */
  afkToken: publicProcedure
    .input(z.object({ token: z.string() }))
    .mutation(({ input }) => saveAfkToken(fileAfkTokenIo(createSystemExec()), input.token)),

  /**
   * Spawn one of the embedded-terminal flows and return its session id; the web
   * `TerminalView` attaches over `/ws/terminal/:sessionId`. `build-image` streams
   * its output there; `setup-token` runs the interactive login (which self-heals
   * its own host-login prompt — we never probe host login ourselves).
   */
  startTerminal: publicProcedure
    .input(z.object({ kind: z.enum(['setup-token', 'build-image']) }))
    .mutation(async ({ ctx, input }) => {
      const exec = createSystemExec()
      const preferred = ctx.config.sandbox === 'podman' ? 'podman' : 'docker'
      const runtime = await resolveRuntime(exec, preferred)
      const imageName = ctx.config.sandboxImage ?? 'sandcastle:runcastle'
      const spec = terminalSpec(input.kind, { runtime, imageName })
      const sessionId = newId('setup')
      // Resolve through PATHEXT like the launcher does for `claude` — a bare
      // `spawn('sandcastle'|'claude')` misses a Windows `.cmd` shim, and ConPTY
      // can't exec a `.cmd`/`.bat` directly, so route those through cmd.exe.
      const resolved = resolveExecutable(spec.cmd)
      const isShim = /\.(cmd|bat)$/i.test(resolved)
      const file = isShim ? (process.env.ComSpec ?? 'cmd.exe') : resolved
      const args = isShim ? ['/c', resolved, ...spec.args] : spec.args
      ptyRegistry().create({
        sessionId,
        cmd: file,
        args,
        opts: { cwd: process.cwd(), env: process.env },
      })
      return { sessionId }
    }),
})
