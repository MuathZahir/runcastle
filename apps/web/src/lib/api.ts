import type { inferRouterOutputs } from '@trpc/server'
import type { AppRouter } from '@runcastle/server'

/**
 * Router output types inferred straight from the server's `AppRouter` — no
 * dependency on internal server service types (the web tsconfig only maps
 * `@runcastle/server` to the router barrel). These are the exact wire shapes the
 * UI renders.
 */
export type RouterOutputs = inferRouterOutputs<AppRouter>

export type FeatureListItem = RouterOutputs['feature']['list'][number]
export type FeatureFull = RouterOutputs['feature']['get']
export type GateState = FeatureFull['gate']
export type DocSummary = FeatureFull['docs'][number]
export type Project = RouterOutputs['project']['get']
