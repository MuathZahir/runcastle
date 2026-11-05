import { trpc } from '../trpc'

/**
 * The platform of the machine the server runs on (Node's `process.platform`),
 * or `undefined` until it answers. Repo paths live on that machine, so the
 * path rules in `platform.ts` key on this, never on the browser's own machine.
 * It never changes while the server runs, so it is fetched once.
 */
export function useServerPlatform(): string | undefined {
  return trpc.system.version.useQuery(undefined, { staleTime: Infinity, refetchOnWindowFocus: false }).data?.platform
}
