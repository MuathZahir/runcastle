# Sessions never pick up a project's API key

## Problem

Agent sessions and workers are sometimes billed to an Anthropic API key from a project's `.env` file instead of the human's Claude subscription. Review workers then fail with "Credit balance is too low", and a lead's chat can quietly spend someone else's key.

The cause is Bun: any Bun process loads `.env`, `.env.local`, `.env.<NODE_ENV>` and `.env.<NODE_ENV>.local` from the folder it starts in, before our code runs. Claude Code then sees `ANTHROPIC_API_KEY` and bills it. Two ways in, both confirmed in the code:

1. **The server.** `runcastle` is a `#!/usr/bin/env bun` script. Started from a folder with a `.env`, the server's `process.env` holds the key, and nearly every child copies `process.env`: ACP sessions, host workers (the drive's review and fix workers, which run in the human's checkout), setup terminals, the dev pane, `claude -p` side calls.
2. **Every host ACP session, wherever runcastle started.** Both runtimes' launch specs run the adapter as `process.execPath` (Bun) with the feature worktree, or the human's checkout for host workers, as its working folder. That Bun loads the project's `.env`. The hook client is the same: Claude Code and Codex run `bun run "<hook-client.ts>"` in the session's folder, and a project `.env` can even override `RUNCASTLE_SERVER_URL` / `RUNCASTLE_SESSION_ID` there.

Checked and not affected: sandbox workers (the container gets only the variables named with `docker exec -e`, never `ANTHROPIC_*`); the native `claude` binary (tested: it does not read a folder's `.env`); MCP (HTTP only, no process).

## Approach

From the human's side nothing changes except that no session or worker ever bills a key that only lives in a `.env` file. A key exported in the shell still works (decision 1), and the doctor says so in one line (decision 6).

### Server boot: drop what Bun loaded from `.env` (decision 3)

The first thing the `runcastle` bin does, before config loads, is call one function that makes `process.env` look as if Bun had been started with `--no-env-file`:

- If `process.execArgv` already holds `--no-env-file`, do nothing.
- Find the candidate keys: parse the files Bun would have loaded from `process.cwd()`, in Bun's order (verified on 1.4.4: `.env`, `.env.<mode>`, `.env.local`, `.env.<mode>.local`, where mode is `NODE_ENV` or `development`; the `.local` files are skipped when `NODE_ENV=test`). Only keys named in those files are ever touched.
- **Linux:** read `/proc/self/environ`, which holds the environment the process was started with, before Bun's loading (verified on Bun 1.4.4). A candidate key absent from it came from a file and is deleted. Exact.
- **macOS and Windows:** no such source. Delete a candidate key when its current value equals the value the files give it. Bun lets the shell win on conflict, so a different value means the shell set it and it stays. The one miss: a shell export with exactly the same value as the `.env` is removed too. Accepted; it is the same key either way, and that user can start runcastle from another folder.
- Log one line naming the removed variables (names only, never values), so a user who relied on a start-folder `.env` sees why.

The shebang stays as is. `#!/usr/bin/env -S bun --no-env-file` works on Linux and macOS when the script is run directly, but not when started as `bun runcastle.js`, by the Linux service file, or through Bun's Windows shim, so the boot function is the one answer. The published bin (built from the same entry) gets it for free.

### One shared Bun launch helper (decision 3)

A small module in the server owns "start Bun as runcastle": it returns the command and leading arguments (`process.execPath`, `--no-env-file`) for a direct spawn, and the shell-quoted command string (`bun --no-env-file run "<script>"`) for a hook line written into a settings file. Every runcastle Bun launch uses it:

- Claude runtime ACP launch spec (the `claude-agent-acp` adapter).
- Codex runtime ACP launch spec (the `codex-acp` adapter).
- The Claude hook command written into the session's settings, and the Codex hook command written into its hooks file.
- The adapter bundling step the worker service runs before sandbox work (harmless today, covered for the guard's sake).
- The Agent SDK side calls (usage, rewind, model discovery): when the resolved `claude` executable is a JavaScript file the SDK runs it under Bun, so those calls pass `--no-env-file` in the SDK's executable arguments. With the native binary nothing changes.

Not covered, by design (decision 4): the dev pane, drive setup/teardown hooks, scenarios and the design server. They run the project's own commands, which load the project's own `.env` the way they always have. After the boot fix they also no longer receive `.env` values the server picked up from its start folder; a project app that only worked because of that was relying on an accident.

`~/.runcastle/.env` is untouched: the worker token reader and the doctor read it by hand, not through Bun. Because the boot fix removes a start-folder `CLAUDE_CODE_OAUTH_TOKEN`, runcastle's own file now wins as intended.

### Doctor line (decision 6)

A new doctor probe with `info` severity (which never fails a report or the setup gate): when `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN` is set in the server's environment, it reports "Sessions will bill the API key in `<name>`, not your Claude subscription." When neither is set, the probe reports ok ("Sessions use your Claude subscription"). It rides the existing doctor everywhere it is shown: `runcastle doctor`, the first-run wizard's checks and Settings. No new screen, no setting. Wording is the builder's within that sense.

### Guards (decisions 2 and 5)

- **Behaviour tests** (vitest, spawning the real Bun the way the existing real-Bun tests do): a temp folder with a `.env` holding a sentinel `ANTHROPIC_API_KEY`, and:
  - each runtime's ACP launch spec, run with a fixture script in place of the adapter entry, in that folder, prints no sentinel;
  - the hook command string, executed by a shell in that folder against a fixture script, sees no sentinel;
  - the server boot function, run in a real Bun child from that folder, removes the sentinel, keeps a variable exported in the child's environment, and keeps a shell variable whose value differs from the `.env` value. The non-Linux branch is tested by forcing it on Linux.
- **Source scan:** a server test walks the server's source and fails, naming file and line, on any spawn of `process.execPath` or a bare `bun` command (spawn, exec, PTY, SDK executable, hook string) outside the shared helper. A short allow list covers the dev-only scripts, each with its reason.

## Seams

- **ACP launch spec** (existing): what a host session is started with; observe the command and arguments, and run it for real.
- **Hook command in the session's settings** (existing): the string Claude Code and Codex will execute.
- **Server boot env function** (new): process environment in, cleaned environment out; observable from a real Bun child.
- **Doctor report** (existing): the probe list `runcastle doctor` and the setup query return.

## Out of scope

- How workers authenticate in their sandboxes. They already receive only the named token.
- Any setting, account or UI for choosing a billing mode.
- Removing an Anthropic key the human exported in their shell.
- A project's `bunfig.toml` (for example a `preload` script) also applies to the Bun adapter and hook processes runcastle starts in the worktree. Separate problem, offered as a backlog feature.

## Open questions

- If `claude` resolves to a JavaScript CLI instead of the native binary, the ACP adapter itself starts it under Bun, and that inner Bun would load the worktree's `.env`; runcastle does not control that spawn. The doctor already reports which `claude` it found. Left as is unless the build finds a cheap hook; the builder notes what they find.
