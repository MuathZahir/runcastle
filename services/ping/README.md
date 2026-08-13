# `@runcastle/ping`

The usage-signal endpoint: a Cloudflare Worker at `https://ping.runcastle.dev/ping`.

Every runcastle server posts `{ installId, version, platform }` once at boot. The
Worker writes one row per install per day into a D1 table and answers
`{ latest: "x.y.z" }` — npm's `latest` dist-tag, which is the update check the
client wanted anyway. Nothing else is stored: the install ID is a random UUID
from `~/.runcastle/install-id`, and `DO_NOT_TRACK=1` skips the ping entirely
(the client then asks npm directly and still gets its update banner).

This workspace lives outside `packages/*` on purpose, so it never enters the
published npm artifact's build graph.

## Deploying

Deploys are manual and human-only — there is no CI for this Worker, and burner
sandboxes have no Cloudflare credentials.

### One-time setup

Run these in order, from `services/ping/`:

1. Create the database:

   ```
   bunx wrangler d1 create runcastle-ping
   ```

   Paste the `database_id` it prints into `wrangler.jsonc`, replacing the
   `REPLACE_WITH_ID_FROM_WRANGLER_D1_CREATE` placeholder.

2. Apply the schema to the remote database:

   ```
   bunx wrangler d1 execute runcastle-ping --remote --file=schema.sql
   ```

3. Attach the `ping.runcastle.dev` custom domain. The `routes` entry in
   `wrangler.jsonc` does this on the first deploy; otherwise add it under
   Workers → `runcastle-ping` → Settings → Domains & Routes in the dashboard.

### Every deploy

From the repo root:

```
bun run deploy:worker
```

## Reading weekly actives

There is no dashboard. Weekly actives is one exact query — distinct install IDs
seen in the last 7 days:

```
bunx wrangler d1 execute runcastle-ping --remote --command "SELECT COUNT(DISTINCT install_id) AS wau FROM pings WHERE day >= date('now', '-7 day')"
```

On Windows, `bunx` mangles quoted arguments containing spaces (wrangler sees the
SQL as many separate args), so run wrangler's entry point directly with `bun`
from `services/ping/`:

```
bun ../../node_modules/wrangler/bin/wrangler.js d1 execute runcastle-ping --remote --command "SELECT COUNT(DISTINCT install_id) AS wau FROM pings WHERE day >= date('now', '-7 day')"
```

## Tests

The Worker's `fetch` handler is tested offline, with a stubbed D1 binding and a
stubbed npm fetch — no account or wrangler login needed:

```
bunx vitest run services/ping
```
