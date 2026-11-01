import { TRPCError } from '@trpc/server'
import * as z from 'zod'
import { emitProject } from '../../services/events'
import {
  addPushSubscription,
  pushPublicKey,
  removePushSubscription,
  sendPushTo,
} from '../../services/push'
import { publicProcedure, router } from '../context'

/**
 * The phone's Notifications row (`agents-can-notify-your-phone`, decision 5):
 * the key a browser subscribes with, and switching a phone on or off. Turning
 * on sends a test notification, so the human knows it works.
 */

const subscription = z.object({
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
})

export const pushRouter = router({
  publicKey: publicProcedure.query(({ ctx }) => pushPublicKey(ctx)),

  subscribe: publicProcedure
    .input(z.object({ projectId: z.string(), subscription }))
    .mutation(async ({ ctx, input }) => {
      addPushSubscription(ctx, input.subscription)
      const delivered = await sendPushTo(ctx, input.subscription, {
        title: 'Runcastle',
        body: 'Notifications are on. Agents can reach you here when they need you.',
        url: `/p/${encodeURIComponent(input.projectId)}`,
      })
      if (!delivered) {
        // A phone the test cannot reach would only look switched on.
        removePushSubscription(ctx, input.subscription.endpoint)
        throw new TRPCError({
          code: 'BAD_GATEWAY',
          message: 'The test notification could not be sent. Check this computer’s internet and try again.',
        })
      }
      emitProject(ctx, input.projectId, {
        type: 'phone_notifications.changed',
        message: 'turned on notifications for a phone',
        data: { on: true },
      })
    }),

  unsubscribe: publicProcedure
    .input(z.object({ projectId: z.string(), endpoint: z.string() }))
    .mutation(({ ctx, input }) => {
      removePushSubscription(ctx, input.endpoint)
      emitProject(ctx, input.projectId, {
        type: 'phone_notifications.changed',
        message: 'turned off notifications for a phone',
        data: { on: false },
      })
    }),
})
