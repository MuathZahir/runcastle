## Why this exists

runcastle has no way to tell whether it has users. npm download counts spike with bot noise (especially after boosted X posts), and the in-app update banner asks `registry.npmjs.org` directly (`packages/server/src/services/update-check.ts` — fetches `https://registry.npmjs.org/runcastle/latest`), so the one HTTP request every live install already makes on boot yields zero signal to the maintainer. A launch (Show HN etc.) is planned, and launching without measurement means being unable to evaluate whether it worked. This feature is the prerequisite for all marketing effort: it converts the existing update-check request into an honest usage count.

## What it is

- Swap the update-check URL from npm's registry to an endpoint the maintainer owns (recommended: a tiny Cloudflare Worker that returns the latest published version — it can itself consult npm — and logs the hit). The worker's source lives in this repo so it is versioned alongside the client that calls it.
- Add a random install ID, generated once and persisted under `~/.runcastle/`, sent with the check so hits dedup into real unique installs (DAU/WAU) instead of raw request counts. Payload stays minimal: install ID, runcastle version, platform. Nothing else.
- Opt-out: a `telemetry: false` (name TBD in grilling) config flag that reverts the check to npm's registry directly (update banner keeps working; no data reaches the maintainer).
- One plain sentence of disclosure in the README.
- All failure paths keep the existing behavior: offline/404/garbage degrades to "no update", never blocks boot (this contract already exists in `update-check.ts` and must be preserved).

## Decisions already settled (project session, 2026-08-11)

- Install ID + opt-out is the chosen posture, explicitly confirmed by the human over the stricter ID-free alternative (raw counts can't distinguish 100 users from one user booting 100 times, which defeats the purpose).
- The README's "no runcastle account and no hosted backend" promise stays true and must not be weakened: the endpoint is a notification/counting service, not a backend anything depends on. If it is down, runcastle works fully.
- It is the *same single request* the app already makes — no new phone-home paths, no additional event stream.

## What this must NOT swallow

- No analytics dashboard or admin UI in runcastle itself — where the maintainer reads the numbers (Cloudflare analytics, a log query) is out of scope.
- No event-level telemetry (feature usage, phase transitions, errors). One boot-time ping, that's the whole surface.
- No account system, no user identification beyond the random install ID.
- No launch/marketing content — the Show HN post, demo video, and landing-page work are separate concerns.

## Open questions for grilling

- Worker specifics: domain, storage (Workers Analytics Engine vs KV vs plain logs), and how it learns npm's latest (proxy per request vs cached).
- Where the install ID lives (`config.json` vs its own file) and whether the dev data dir (`~/.runcastle-dev/`) is excluded or flagged so the maintainer's own dev boots don't pollute the count.
- Ping cadence: the current check is memoized per server process and fetched on page load — keep that shape, or make it strictly once-per-boot.
- Opt-out flag name and exactly where it's documented (README + `runcastle doctor`?).
