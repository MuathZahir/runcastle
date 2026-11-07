import {
  designs,
  events,
  featureDependencies,
  features,
  projectFindings,
  projectNotes,
  projects,
  pushKeys,
  pushSubscriptions,
  readyDeclarations,
  reviewFindings,
  runs,
  sessions,
  testNotes,
  tickets,
  workers,
} from '@runcastle/core'

/**
 * The drizzle schema object passed to `drizzle({ client, schema })`. Tables are
 * declared in `@runcastle/core` (IO-free); the server only aggregates them so
 * both the bun-sqlite client (boot) and the sql.js client (tests) share one
 * schema and one migration.
 */
export const schema = {
  projects,
  pushKeys,
  pushSubscriptions,
  reviewFindings,
  features,
  featureDependencies,
  sessions,
  tickets,
  testNotes,
  runs,
  designs,
  events,
  projectFindings,
  projectNotes,
  readyDeclarations,
  workers,
}

export type Schema = typeof schema

export {
  designs,
  events,
  featureDependencies,
  features,
  projectFindings,
  projectNotes,
  projects,
  pushKeys,
  pushSubscriptions,
  readyDeclarations,
  reviewFindings,
  runs,
  sessions,
  testNotes,
  tickets,
  workers,
}
