import { router } from './context'
import { designRouter } from './routers/design'
import { docsRouter } from './routers/docs'
import { eventsRouter } from './routers/events'
import { featureRouter } from './routers/feature'
import { phoneLinkRouter } from './routers/phone-link'
import { pushRouter } from './routers/push'
import { projectRouter } from './routers/project'
import { projectNotesRouter } from './routers/project-notes'
import { reviewFindingsRouter } from './routers/review-findings'
import { settingsRouter } from './routers/settings'
import { setupRouter } from './routers/setup'
import { systemRouter } from './routers/system'
import { testNotesRouter } from './routers/test-notes'
import { threadRouter } from './routers/thread'
import { workerRouter } from './routers/worker'

/**
 * The app router (SPEC §4). apps/web builds against exactly this shape via
 * `AppRouter` — keep the procedure names/inputs aligned with §4.
 */
export const appRouter = router({
  project: projectRouter,
  projectNotes: projectNotesRouter,
  feature: featureRouter,
  design: designRouter,
  notes: testNotesRouter,
  findings: reviewFindingsRouter,
  events: eventsRouter,
  docs: docsRouter,
  settings: settingsRouter,
  setup: setupRouter,
  system: systemRouter,
  thread: threadRouter,
  phoneLink: phoneLinkRouter,
  push: pushRouter,
  worker: workerRouter,
})

export type AppRouter = typeof appRouter
