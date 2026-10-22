import * as z from 'zod'
import {
  designServerStatus,
  heartbeatDesignServer,
  rememberDesignPath,
  restartDesignServer,
  startDesignServer,
  stopDesignServer,
} from '../../services/design'
import { sendDesignCrop } from '../../services/design-crop'
import { publicProcedure, router } from '../context'

/**
 * The web's side of a feature's design server (design-mode decision 3). The
 * agent starts it with a command over MCP; the web only ever starts it from the
 * recorded one (Open in design, Restart server), remembers the path it opened, keeps it alive
 * while the design view is on screen, and stops it; its Select area sends a crop to the chat. Thin over
 * `services/design.ts` and `services/design-crop.ts`, which own the events.
 */
export const designRouter = router({
  status: publicProcedure
    .input(z.object({ featureId: z.string() }))
    .query(({ ctx, input }) => designServerStatus(ctx, input.featureId)),

  start: publicProcedure
    .input(z.object({ featureId: z.string() }))
    .mutation(({ ctx, input }) => startDesignServer(ctx, input.featureId)),

  /** The design view's Restart server: stop whatever runs, start from the recorded command. */
  restart: publicProcedure
    .input(z.object({ featureId: z.string() }))
    .mutation(({ ctx, input }) => restartDesignServer(ctx, input.featureId)),

  /** The design view opened at an explicit path (Open in design): `status.lastPath` hands it back on a bare reopen. */
  showPath: publicProcedure
    .input(z.object({ featureId: z.string(), path: z.string().min(1) }))
    .mutation(({ input }) => {
      rememberDesignPath(input.featureId, input.path)
      return { ok: true as const }
    }),

  heartbeat: publicProcedure
    .input(z.object({ featureId: z.string() }))
    .mutation(({ input }) => ({ running: heartbeatDesignServer(input.featureId) })),

  stop: publicProcedure
    .input(z.object({ featureId: z.string() }))
    .mutation(async ({ ctx, input }) => ({
      stopped: await stopDesignServer(ctx, input.featureId, 'stopped'),
    })),

  /** Select area in the design view: the crop and the human's words, into the live chat. */
  sendCrop: publicProcedure
    .input(z.object({ featureId: z.string(), png: z.string().min(1), text: z.string() }))
    .mutation(({ ctx, input }) =>
      sendDesignCrop(ctx, input.featureId, Buffer.from(input.png, 'base64'), input.text),
    ),
})
