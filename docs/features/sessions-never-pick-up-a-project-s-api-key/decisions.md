# Decisions: Sessions never pick up a project's API key

Planned with nobody present.
Check first: 3, 6, 5

## 1. Block only .env
**Decision:** Runcastle never loads an Anthropic key from a `.env` file, in any process it starts. A key the human deliberately exports in their own shell keeps working, so a user who bills an API key on purpose is not broken.
**Why:** The leak comes from Bun reading `.env` files on its own; a shell export is a choice the human made.

## 2. Make sure it doesn't happen again
**Decision:** The fix comes with checks that fail loudly if a future change brings the leak back, not just a one-time patch.
**Why:** The human's words: "MAKE SURE THIS DOESNT HAPPEN AGAIN".

## 3. Runcastle ignores every .env in the folder it starts from, not only Anthropic keys
**Decision:** The server behaves as if Bun's `--no-env-file` were on: any variable Bun loaded from a `.env` file in the start folder is removed at boot, whatever its name. Variables exported in the shell stay. Every Bun process runcastle starts gets `--no-env-file` too.
**Why:** One rule, matching Bun's own switch, with no list of "dangerous" names to keep up to date. It also stops a stray `CLAUDE_CODE_OAUTH_TOKEN` or `RUNCASTLE_*` in a project's `.env` from overriding runcastle's own settings. Someone who relied on starting runcastle from a folder with a `.env` to configure it loses that.
**Assumed.** Alternative: remove only Anthropic and Claude variables (`ANTHROPIC_*`, `CLAUDE_*`) and leave the rest loaded.

## 4. The project's app still reads its own .env
**Decision:** Only runcastle's own processes and the agent sessions are covered. The project's dev command, setup and teardown hooks, scenarios and design server run exactly as before, so a project app that loads its `.env` keeps doing so.
**Why:** The brief's boundary: the drive must run the app the way it always has. The flag goes on runcastle's Bun launches, never on the project's commands.
**Assumed.** Alternative: also strip Anthropic keys from the project's commands' environment.

## 5. Two guards against the leak coming back
**Decision:** Both kinds of check go in. Behaviour tests start real Bun processes the way runcastle does (a session adapter, a hook, the server's boot) from a folder whose `.env` holds a fake Anthropic key, and fail if the key is seen. A source scan fails the test run if any server code starts Bun without going through the one shared launch helper.
**Why:** The behaviour tests prove the leak is closed today; the scan catches a new Bun launch added later that the behaviour tests don't know about. Chosen over only one of them, since each misses what the other catches.
**Assumed.** Alternative: only the behaviour tests, accepting that a brand-new Bun launch could slip past.

## 6. The setup check notes when sessions will bill an API key
**Decision:** The startup health check (the doctor) gains one information line when `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN` is set in runcastle's environment after the fix (so it came from the shell): "Sessions will bill the API key in ANTHROPIC_API_KEY, not your Claude subscription." It never fails the check or blocks setup. It shows wherever the doctor already shows: the `runcastle doctor` output, the first-run wizard and Settings.
**Why:** A key exported in a shell profile for another tool is easy to forget, and "Credit balance is too low" from a review worker gives no hint of it. Informational only, so a user billing a key on purpose is not nagged into changing anything.
**Assumed.** Alternative: no doctor line; rely on the fix alone. (The orchestrator proposed this; the human did not answer it.)
