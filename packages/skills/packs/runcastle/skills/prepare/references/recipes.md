# Drive recipes — shapes to adapt, never to copy

Each of these is one shape that has worked. Take the idea and fit it to the project you actually found.

## Read this first: the snippets are sketches, not scripts

Every fragment below is written in POSIX shell because it is the most compact way to show the *idea*. **They are pseudocode.** They have not been run, they omit error handling, and two of them (`pick_port`, `port_in_use`) call helpers that do not exist anywhere — you have to write them.

Write the real thing in **whatever language this host actually runs**, which the system prompt reports as `process.platform`:

- **`win32`** — PowerShell (`.ps1`), or a cross-platform `node`/`bun` script. Do not hand a Windows developer a bash script and a `cksum` pipeline; `.runcastle/` in runcastle's own repo is TypeScript for exactly this reason.
- **`darwin` / `linux`** — bash is fine, but a `node`/`bun` script is still the better default in a JS project: the runtime is already installed and it is the only version of the script that survives the project gaining a Windows contributor.

The one thing that must NOT change when you translate: the contract (identity in via `RUNCASTLE_*`, computed values out via `.runcastle/drive.env`, unconditional idempotence, exit 0 means up).

## Postgres, one database per drive

Name the database from `RUNCASTLE_ID`, create it if it is not there, migrate, and hand the URL back:

```sh
DB="myapp_$RUNCASTLE_ID"
createdb "$DB" 2>/dev/null || true      # idempotent: already-there is success
DATABASE_URL="postgres://localhost/$DB" npm run migrate
echo "DATABASE_URL=postgres://localhost/$DB" >> .runcastle/drive.env
```

Stop drops exactly that database, and nothing else: `dropdb --if-exists "myapp_$RUNCASTLE_ID"`.

## docker compose

Isolate the whole stack per drive with a project name derived from the identity, map host ports from variables the script chose, and let compose do the waiting:

```sh
export COMPOSE_PROJECT_NAME="myapp_$RUNCASTLE_ID"
export PG_PORT=$(pick_port "$RUNCASTLE_SLUG-pg")   # you write pick_port — see below
docker compose up --wait -d
echo "COMPOSE_PROJECT_NAME=$COMPOSE_PROJECT_NAME" >> .runcastle/drive.env
echo "DATABASE_URL=postgres://localhost:$PG_PORT/app" >> .runcastle/drive.env
```

The compose file maps `"${PG_PORT}:5432"`. Stop is `docker compose down -v`, which needs the same `COMPOSE_PROJECT_NAME` — which is why it goes into `drive.env` too.

## Redis

Do not run a second server. Take a logical database index or a key prefix derived in-script from `RUNCASTLE_ID` — a small hash into 1..15 for the index — and leave db 0 to the human, whose own work is already in it. Write `REDIS_URL=redis://localhost:6379/7` or `REDIS_PREFIX=$RUNCASTLE_ID:` out, and have stop flush only that index or prefix.

## Hosted databases

Where the vendor has branches (Neon and its kin), setup creates one named for `RUNCASTLE_ID` with the vendor CLI and writes the connection string it prints to `drive.env`; stop deletes that branch.

Where the role has no CREATEDB grant, take a schema per drive instead — `CREATE SCHEMA IF NOT EXISTS "$RUNCASTLE_ID"` plus a URL with the search path pinned to it, and `DROP SCHEMA ... CASCADE` at stop.

Ask the human which they have: it is their bill and their production neighbour.

## Deterministic ports

Every lap of a feature should keep the same URL, and no drive should collide with the human's own running stack. Hash the SLUG — not the branch, so laps agree — into a high range, then probe upward for a free one.

The two helpers here are the part you must actually write:

- **`pick_port(seed)`** — hash `seed` into a high range and return the first free port at or above it.
- **`port_in_use(port)`** — true when something is already bound. There is no portable one-liner: bind a socket and catch the error (`net.createServer().listen()` in node), or shell out to `ss`/`lsof` on linux/macOS and `Get-NetTCPConnection` on Windows.

The sketch, with `cksum` standing in for "any stable hash you have to hand" (it is not on a stock Windows box):

```sh
base=$(( 20000 + $(printf %s "$RUNCASTLE_SLUG" | cksum | cut -d" " -f1) % 10000 ))
port=$base; while port_in_use "$port"; do port=$((port + 1)); done
echo "PORT=$port" >> .runcastle/drive.env
```

The dev pane inherits `PORT` from the overlay, so the URL it prints — the "Open app" link — is the port the script picked.
