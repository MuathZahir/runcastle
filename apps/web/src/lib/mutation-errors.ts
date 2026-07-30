/**
 * The global mutation-error safety net.
 *
 * Every `useMutation` call site in the app carries its own `onError → toast`
 * today, which is why mutation failures do reach the user. Nothing enforced it,
 * though: the next call site to forget the handler would fail in total silence —
 * the button just stops doing anything. So the QueryClient gets a
 * `MutationCache` default that toasts, and this module holds the two decisions
 * that default needs, out where they can be tested without a DOM.
 *
 * The default must not double-report: TanStack runs the cache-level `onError`
 * *in addition to* the mutation's own, so a call site that already handles the
 * error would otherwise raise two toasts saying the same thing. Hence
 * {@link unhandledMutationError} returning null for a handled mutation — the
 * net catches only what would fall through.
 */

/** The shape of the mutation the cache hands its `onError` (only what we read). */
export interface MutationLike {
  options: { onError?: unknown }
}

/** A human-readable line for whatever a mutation rejected with. */
export function mutationErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'string' && error !== '') return error
  return 'something went wrong'
}

/**
 * The message the global handler should toast, or null when the call site
 * already reported it itself.
 */
export function unhandledMutationError(error: unknown, mutation: MutationLike): string | null {
  if (typeof mutation.options.onError === 'function') return null
  return mutationErrorMessage(error)
}
