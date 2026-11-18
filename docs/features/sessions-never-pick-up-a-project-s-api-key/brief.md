## Purpose

Sessions and workers are sometimes billed to an Anthropic API key that lives in a project's `.env` file instead of the human's subscription. Review workers then fail with "Credit balance is too low", and a lead's own chat can quietly spend someone else's key. This feature makes that impossible, and makes sure it stays impossible.

## The cause (found and proved by the orchestrator, 2026-11-18)

Bun loads `.env`, `.env.local`, `.env.<NODE_ENV>` and so on from the folder any Bun process starts in, before any of our code runs. Tested: with a `.env` holding `ANTHROPIC_API_KEY`, `bun -e` printed the key; `bun --no-env-file -e` printed `undefined` (Bun 1.4.4). Claude Code then sees `ANTHROPIC_API_KEY` and bills it over the subscription. There are two known ways in:

1. **The server.** The `runcastle` command is a `#!/usr/bin/env bun` script. Started from a folder with a `.env`, the server's own `process.env` gets the key, and every child inherits it: ACP sessions (`threads/host.ts` `spawnAdapter` spreads `process.env`), host workers (the drive's review and fix workers), setup terminals and the dev pane (`trpc/routers/setup.ts`, `pty/dev-pane.ts` pass `process.env`). Starting runcastle from `~` hides this.
2. **Every ACP session, wherever runcastle started.** `launcher/runtimes/claude.ts` `acpLaunch` (and the Codex runtime, check it) run the adapter as `process.execPath` (Bun) with `cwd` = the feature worktree, or the human's checkout for host workers. That Bun loads the project's own `.env`. This is the "uses the API key of the project it's working on" case.

There may be more Bun spawns (hook client, MCP, workers, the `move` code, the sandbox's `bun` if any). Find them all.

## Decided with the human

- "Block only .env": runcastle must never load an Anthropic key from a `.env` file, in any process it starts. A key the human deliberately exports in their own shell keeps working, so a user who bills an API key on purpose is not broken.
- "MAKE SURE THIS DOESNT HAPPEN AGAIN": the fix must come with something that fails loudly if a future change brings the leak back, not just a one-time patch.

## Understood

- Bun's `--no-env-file` flag turns the loading off per process. The server bin can't take a flag through its shebang, so the server needs its own answer (for example, at boot, drop any variable whose value came from a `.env` in the start folder, or re-exec, or a bunfig setting; the lead decides).
- The orchestrator suggested the startup health check (the doctor) warn when a session would be billed to an API key. The human did not answer that one; treat it as a proposal to put to them, not a decision.
- Runcastle's own `~/.runcastle/.env` holds `CLAUDE_CODE_OAUTH_TOKEN` for workers and is read by hand (`workers/service.ts` `claudeToken`), not through Bun's autoload. It must keep working.
- The project's drive still needs the project's own env for the app it runs (the dev command, setup, scenarios). Blocking Bun's autoload in runcastle's processes must not stop the project's app from reading its own `.env` the way it always has; only the agent sessions and runcastle's own processes are in scope. The lead should check this boundary carefully.

## Must not swallow

- No change to how workers authenticate in their sandboxes, beyond making sure no `.env`-sourced key reaches them.
- No new settings, accounts or UI for choosing a billing mode.

## Open

- Exactly how the server drops `.env`-loaded variables at boot.
- What the regression guard is (a test that every Bun spawn carries `--no-env-file`, a test that starts a session process from a folder with a `.env` and checks the key is absent, or both).
- Whether the doctor warning goes in (ask the human).

## Ordering

Nothing has to merge first; nothing waits on it.

Planning mode: automatic
