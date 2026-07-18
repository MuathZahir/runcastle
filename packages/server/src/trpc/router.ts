import { router } from './context'
import { docsRouter } from './routers/docs'
import { eventsRouter } from './routers/events'
import { featureRouter } from './routers/feature'
import { projectRouter } from './routers/project'
import { runRouter } from './routers/run'
import { settingsRouter } from './routers/settings'

/**
 * The app router (SPEC §4). apps/web builds against exactly this shape via
 * `AppRouter` — keep the procedure names/inputs aligned with §4.
 */
export const appRouter = router({
  project: projectRouter,
  feature: featureRouter,
  run: runRouter,
  events: eventsRouter,
  docs: docsRouter,
  settings: settingsRouter,
})

export type AppRouter = typeof appRouter
