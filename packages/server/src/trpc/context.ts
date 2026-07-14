import { initTRPC } from '@trpc/server'
import type { AppCtx } from '../db/types'
import { toTRPCError } from '../errors'

/**
 * tRPC init (SPEC §4). Context is the DI `AppCtx` (`{ db, config }`) — the same
 * object services receive, so a resolver is a one-liner over a service call.
 *
 * `publicProcedure` carries an error-mapping middleware that runs every thrown
 * value through `toTRPCError`: `NotImplementedError` → INTERNAL_SERVER_ERROR
 * (`not yet implemented (B*)`), domain errors → their natural codes. Routers
 * and services therefore never construct `TRPCError` themselves.
 */

export type Context = AppCtx

const t = initTRPC.context<Context>().create()

const errorMapping = t.middleware(async ({ next }) => {
  const result = await next()
  if (!result.ok) {
    const mapped = toTRPCError(result.error.cause ?? result.error)
    if (mapped !== result.error) throw mapped
  }
  return result
})

export const router = t.router
export const publicProcedure = t.procedure.use(errorMapping)
export const createCallerFactory = t.createCallerFactory
