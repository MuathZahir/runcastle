import {
  events,
  featureDependencies,
  features,
  projectFindings,
  projectNotes,
  projects,
  reviewFindings,
  runs,
  sessions,
  testNotes,
  tickets,
} from '@runcastle/core'

/**
 * The drizzle schema object passed to `drizzle({ client, schema })`. Tables are
 * declared in `@runcastle/core` (IO-free); the server only aggregates them so
 * both the bun-sqlite client (boot) and the sql.js client (tests) share one
 * schema and one migration.
 */
export const schema = {
  projects,
  reviewFindings,
  features,
  featureDependencies,
  sessions,
  tickets,
  testNotes,
  runs,
  events,
  projectFindings,
  projectNotes,
}

export type Schema = typeof schema

export {
  events,
  featureDependencies,
  features,
  projectFindings,
  projectNotes,
  projects,
  reviewFindings,
  runs,
  sessions,
  testNotes,
  tickets,
}
