# Preparation supports multi-service projects

## Problem

A test drive should be one click: the human presses Start, opens the link, and tests the feature. Today that is only true for the narrowest project shape — one app, one local postgres, no services, no branch that changed the world. A branch that added an npm package dies on stale deps because nothing in the loop knows what the feature changed. A docker-compose project has no per-branch isolation for containers or volumes. Fixed host ports collide with the developer's own running stack. "Open app" appears before the app actually serves. And when setup fails, the human gets a raw hook-failure blob and is stranded mid-review — the worst moment to debug an environment. The prepare/drive machinery is brittle in exactly the dimension real projects vary: services, packages, monorepos, hosted databases.

## Approach

The human-visible promise: **a drive works on the first click for any project shape** — and when it doesn't, a fix agent is one click away, already holding the failure.

The architecture behind it keeps the injection-vs-cloning split but sharpens it to its minimal form. All project-specific intelligence moves into **repo-committed scripts** under a `.runcastle/` directory, authored by the prep agent and versioned with the code they prepare. The server's drive machinery shrinks to a contract with exactly two obligations — the two things a script cannot do for itself:

1. **Identity in:** every drive hook (setup, stop) and the dev pane receive plain env vars `RUNCASTLE_SLUG`, `RUNCASTLE_BRANCH`, `RUNCASTLE_ID` (the identifier-safe slug). Identity stays server-passed, never git-derived in scripts, because the prep dry-run runs under a synthetic identity on whatever branch is checked out.
2. **Environment across the process boundary:** the setup script computes everything else — ports, database names, redis indexes, compose project names, URLs — and writes `.runcastle/drive.env` (gitignored, plain KEY=VALUE). The server parses that file after setup exits and overlays it verbatim onto the dev pane's and stop hook's environment, and shows the overlay on the timeline. The file is the seam: script computes, server injects.

The `driveEnv` setting, the `{{...}}` templating, and every planned drive variable are **removed cleanly** — schema, prepared-key lists, settings UI, dry-run observables. No legacy path: existing projects lose the value, their drive-loop verification stamps clear, and the existing unverified-keys nudge routes them to a fresh prep session, which is itself the migration. `driveSetupCommand`/`driveStopCommand` remain as settings but shrink to invocation lines for the committed scripts. The dry-run observable for the retired key becomes "setup wrote a parseable `drive.env`".

**Scripts are idempotent by convention, not delta-detecting.** Install, migrate, seed, compose-up run unconditionally — a no-op when nothing changed, exactly right when the branch changed the world. That is how a branch that added packages or migrations drives correctly with no server-side diff inspection. Service readiness belongs to the script too: the prep prompt teaches waits (`docker compose up --wait`, `pg_isready` loops) so exit 0 *means* services are up. No new health keys.

**App readiness belongs to the server**, the one wait a script cannot perform: after sniffing the dev pane's localhost URL, the server polls it until it responds (any HTTP status counts as serving). The UI shows "starting…" until then and only makes "Open app" clickable when the link will load; a poll timeout surfaces as a warning, never a failure.

**The prep prompt's drive section is rewritten** around a shape-discovery protocol with minimal assumptions: discover the package manager, OS/shell, monorepo layout, docker presence, services, hosted-vs-local DB, and how env loading works — then author scripts fitted to what was found. Runcastle mandates only the contract (scripts in `.runcastle/`, setup writes `drive.env`, `RUNCASTLE_*` is identity, idempotent steps, exit 0 = ready). Everything else is a recipe pack the agent adapts: per-branch postgres; compose with `COMPOSE_PROJECT_NAME` derived from `RUNCASTLE_ID`, env-var host-port mappings, `up --wait`; redis via logical index or key prefix derived in-script with db 0 left for the human; hosted DBs via branch-per-feature (Neon-style) or schema-per-branch where CREATEDB is refused; deterministic slug-derived ports with bind-probe fallback so every lap of a feature keeps the same URL. The prompt also directs a prep-time env-loading audit: find `dotenv override: true`-class patterns that would defeat injection and fix them or record a finding — the agent is the detector.

