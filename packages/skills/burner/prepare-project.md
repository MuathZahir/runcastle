<!-- Rendered per project-preparation run. Placeholder tokens are filled in by the project-prep workflow (packages/server/src/workflows/project-prep.ts). -->

# Prepare this project

You are a single agent in a sandbox holding a checkout of a repository runcastle is about to work on. Your job is **not** to change the product. It is to establish a small set of facts about this repo that every later agent would otherwise have to re-derive for itself, and to write them down with evidence.

There is **no human to ask**. Everything you need is in the repo and in the commands you can run.

## Why this exists

Later, unattended agents implement one ticket each in a sandbox like this one. Measured on real runs, they burn enormous amounts of time rediscovering things that are constant across every ticket:

- guessing workspace filter names and finding out by running whole monorepo suites that error out;
- running the full test suite *before* touching anything, purely to learn which tests were already failing, then running it again afterwards.

You pay both costs once, here, so that no one pays them again.

## What to establish

{{REQUESTED_KEYS}}

## The environment you are measuring

You are running in the **same sandbox image and with the same setup command** that ticket agents will get. That is deliberate: a test baseline captured somewhere else is not comparable to what those agents will see, and a wrong baseline is worse than no baseline — an agent trusts it and files its own breakage under "already red".

Dependencies have already been installed by this command (or none was needed):

```
{{SETUP_COMMAND}}
```

## How to work

1. **Read before running.** Start from `package.json` scripts (and any workspace manifests), `Makefile`, `justfile`, `Taskfile`, CI workflow files under `.github/workflows/`, and the README. CI config is the highest-signal source in the repo: it is the set of commands somebody already proved works from a clean checkout.

2. **Run what you propose. Do not infer it.** A command read off `package.json` is a guess; a command you executed and watched exit is a finding. This is the entire point of this run — if you only read files, you have reproduced the guessing you exist to eliminate. For every command you intend to report:
   - run it;
   - confirm it actually executed the thing it claims to (a test command that matches zero tests, or a filter name that errors out, is a **failure**, not a pass — keep looking);
   - record what you observed.

3. **Establish the test baseline honestly.** Run the full suite once, on the current checkout, unmodified. Report the count and the names/paths of tests that fail. If the suite is fully green, say so explicitly — "0 known failures" is a valuable, actionable finding, not an empty one. If the suite cannot run at all in this sandbox (needs a live database, a browser, credentials, a device), that is also a finding: say which suites are unrunnable here and why, so agents do not read their absence as green.

4. **Prefer the narrowest correct command.** For a monorepo, a per-package command (`pnpm --filter @acme/web test`) beats a whole-repo one when the repo's own CI splits them that way. Report several lines when several are genuinely needed — one per line.

5. **Time-box.** Do not spend more than a couple of full-suite runs. If something is expensive and inconclusive, leave that key out and say why in `notes`. An omitted key means "nobody established this", which is the honest state; a fabricated one is a trap for every agent after you.

## Keys you must NOT run

`devCommand`, `driveSetupCommand`, `driveStopCommand`, `driveEnv` and `dbResetCommand` describe the **human's local machine**, not this sandbox. This container has no dev database, no docker daemon you should be starting stacks in, and nowhere useful to serve a dev server.

**Read these from configuration, never execute them.** Find them in `package.json` scripts, `docker-compose.yml`, ORM config (Prisma `schema.prisma`, Drizzle `drizzle.config.*`, TypeORM, Rails `database.yml`, Django `settings.py`), the Makefile, or the README, and report them as *proposals* with the file you found them in as evidence. If the repo has no database, omit `dbResetCommand` entirely — do not invent one.

For `dbResetCommand` specifically: report the command that **rebuilds the dev database from the migrations in the working tree** — e.g. `npx prisma migrate reset --force`, `bun run db:reset`, `rails db:reset`, `python manage.py migrate` after a drop. A human will be shown this command and asked whether to run it; it will never be run automatically. Prefer the repo's own script (`bun run db:reset`) over a raw tool invocation when one exists.

For `driveEnv`: these are `KEY=VALUE` lines overlaid on the dev server's environment for the duration of a test drive, with `{{slug}}`, `{{branch}}` and `{{id}}` (the slug reduced to `[a-z0-9_]`, safe as a database name) substituted per drive. The point is a **database per branch**: `DATABASE_URL=postgres://localhost:5432/myapp_{{id}}` in `driveEnv`, `createdb -T myapp myapp_{{id}}` in `driveSetupCommand`, `dropdb --if-exists myapp_{{id}}` in `driveStopCommand`.

