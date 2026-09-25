import { httpBatchLink, httpLink, splitLink, type TRPCLink } from '@trpc/client'
import { createTRPCReact } from '@trpc/react-query'
// Type-only import of the server's router type. Resolved via the tsconfig
// `paths` mapping to packages/server/src/trpc/router.ts (no build step, no edit
// to packages/server). `import type` is fully erased, so the runtime bundle
// never pulls server code.
import type { AppRouter } from '@runcastle/server'

/** The typed tRPC React hooks (`trpc.feature.get.useQuery`, etc.). */
export const trpc = createTRPCReact<AppRouter>()

/**
 * Queries whose server side shells out (git, the doctor's probes, the container
 * engine) or goes to the network, so they take hundreds of milliseconds to
 * seconds where every other procedure is a few-millisecond SQLite read.
 *
 * A batch answers in one response, so it answers when its SLOWEST member does:
 * batched with the doctor, a 6ms `feature.get` came back at ~400ms, and the
 * feature page sat on its loading line the whole time. These go out as requests
 * of their own instead, and the fast reads keep batching among themselves.
 */
export const UNBATCHED_PATHS: ReadonlySet<string> = new Set([
  'setup.doctor',
  'system.checkUpdate',
  'system.burnCache.status',
  'project.branches',
  'project.sessionBranch',
  'feature.mergeDelta',
  'feature.commitCount',
])

/** The client's links: one batch for the fast reads, a lone request per slow one. */
export function trpcLinks(url: string, fetchImpl?: typeof fetch): TRPCLink<AppRouter>[] {
  const opts = { url, ...(fetchImpl ? { fetch: fetchImpl } : {}) }
  return [
    splitLink({
      condition: (op) => UNBATCHED_PATHS.has(op.path),
      true: httpLink(opts),
      false: httpBatchLink(opts),
    }),
  ]
}
