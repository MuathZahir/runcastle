import type { inferRouterOutputs } from '@trpc/server'
import type { TRPCClientErrorLike } from '@trpc/client'
import type { UseTRPCQueryResult } from '@trpc/react-query/shared'
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
export type Project = RouterOutputs['project']['list'][number]
export type BranchList = RouterOutputs['project']['branches']
export type SettingsView = RouterOutputs['settings']['get']
export type SettingField = SettingsView['fields'][number]
export type PrepView = RouterOutputs['project']['prep']
export type ProjectFinding = PrepView['findings'][number]
/** The live project conversation (decision 20), or null when none is open. */
export type ProjectSession = RouterOutputs['project']['projectSession']

/**
 * A `useQuery` result carrying a named data shape — for components that accept a
 * query as a prop. Annotate those props with this, never with
 * `ReturnType<typeof trpc.x.y.useQuery>`: that reads the *uninstantiated* hook
 * overload, whose `TData` is unconstrained in that position, so it erases to
 * `unknown` and every property access off `.data` collapses.
 */
export type QueryResult<TData> = UseTRPCQueryResult<TData, TRPCClientErrorLike<AppRouter>>
