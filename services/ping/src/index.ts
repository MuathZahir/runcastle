/**
 * runcastle's usage-signal endpoint — a Cloudflare Worker behind
 * `ping.runcastle.dev` serving exactly one route: `POST /ping`.
 *
 * Every runcastle server posts `{ installId, version, platform }` once at boot.
 * The Worker upserts one row per install per day into D1, so repeat boots
 * collapse and weekly actives is an exact `COUNT(DISTINCT install_id)` over the
 * last 7 days (see README.md), then answers with npm's `latest` dist-tag — the
 * update check that makes the ping worth sending in the first place.
 *
 * The ordering of those two halves is deliberate. The ping is written first and
 * its failure is swallowed: the version answer is the service, the ping is the
 * freeloader, so a D1 outage must not cost a caller its update banner. A failed
 * npm lookup, by contrast, answers non-2xx rather than inventing a version —
 * the client treats any non-2xx as "walk the fallback ladder" (npm direct, then
 * a silent "no update").
 *
 * No auth: it is a public counter with nothing to steal.
 */

export interface Env {
  /** D1 binding declared in wrangler.jsonc. */
  DB: D1Database
}

/** npm's dist-tag manifest for the published package. */
const NPM_LATEST_URL = 'https://registry.npmjs.org/runcastle/latest'

/** Edge-cache npm's answer ~5 minutes: one origin hit per 5 min, not per boot. */
const NPM_CACHE_TTL_SECONDS = 300

/** A ping is three short strings; anything larger is not one. */
const MAX_BODY_BYTES = 1024
const MAX_VERSION_LENGTH = 64
const MAX_PLATFORM_LENGTH = 32

/** Shape-only check — the id is an opaque `crypto.randomUUID()` from the client. */
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface Ping {
  installId: string
  version: string
  platform: string
}

function isBoundedString(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max
}

/** Parse + validate a request body, or null if it isn't a ping (caller answers 400). */
function parsePing(raw: string): Ping | null {
  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof body !== 'object' || body === null) return null
  const { installId, version, platform } = body as Record<string, unknown>
  if (typeof installId !== 'string' || !UUID_SHAPE.test(installId)) return null
  if (!isBoundedString(version, MAX_VERSION_LENGTH)) return null
  if (!isBoundedString(platform, MAX_PLATFORM_LENGTH)) return null
  return { installId, version, platform }
}

/**
 * Upsert on `(install_id, day)` so a machine that boots runcastle ten times in a
 * day is still one active install, carrying that boot's version + platform.
 */
async function recordPing(db: D1Database, ping: Ping, day: string): Promise<void> {
  await db
    .prepare(
      'INSERT INTO pings (install_id, day, version, platform) VALUES (?1, ?2, ?3, ?4) ' +
        'ON CONFLICT (install_id, day) DO UPDATE SET version = ?3, platform = ?4',
    )
    .bind(ping.installId, day, ping.version, ping.platform)
    .run()
}

/** npm's `latest` version, or null if the registry answered badly. */
async function fetchLatestVersion(): Promise<string | null> {
  const res = await fetch(NPM_LATEST_URL, {
    cf: { cacheTtl: NPM_CACHE_TTL_SECONDS, cacheEverything: true },
  })
  if (!res.ok) return null
  const body = (await res.json()) as { version?: unknown }
  return typeof body.version === 'string' ? body.version : null
}

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url)
    if (pathname !== '/ping') return new Response('not found', { status: 404 })
    if (request.method !== 'POST') return new Response('method not allowed', { status: 405 })

    // Size guard before parsing: refuse an oversized body on its declared length
    // where there is one, and on what actually arrived where there isn't.
    if (Number(request.headers.get('content-length')) > MAX_BODY_BYTES) {
      return new Response('bad request', { status: 400 })
    }
    const raw = await request.text()
    if (raw.length > MAX_BODY_BYTES) return new Response('bad request', { status: 400 })

    const ping = parsePing(raw)
    if (ping === null) return new Response('bad request', { status: 400 })

    const day = new Date().toISOString().slice(0, 10)
    try {
      await recordPing(env.DB, ping, day)
    } catch {
      // The freeloader half: a D1 outage costs a day of signal, not the caller's
      // update answer.
    }

    let latest: string | null = null
    try {
      latest = await fetchLatestVersion()
    } catch {
      latest = null
    }
    if (latest === null) return new Response('upstream version lookup failed', { status: 502 })

    return Response.json({ latest })
  },
}

export default worker
