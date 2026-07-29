import {
  events,
  features,
  gateOverrides,
  projectFindings,
  projects,
  runs,
  sessions,
  tickets,
  waypoints,
} from '@runcastle/core'

/**
 * The drizzle schema object passed to `drizzle({ client, schema })`. Tables are
 * declared in `@runcastle/core` (IO-free); the server only aggregates them so
 * both the bun-sqlite client (boot) and the sql.js client (tests) share one
 * schema and one migration.
 */
export const schema = {
  projects,
  features,
  sessions,
  tickets,
  waypoints,
  runs,
  events,
  gateOverrides,
  projectFindings,
}

export type Schema = typeof schema

export {
  events,
  features,
  gateOverrides,
  projectFindings,
  projects,
  runs,
  sessions,
  tickets,
  waypoints,
}
