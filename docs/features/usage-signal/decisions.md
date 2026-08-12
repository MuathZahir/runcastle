# usage-signal — decisions

## 1. The receiving endpoint is in scope
**Decision:** This feature ships both sides: the client repoint in the server's update-check path AND the runcastle-owned receiving endpoint. The endpoint stays deliberately simple.
**Why:** The client needs a real URL and an agreed contract; splitting the endpoint into a separate effort risks the two drifting apart before launch. Simplicity is the guard against scope creep — the endpoint is a ping counter + latest-version answerer, nothing more.

## 2. Endpoint runs as a Cloudflare Worker, code at `services/ping/`
**Decision:** The receiving endpoint is a Cloudflare Worker deployed with wrangler. Its code lives in this repo in a new `services/ping/` workspace, outside `packages/*` so it never enters the npm-published artifact's build graph.
**Why:** Free at this traffic level, no server to babysit, and pairs with Cloudflare's built-in analytics/storage options for counting actives. A hosted Bun service (e.g. Railway) would be a monthly bill and a deployment to keep alive for one route.

## 3. Pings land in D1; weekly actives is one exact SQL query
**Decision:** The Worker writes to a Cloudflare D1 database: one table, `pings(install_id, day, version, platform)` with primary key `(install_id, day)` so repeat boots per day collapse. Weekly actives = `COUNT(DISTINCT install_id)` over the last 7 days, read via `wrangler d1 execute` — no dashboard.
**Why:** The whole point is a real number to trust before launch; Workers Analytics Engine is less code but sampled/approximate with 90-day retention. D1 gives exact counts, is free at this scale, and stays queryable forever.

## 4. One combined request: ping in, latest version out
**Decision:** The client makes a single `POST /ping` with JSON `{ installId, version, platform }` (platform = `process.platform`). The Worker upserts the ping row and responds `{ latest: "x.y.z" }`, fetching npm's `latest` dist-tag itself with a short edge-cache (~5 min). Client-side degrade-to-"no update" semantics carry over unchanged.
**Why:** Exactly one outbound request per boot, same as today; the update answer is the carrot that justifies the ping. Separate ping and version endpoints buy nothing at this scale.

## 5. Install ID: `crypto.randomUUID()` in `~/.runcastle/install-id`
**Decision:** The anonymous install ID is a `crypto.randomUUID()`, generated lazily on first update-check and persisted as plain text in its own file `~/.runcastle/install-id` (read-or-create).
**Why:** It is not a setting — putting it in `config.json` would drag in the zod schema, write-through machinery, and the settings UI. A one-line file is simpler and survives config resets.

## 6. Honor `DO_NOT_TRACK`; opted-out installs still get update checks via npm
**Decision:** When the `DO_NOT_TRACK` env var is set (community convention), skip the ping and fall back to hitting `registry.npmjs.org` directly — today's code path, which stays in the codebase. A README line documents what is sent (random ID, version, OS platform — nothing else) and the opt-out.
**Why:** Cost is one env check choosing between two URLs; the npm path already exists. The audience is developers — the crowd that greps new tools for phone-home code, especially at launch. Opt-out must not punish: users who opt out still get update banners.

## 7. Ping fires at server boot, fire-and-forget
**Decision:** The check moves from lazy (first UI page-load query) to actual server boot — fired from `src/index.ts` after listen, never blocking startup, memoized in the existing per-process cache. The banner query reads/awaits the same cached result; UI behavior unchanged.
**Why:** Today a server booted without a UI page load never checks at all, undercounting actives. "Booted a runcastle server this week" is the honest definition of an active install — the server only runs when the tool is being used.

## 8. Worker failure falls back to npm, then to silent "no update"
**Decision:** The client tries the Worker first; on any failure (non-2xx, timeout, garbage JSON) it retries once against `registry.npmjs.org` directly (the same existing function the `DO_NOT_TRACK` path uses); only if that also fails does it degrade to the current silent "no update". Never throws, never blocks boot.
**Why:** The update banner is the user-facing feature; the ping is the freeloader. An endpoint outage should cost a week of signal, not users' update notifications.

## 9. Endpoint URL: `https://ping.runcastle.dev/ping`
**Decision:** The Worker gets the custom domain `ping.runcastle.dev` (the account already hosts `runcastle.dev`); the client hardcodes `https://ping.runcastle.dev/ping` as a constant, testable via the existing injected-fetch pattern. No env override — `DO_NOT_TRACK` is the escape hatch.
**Why:** A subdomain keeps the Worker fully separate from the landing page's Pages deployment; a route on the apex would entangle two deployments that have no reason to know about each other.

## 10. No dev-checkout filtering
**Decision:** Contributor checkouts ping like any install — no workspace-detection heuristic. The developer sets `DO_NOT_TRACK=1` in their own shell if they care.
**Why:** Distinct-count means a dev machine inflates weekly actives by exactly 1; a "skip when workspace checkout" branch could misfire on real installs and isn't worth it.

## 11. Manual deploy behind a `deploy:worker` script
**Decision:** Deploying the Worker stays a human step, wrapped in a root package script — `bun run deploy:worker` (Bun per repo convention) — that runs `wrangler deploy` for `services/ping/`. One-time setup (D1 create, schema apply, custom-domain attach) is documented in `services/ping/README.md`. No CI. Ticket acceptance criteria cover code + offline tests only; the human deploys after merge.
**Why:** Burner sandboxes have no Cloudflare credentials, and a one-route Worker redeployed a few times a year doesn't earn a pipeline. The script makes the manual step one memorable command.

## 12. One lap, spec whole
**Decision:** Spec the entire feature in one lap; nothing deferred to later laps.
**Why:** Small surface (rewrite one service, one new install-id file, one ~80-line Worker, a deploy script) and every decision locked without contention — no uncertainty that would earn a walking-skeleton slice or a mid-feature test drive.
