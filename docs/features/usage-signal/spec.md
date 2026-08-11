# Usage signal

## Problem

Nobody knows whether runcastle is actually used. The boot update-check talks to
`registry.npmjs.org`, so the only install signal runcastle's owner has is npm's
download counter — a number polluted by mirrors, CI, and bots, and one that says
nothing about *retention*. Before any launch, the question that matters is "how
many real installs booted runcastle this week?", and today it is unanswerable.

## Approach

From the user's perspective nothing changes: the server boots, and if a newer
version of `runcastle` is published, the dismissible banner names the update
command — same banner, same command, same silence when offline.

Under the hood, the update-check repoints at a runcastle-owned endpoint and
carries an anonymous install ID, making every active install count itself as a
side effect of a check it already performs.

**The install ID.** A `crypto.randomUUID()` persisted as plain text in
`~/.runcastle/install-id`, read-or-created lazily on first check. Deliberately
*not* in `config.json` — it is not a setting, and must survive config resets.
Contains nothing identifying: random UUID, nothing derived from the machine.

**The client path.** The update-check service moves its trigger from "first UI
page-load query" to actual server boot: fired after listen, fire-and-forget,
never blocking startup, memoized in the existing per-process cache. The banner's
tRPC query reads the same cached result, so UI behavior is unchanged. The check
itself becomes a three-step ladder:

1. `DO_NOT_TRACK` set → skip the ping entirely; hit `registry.npmjs.org`
   directly (the pre-existing path, kept intact).
2. Otherwise `POST https://ping.runcastle.dev/ping` with JSON
   `{ installId, version, platform }` (platform = `process.platform`);
   response is `{ latest: "x.y.z" }`.
3. Any Worker failure (non-2xx, network error, garbage JSON) → one fallback
   attempt against `registry.npmjs.org`; if that also fails, degrade to the
   existing silent "no update". Never throws, never blocks boot.

Semver comparison, the `UNKNOWN_VERSION` guard (an unversioned build never
reports an available update), and the injected-`fetch` testability pattern all
carry over from the current service.

**The endpoint.** A Cloudflare Worker in a new `services/ping/` workspace —
outside `packages/*`, so it never enters the npm-published artifact's build
graph. One route: `POST /ping` validates the body (UUID-shaped `installId`,
string `version`/`platform`; reject oversized or malformed bodies), upserts
into a bound D1 database, fetches npm's `latest` dist-tag with a ~5-minute
edge cache, and responds `{ latest }`. If npm is unreachable the Worker still
records the ping and returns a non-2xx so the client walks its fallback ladder.
No auth — it is a public counter with nothing to steal.

**The D1 schema.** One table, `pings(install_id, day, version, platform)`,
primary key `(install_id, day)` so repeat boots per day collapse into one row.
Weekly actives is one exact query — `COUNT(DISTINCT install_id)` over the last
7 days — run ad hoc via `wrangler d1 execute`. No dashboard.

**Deploy.** Manual, human-only: a root `deploy:worker` package script wraps
`wrangler deploy` for the Worker; one-time setup (D1 create, schema apply,
custom-domain attach for `ping.runcastle.dev`) is documented in the Worker
workspace's README. Burner sandboxes have no Cloudflare credentials, so tickets
end at code + offline tests; the human deploys after merge.

**Docs.** A short README section states exactly what is sent (random ID,
package version, OS platform — nothing else) and that `DO_NOT_TRACK=1` opts
out without losing update notifications.

## Seams

- **`checkForUpdate` / `getUpdateInfo` (existing).** The update-check service
  functions with injected `fetch`. Observes the whole client ladder offline:
  ping-first ordering, request body shape, `DO_NOT_TRACK` short-circuit, npm
  fallback on Worker failure, final silent degrade, memoization.
- **`system.checkUpdate` tRPC procedure (existing).** Confirms the banner's
  wire shape (`UpdateInfo`) is unchanged and that the boot-time-fired result is
  what page loads see.
- **Install-ID accessor (new).** A read-or-create function over
  `~/.runcastle/install-id`; observes UUID format, persistence across calls,
  and regeneration when the file is missing.
- **Worker `fetch` handler (new).** Invoked directly in tests with a stubbed
  D1 binding and stubbed npm fetch; observes validation rejections, the upsert
  (per-day collapse), the `{ latest }` response, and the record-ping-but-non-2xx
  behavior when npm is down.

## Out of scope

- Any dashboard, chart, or UI for reading the numbers — `wrangler d1 execute`
  is the interface.
- CI/CD for the Worker — deploys are manual by decision.
- Any additional telemetry (feature usage, session counts, error reporting).
  This feature counts weekly-active installs, full stop.
- Dev-checkout filtering — a contributor machine counts as one install;
  `DO_NOT_TRACK=1` in the developer's shell is the remedy.
- In-app opt-out UI — the env var is the whole opt-out surface for now.

## Open questions

None — all decisions locked; nothing deferred to later laps.
