import * as z from 'zod'
import { createSystemExec } from '../../doctor/system-exec'
import { emitProject } from '../../services/events'
import {
  type PhoneLinkDeps,
  phoneLinkStatus,
  turnPhoneLinkOff,
  turnPhoneLinkOn,
} from '../../services/phone-link'
import { publicProcedure, router } from '../context'

/**
 * Settings' "On your phone" (runcastle-on-your-phone, decision 6): whether the
 * private Tailscale link is on, and the one button that turns it on or off.
 * Both mutations answer the fresh status, so the section updates at once.
 */

/** The project whose timeline records the change — the one Settings was opened from. */
const projectInput = z.object({ projectId: z.string() })

/**
 * `tailscale serve` can wait on the human — a tailnet without HTTPS enabled
 * prints a link to enable it and may block. Turn-on stops at that link; this
 * is the last resort for anything else that hangs, well before the default
 * backstop, and with no stdin to wait on.
 */
const PHONE_LINK_TIMEOUT_MS = 15_000

const deps = (): PhoneLinkDeps => ({
  exec: createSystemExec({ timeoutMs: PHONE_LINK_TIMEOUT_MS, noStdin: true }),
})

export const phoneLinkRouter = router({
  status: publicProcedure.query(({ ctx }) => phoneLinkStatus(ctx.config, deps())),

  turnOn: publicProcedure.input(projectInput).mutation(async ({ ctx, input }) => {
    const status = await turnPhoneLinkOn(ctx.config, deps())
    if (status.on && !status.error) {
      emitProject(ctx, input.projectId, {
        type: 'phone_link.changed',
        message: `turned on the phone link at ${status.url}`,
        data: { on: true },
      })
    }
    return status
  }),

  turnOff: publicProcedure.input(projectInput).mutation(async ({ ctx, input }) => {
    const status = await turnPhoneLinkOff(ctx.config, deps())
    if (!status.on) {
      emitProject(ctx, input.projectId, {
        type: 'phone_link.changed',
        message: 'turned off the phone link',
        data: { on: false },
      })
    }
    return status
  }),
})
