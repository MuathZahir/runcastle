import { router } from './context'
import { designRouter } from './routers/design'
import { docsRouter } from './routers/docs'
import { eventsRouter } from './routers/events'
import { featureRouter } from './routers/feature'
import { projectRouter } from './routers/project'
import { projectNotesRouter } from './routers/project-notes'
import { reviewFindingsRouter } from './routers/review-findings'
import { runRouter } from './routers/run'
import { settingsRouter } from './routers/settings'
import { setupRouter } from './routers/setup'
import { systemRouter } from './routers/system'
import { testNotesRouter } from './routers/test-notes'
import { threadRouter } from './routers/thread'
import { ticketRouter } from './routers/ticket'

/**
 * The app router (SPEC §4). apps/web builds against exactly this shape via
 * `AppRouter` — keep the procedure names/inputs aligned with §4.
 */
export const appRouter = router({
  project: projectRouter,
  projectNotes: projectNotesRouter,
  feature: featureRouter,
  design: designRouter,
  run: runRouter,
  ticket: ticketRouter,
  notes: testNotesRouter,
  findings: reviewFindingsRouter,
  events: eventsRouter,
  docs: docsRouter,
  settings: settingsRouter,
  setup: setupRouter,
  system: systemRouter,
  thread: threadRouter,
})

export type AppRouter = typeof appRouter
