import { TRPCError } from '@trpc/server'

/**
 * Domain error types + the single tRPC mapping helper. Services throw these
 * (never `TRPCError` directly — services stay transport-agnostic); the tRPC
 * error-mapping middleware (`trpc/context.ts`) runs every result through
 * `toTRPCError`.
 */

/**
 * Thrown by wave-B typed stubs (git, launcher, mcp, ticket-burner) until the
 * owning wave replaces the body. The constructor takes the wave tag so the
 * message reads `not yet implemented (B2)` verbatim.
 */
export class NotImplementedError extends Error {
  readonly wave: string
  constructor(wave: string) {
    super(`not yet implemented (${wave})`)
    this.name = 'NotImplementedError'
    this.wave = wave
  }
}

/** A gate check (or phase precondition) is not satisfied. */
export class GateError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GateError'
  }
}

/** Bad caller input that zod could not catch (e.g. invalid ticket blockedBy). */
export class InvalidInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidInputError'
  }
}

/** A referenced entity does not exist. */
export class NotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NotFoundError'
  }
}

export function isNotImplemented(e: unknown): e is NotImplementedError {
  return e instanceof NotImplementedError
}

/**
 * Map any thrown value to a `TRPCError`. `NotImplementedError` maps to
 * `INTERNAL_SERVER_ERROR` (message preserved: `not yet implemented (B*)`) as
 * required by SPEC §4; domain errors map to their natural HTTP-ish codes.
 * Already-`TRPCError` values pass through unchanged.
 */
export function toTRPCError(e: unknown): TRPCError {
  if (e instanceof TRPCError) return e
  if (e instanceof NotImplementedError)
    return new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: e.message, cause: e })
  if (e instanceof NotFoundError)
    return new TRPCError({ code: 'NOT_FOUND', message: e.message, cause: e })
  if (e instanceof GateError)
    return new TRPCError({ code: 'PRECONDITION_FAILED', message: e.message, cause: e })
  if (e instanceof InvalidInputError)
    return new TRPCError({ code: 'BAD_REQUEST', message: e.message, cause: e })
  if (e instanceof Error)
    return new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: e.message, cause: e })
  return new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Unknown error' })
}
