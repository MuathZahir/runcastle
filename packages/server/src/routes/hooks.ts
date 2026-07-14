import { Hono } from 'hono'

/**
 * Hook receiver — WAVE B1 (SPEC §5.6): `POST /api/hooks/:event`
 * (session-start / user-prompt / session-end). Typed stub: a Hono sub-app
 * returning 501 for every route, so the mount point exists and the app boots
 * end-to-end before B1 lands. B1 replaces the handler bodies.
 */
const hooks = new Hono()

hooks.all('/:event', (c) =>
  c.json({ error: 'not yet implemented (B1)', wave: 'B1', event: c.req.param('event') }, 501),
)

export default hooks
