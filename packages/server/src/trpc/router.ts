import { router } from './context'
import { docsRouter } from './routers/docs'
import { eventsRouter } from './routers/events'
import { featureRouter } from './routers/feature'
import { projectRouter } from './routers/project'
import { runRouter } from './routers/run'
import { settingsRouter } from './routers/settings'
import { setupRouter } from './routers/setup'
import { systemRouter } from './routers/system'
import { ticketRouter } from './routers/ticket'

/**
 * The app router (SPEC §4). apps/web builds against exactly this shape via
 * `AppRouter` — keep the procedure names/inputs aligned with §4.
 */
export const appRouter = router({
  project: projectRouter,
  feature: featureRouter,
  run: runRouter,
  ticket: ticketRouter,
  events: eventsRouter,
  docs: docsRouter,
  settings: settingsRouter,
  setup: setupRouter,
  system: systemRouter,
})

export type AppRouter = typeof appRouter