**The burner keeps the scripts true.** The burner prompt gains a standing instruction: a ticket that introduces infrastructure the dev environment needs (new service, required env var, seed requirement, process to run) must update the `.runcastle/` scripts in the same branch. The sandbox stays hermetic — it can never run the scripts — so it performs hermetic sanity checks only: script syntax, referenced files exist, compose file parses. There is no pre-drive agent pass; the drive loop stays pure machinery.

**When a drive's setup still fails, recovery is first-class.** The failure output is surfaced prominently, and a one-click "Fix drive" action spawns a **drive-fix session** — a new session kind on the host, launched with the failure log, the drive's `drive.env` if one was written, the branch delta, and the feature's docs. Its mandate is narrow: repair the environment and retry this drive, under the same ask-before-act rules as prep. It reuses the prep session's launcher plumbing with a fitted prompt and fitted MCP tool gating (including a way to retry the drive). One-click, never auto-spawned.

## Seams

- **Drive lifecycle (existing)** — the start/stop machinery. Observes: `RUNCASTLE_*` identity vars reaching setup/dev/stop processes; `drive.env` parsed and overlaid on the dev pane and stop hook; the overlay appearing on the timeline; a missing or malformed `drive.env` handled (absent = no overlay, malformed lines dropped leniently); hook failures carrying output for the fix flow. The highest seam here — most of the contract is tested at it.
- **Drive readiness (existing, extended)** — the polled `DriveInfo`: URL sniffed → "starting…" → responding → "Open app" clickable; poll timeout as warning. Observes the app-readiness state machine.
- **Dry-run drive (existing, amended)** — the prep session's verification loop. Observes the amended observable set: setup exit 0 *and* a parseable `drive.env` written; the retired `driveEnv` stamp gone.
- **Prepared-key surface (existing, shrunk)** — schema, prepared-key and drive-loop-key lists, settings view. Observes: `driveEnv` absent everywhere; remaining keys intact; stamps clearing on the removal migration.
- **Prompt renderers (existing, pure)** — prep prompt (shape-discovery protocol, contract, recipe pack, dotenv audit) and burner prompt (script-maintenance instruction, hermetic checks). Pure-text seams, tested by rendering.
- **Drive-fix session (new)** — the session kind boundary: one-click spawn carrying failure context, fitted MCP gating, drive retry, ask-before-act. Observes: launch context contents, refusals outside a failed-drive state, and the retry path. The only genuinely new seam.

## Out of scope

- Running apps or services inside the burner sandbox — tickets stay hermetic (locked by the brief).
- Any change to the automatic-review feature, which rides the drive machinery as-is.
- Server-side stack drivers of any kind — no compose integration code, no per-vendor DB drivers, no server port allocator, no `{{...}}` variable system (retired, not extended).
- Delta detection: the server never inspects a branch diff to decide setup steps.
- Auto-spawning agents on the host without a click.
- Concurrent drives — the singleton drive slot stays.

## Open questions

- Exact MCP tool shape for the drive-fix session's retry ("retry drive" as a fresh tool vs. widening the dry-run tool's gating) — implementation call at the drive-fix ticket.
- Where the burner's hermetic script checks run (a prompt instruction to self-check vs. a mechanical check step in the burner harness) — implementation call; the prompt instruction is the floor.
- Whether the timeline shows the full `drive.env` overlay or just key names (values may hold credentials) — lean key-names-plus-count; decide at implementation.

## Later laps

- **Background pre-flight:** boot the stack on the feature branch (worktree or branch-switch) before the human ever clicks, so even first-click failures are discovered by the machine. Parked until real failure data from this lap shows what it must catch.
- Anything the first real multi-service preparations reveal the recipe pack is missing.