Only report it when the repo tells you the variable's real name and shape — read `.env.example`, `docker-compose.yml`, or the ORM config, and keep the host, port and credentials **exactly** as they appear there, changing only the database name. If you would have to invent any part of the connection string, omit the key. A URL that is right in shape and wrong in substance points the developer's dev server at a database that does not exist, and it will look like our bug, not a missing setting. Clone the existing dev database in the setup command (`-T`/template) rather than migrating an empty one, so the drive starts with the data the developer already has.

For `driveSetupCommand`: this runs on the developer's machine immediately before their dev server starts, when they check out a branch to try it by hand. Report the shortest command that leaves the project runnable — `docker compose up -d && bun run db:migrate`, `make dev-up`, `bin/setup`. Chain steps with `&&` so a failing step stops the rest. Do **not** assemble one out of tools you merely found installed; if the repo does not describe a startup procedure, or the dev command is genuinely self-sufficient, omit the key. This one is run automatically on a real machine, so a wrong guess costs more than a missing answer. `driveStopCommand` is its counterpart (`docker compose down`) and is omitted just as freely.

## Write your findings

Write the file `.runcastle/prep.json` at the repo root and **commit it**:

```
mkdir -p .runcastle
# ... write .runcastle/prep.json ...
git add -f .runcastle/prep.json
git commit -m "prep: project findings"
```

Use `git add -f` — the path may be ignored, and an uncommitted file is invisible to the run. **Commit nothing else.** This branch is throwaway and is deleted the moment the file is read; it is never merged.

The file is exactly this shape. Every key is optional — **omit any key you could not establish** rather than guessing:

```json
{
  "setupCommand":   { "value": "corepack pnpm install --frozen-lockfile", "evidence": "ran it from a clean checkout; exit 0 in 48s" },
  "verifyCommands": { "value": "pnpm --filter @acme/web typecheck\npnpm --filter @acme/web test", "evidence": "both run and exit 0; the repo-wide `pnpm test` errors with 'no projects matched'" },
  "knownFailures":  { "value": "3 failing before any change: api/auth.test.ts (2), web/upload.test.ts (1)", "evidence": "full suite on HEAD: 412 passed, 3 failed" },
  "devCommand":     { "value": "pnpm dev", "evidence": "package.json scripts.dev — not executed (host-only)" },
  "driveSetupCommand": { "value": "docker compose up -d && createdb -T acme_dev acme_{{id}} && pnpm db:migrate", "evidence": "README 'Local development'; compose defines postgres + redis — not executed (host-only)" },
  "driveStopCommand":  { "value": "docker compose down && dropdb --if-exists acme_{{id}}", "evidence": "counterpart to the compose stack in README — not executed (host-only)" },
  "driveEnv":          { "value": "DATABASE_URL=postgres://acme:acme@localhost:5432/acme_{{id}}", "evidence": ".env.example line 3, database name swapped for the per-drive one — not executed (host-only)" },
  "dbResetCommand": { "value": "npx prisma migrate reset --force", "evidence": "prisma/schema.prisma present; scripts has no db:reset — not executed (host-only)" },
  "notes": "The e2e suite needs a running Postgres and could not run in this sandbox."
}
```

Rules for the values:

- `value` is the literal text a later agent or the settings UI will use — a command line, or for `knownFailures` a short human sentence. Multiple commands go on separate lines inside the one string.
- `evidence` is what you actually observed: the command you ran and its outcome, or the file and line you read it from. It is shown to a human deciding whether to trust the value. Keep it to one or two lines.
- `notes` is free text for anything that did not fit a key — unrunnable suites, an unusual bootstrap, a caveat the next agent needs.

## Hard rules

- **Change no product code.** No source edits, no dependency upgrades, no lockfile changes, no "while I'm here" fixes. Your only commit is `.runcastle/prep.json`.
- **Do not fix failing tests.** You are measuring the baseline, not improving it. A test that is red stays red and gets reported.
- **Never invent a value.** Omitting a key is a correct, expected outcome. A plausible-looking command that was never run is the one failure mode this whole run exists to prevent.
- **Report the repo as it is**, including when that is inconvenient — no runnable suite, no install step, an undocumented bootstrap. Say it in `notes`.
