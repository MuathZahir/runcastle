# Outcome — Codex burns on the ChatGPT subscription

Make AFK Codex ticket burns run on the user's ChatGPT login (borrowed ~/.codex/auth.json) instead of requiring a pay-per-token CODEX_API_KEY, and make "Codex ready" mean the same thing everywhere: logged in.

- Shipped: 2026-08-27
- Lap: 1

## 1. Container Codex burns borrow the ChatGPT login

# ticket 1 — Container Codex burns borrow the ChatGPT login

## What was done

A new `packages/server/src/services/codex-auth.ts` holds the one readiness predicate
(`codexHomeDir`, `codexAuthFile`, `codexLoggedIn`, all pure over an injected env and an
injected file check). The doctor's private `codexAuthFile` moved into it and both the doctor
spec and the launcher's `realCodexAuthFile` now resolve the path through it.

In the burner, `codexAuthMountFor(runtime, sandbox, env, loggedIn)` returns the read-only
`/mnt/host-codex` mount (exported as `CODEX_HOST_MOUNT_PATH`) for a codex model in a container
mode, and `buildCodexAuthCopyCommand()` renders the `mkdir -p "$HOME/.codex" && cp …auth.json`
step. `chainSetupCommands(...)` replaced the old two-argument `withGuard` closure so the
sandbox-ready command is copy → guard → install, in that order; claude-code burns render
byte-identically to before. `research.ts` reuses the same two helpers (it previously passed no
mounts and had no `onSandboxReady` hook at all).

Readiness: `burnAuthReady(runtime, token, loggedIn)` — a token always counts (the silent
`CODEX_API_KEY` override), and for codex a host login counts on its own. `resolveBurnDeps` and
`resolveResearchDeps` compute `hasAuthToken` through it, and `BurnDeps` gained an optional
`ticketAuthMissing(ticket)` that `burnRun` wraps the executor with, so a codex-assigned ticket
inside a claude run fails with `auth.missing` (carrying its `ticketId`) instead of building a
container. `RUNTIME_AUTH_SETUP_HINT.codex` is now "Run `codex login` on this host, then burn
again" and names no API key; `RUNTIME_AUTH_KEY.codex` is untouched, because the override needs it.

**Deviations from the ticket.** Two, both deliberate:

1. `codexAuthMountFor` also returns `undefined` when the host has no `auth.json`. A bind mount
   whose `hostPath` does not exist fails sandbox creation outright, so an operator burning on a
   hand-set `CODEX_API_KEY` with no `~/.codex` would have been broken by an unconditional mount.
2. The ticket listed four new fatal patterns for the codex classifier; `/unauthorized/i` and the
   `authentication` half of `/\bauth(entication)? (failed|required)\b/i` are already fatal for
   every runtime via the shared `FATAL_ERROR_PATTERNS`, so only the wordings that were *not*
   already covered were added (`/not logged in/i`, `/\bauth (failed|required)\b/i`,
   `/refresh token/i`), with a comment saying why. All four wordings are pinned as fatal by tests.

## Surprises

- `bun test packages/server` is not this repo's runner — the suite is vitest (`bun run test`);
  targeted runs are `bunx vitest run <file>`.
- **One test fails, and it is not this ticket's**: `packages/server/test/dev-pane.test.ts` >
  "kills the child process tree so the port-holder is not orphaned". It asserts a native-PTY
  process group is fully reaped after a fixed 400 ms delay — a container process-reaping timing
  fault. Nothing in this diff is in its import graph (it pulls `src/pty/*` and
  `src/services/events` only). Everything else is green: 2207 passed, 4 skipped, 1 failed.
  Note also that the prompt's baseline (118 files / 1768 tests) is stale for this branch, which
  has 133 files / 2212 tests.
- `research.ts`'s test helper builds `ResearchDeps` without the required `runtime` field, so the
  research suite is evidently not typechecked; new tests there must pass `runtime` explicitly.

## Left undone

- The doctor's Codex probes still include the `afk-key` check and `RUNTIME_SPECS.codex.afkFix`
  still describes minting an OpenAI key — ticket 2's territory, deliberately untouched.
- The stale Claude-only AFK-auth prose in `CONTEXT.md`, `README.md` and `docs/SPEC.md`, and the
  one-line note that `CODEX_API_KEY` survives as a silent override, are still unwritten.
- Drive machinery (`.runcastle/drive-setup.ts` etc.) was checked and needs no edit: this ticket
  adds no service, no boot-required env var, no seed and no extra process — a borrowed host
  login is not something the dev environment provisions. Nothing under `.runcastle/` was run
  (no services in this sandbox), only reasoned about.

## 2. Doctor and setup hints define Codex ready as logged in

# ticket 2 — Doctor and setup hints define Codex ready as logged in

## What was done

`RUNTIME_SPECS.codex` lost its `ids.afkKey`, and `ids.afkKey` became optional on
`RuntimeSpec`. `runtimeAfkKeyProbe` now returns `undefined` for a spec without that id
and `runtimeProbes` drops it from the list, so a Codex report is exactly `binary` + `auth`
and no `codex-api-key` result exists anywhere; Claude Code still yields all three.

`runtimeAuthProbe` inverted for any runtime that has an `authFile`: `fileExists(authFile)`
decides ok/fail, and `<bin> <status args>` now only decorates the detail line. When the two
disagree the detail says so in as many words ("credentials found at …, but `codex login
status` reports logged out — burns borrow the file, so this host counts as signed in", and
the mirror image when the file is missing but the CLI exits 0). Runtimes with no auth file
(Claude Code, whose credentials can live in the macOS Keychain) keep the old CLI-decides
path byte for byte. Codex's `afkFix` was reworded from "create an OpenAI API key" to
"set CODEX_API_KEY … to bill an API key instead of your ChatGPT login" — the same string,
now describing the override it has become rather than a setup step.

`CONTEXT.md`, `README.md` and `docs/SPEC.md` each gained a short both-runtimes paragraph
(Claude burns on `claude setup-token` → `CLAUDE_CODE_OAUTH_TOKEN`, Codex burns borrow the
`codex login` credentials) plus the one-line note that a hand-set `CODEX_API_KEY` still
overrides. Two stale Claude-only phrasings in `CONTEXT.md` (:3 and locked decision 3) were
made runtime-neutral in passing.

**Deviations, both deliberate.** The ticket asked me to drop `afkKey` / `afkNoun` / `afkFix`
from the codex spec entry and to re-declare `CODEX_API_KEY` in `setup.ts` as a literal.
I dropped only `ids.afkKey`, because those three fields are *not* dead: `saveAfkCredential`
and `createCredentialVerifier` read them for the `afkToken` tRPC route, which the same
ticket told me to leave alone, and `setup.test.ts` — which the ticket and criterion 3 both
require to stay green — pins codex capture writing `CODEX_API_KEY` and the verifier saying
"API key". Removing the fields would have meant either breaking that route or rebuilding
its facts in `setup.ts`. The probe id is the honest marker anyway: it says "this runtime
reports an AFK-key check", which is precisely what changed. `CODEX_API_KEY` therefore stays
derived from the spec (one source of truth); `RUNTIME_AUTH_KEY.codex === 'CODEX_API_KEY'`
still holds, which is what criterion 3 actually asks for.

## Surprises

- **The two instructions in the ticket cannot both be honoured.** "Drop the AFK-key fields
  from the codex entry" and "keep `setup.test.ts` green" are in direct conflict, because
  `saveAfkCredential(io, value, 'codex')` and `createCredentialVerifier(exec, 'codex')` read
  `spec.afkKey` / `spec.afkNoun` / `spec.afkFix` and two live tests assert their output. The
  ticket's own parenthetical suggests the author only had `RUNTIME_AUTH_KEY.codex` in mind.
- Two tests inside the range the ticket flagged needed more than a tweak: the codex-only
  operator test (`:181`) passed a `CODEX_API_KEY` and asserted `codex-api-key` was `ok`, so
  it now signs in with a file instead; and `:240` "reads each runtime AFK credential from its
  own env var" became claude-only, since codex has no such row to read.
- `packages/server/src/doctor/report.ts` needed nothing — it maps over whatever results it is
  given and never assumed three per runtime, so a two-check Codex block renders as-is.
- **One test fails and it is not this ticket's** — the same one ticket 1 flagged:
  `packages/server/test/dev-pane.test.ts` > "kills the child process tree so the port-holder
  is not orphaned", a native-PTY process-group reaping race in this container. Its imports
  are `src/pty/*` and `src/services/events` only; nothing in this diff is in that graph.
  Everything else: 2217 passed, 4 skipped, 1 failed. `bun run typecheck` is fully green.
  (The prompt's stated baseline of 118 files / 1768 tests is stale for this branch —
  it is 134 files / 2222 tests, and `bun test packages/server` is not the runner; vitest is.)

## Left undone

- `.runcastle/drive-setup.ts:117` still carries a comment describing `CODEX_API_KEY` as *the*
  Codex burn credential. It is one stale comment in the drive machinery, not a document the
  ticket named, so I left it. Drive machinery otherwise needs no edit: this ticket adds no
  service, no boot-required env var, no seed and no extra process. I checked that by reading
  the scripts, not by running them — this sandbox has no services or app.
- `packages/server/src/doctor/cli.ts` still merges every runtime's `afkKey` from
  `~/.runcastle/.env` into the doctor's env, including Codex's, which now feeds no probe.
  Harmless and generically correct, but it is dead work today; whoever removes the Codex
  override entirely should delete that half.
- `docs/features/codex-runtime-support/decisions.md` (#5, #6) still states the old rule that
  AFK Codex burns require `CODEX_API_KEY`. That is a superseded feature's own record, so it
  reads correctly as history; only the live project documents were refreshed.

## 3. First-run wizard and Enable-AFK card treat Codex as signed in or not

# Ticket 3 — First-run wizard and Enable-AFK card treat Codex as signed in or not

## What was done

`runtimeReadiness` in `apps/web/src/lib/first-run.ts` is now per-runtime: for Codex,
`afkReady` is simply `authed` (the burn borrows the file `codex login` writes, so the
login *is* the unattended credential), which collapses `talkReady` to installed ∧ authed
without changing the shared expression. Claude Code is byte-for-byte unchanged. The
first-run wizard needed no edit at all: its card state (`ready` / `sign in` / `not
installed`) and its AFK nudge (`talkReady && !afkReady`) both fall out of that, so a
signed-out Codex shows the `codex login` button it already had and a signed-in one shows
`ready` with no nudge and no key copy.

The Enable-AFK card's row source moved from `results.filter(check === 'afk-key')` to a new
pure `afkCredentialRows` in `apps/web/src/lib/afk-rows.ts`, which returns one row per
runtime in `AGENT_RUNTIMES` and names which probe drives it — `afk-key` for Claude Code
(kind `token`), `auth` for Codex (kind `sign-in`). A stray Codex `afk-key` probe from an
older server drives no row. The card renders the Claude row through the untouched
`CredentialRow` and the Codex row through a new `SignInRow`: "Codex — Signed in" when the
auth probe is ok, otherwise one **Sign in** button that starts `setup.startTerminal` with
the kind from the existing `RUNTIME_LOGIN` table and re-checks the doctor when the terminal
is closed. The codex `AFK_CREDENTIAL` entry and its "Paste an OpenAI API key /
platform.openai.com" copy are gone (the table is now `Partial<Record<…>>`, since only
Claude Code has anything to capture), as is the card intro's "a key for each agent".

Verified: `bun run typecheck` — 0 errors. `env -u GIT_ASKPASS bun run test` — 2184 passed,
1 failed (see below). New unit tests in `apps/web/test/afk-rows.test.ts`; the "afkReady
alone counts as talkReady" test in `first-run.test.ts` is now Claude-only, with two Codex
cases added. No `.runcastle/` drive edits: this ticket adds no service, env var, seed or
process.

## Surprises

- `packages/server/test/dev-pane.test.ts > "kills the child process tree so the port-holder
  is not orphaned"` fails **deterministically** in this sandbox (`pidAlive(-pgid)` is still
  true after the kill — a PID-namespace/process-group artifact of the container). It is not
  in the ticket's stated baseline and is untouchable by an `apps/web`-only diff; I confirmed
  it on one targeted run and left it alone. The stated baseline is also stale in size — the
  suite is 133 files / 2189 tests here, not 118 / 1768.
- The wizard needed zero changes, which is worth knowing before someone goes looking: every
  Codex behaviour the ticket asks for is downstream of the `afkReady` line.

## Left undone

- `SignInRow`'s "embedded terminal + Done — re-check" block is the same shape as `ImageRow`'s
  and as the wizard's `RuntimeCard` — three copies across two files now. Extracting a shared
  slot is a worthwhile cleanup but is adjacent work in code this ticket does not own.
- The Codex row shows its **Sign in** button even when the Codex binary is missing (the auth
  probe then reads `missing`, and its detail line says so). The ticket specifies one button
  unconditionally, so I did not gate it on the binary probe the way `ImageRow` gates on the
  container runtime — a small follow-up if the dead-end terminal proves confusing.
- Server-side "OpenAI API key" copy still exists in `packages/server/src/doctor/doctor.ts`
  (`afkFix`) and `setup.ts`; that is ticket 2's territory, not the web app's.

## 4. Review: Codex burns on the ChatGPT subscription

This lap removes a credential. Until now, running a Codex ticket unattended meant pasting a pay-per-token OpenAI API key into the Enable-AFK card — a second, separately-billed thing to set up, even though you had already signed into Codex to use it interactively. After this lap, an AFK Codex burn runs on the ChatGPT plan you already pay for. The burn container mounts your Codex home read-only and copies exactly one file into itself, the `auth.json` that `codex login` wrote. Nothing else comes across: your interactive settings — approval policy, sandbox mode, trusted projects — deliberately stay on your machine, and because the mount is read-only, a container that refreshes its token can never damage the original.

The other half of the lap is that "Codex is ready" finally means one thing. It used to mean three: the launcher wanted a login, the first-run wizard would accept an API key on its own, and the doctor asked for the key — so the wizard could tell you that you were done and the launcher could then refuse to start a session. All of them now ask the same question of the same file. The doctor still runs `codex login status`, but only to narrate; when the CLI and the file disagree it now says so out loud rather than quietly picking the wrong one. Your only Codex setup step is `codex login`, and the Enable-AFK card's Codex row reflects that — it is either green or it is a single Sign in button, with no paste box anywhere. An API key you had already put in `~/.runcastle/.env` by hand still works and still wins; it is simply never asked for again.

What deserves your attention is a side effect the spec did not ask for. Making the auth check run per ticket — a genuine improvement, since a Codex ticket inside a Claude run used to burn a whole container just to discover it could not log in — also put that check in front of review tickets, which never run in a container at all. They run on your own machine, on your own login. So in a containerised run, a review ticket assigned to a runtime whose unattended token is missing will now be failed before it starts, even though it would have worked. That is the one finding here worth a fix ticket, and it is new to this lap.

You should also know how thin the evidence under this review is. The drive never started: your checkout has one untracked file left over from the next feature's scaffold, and the guard refused on that, so I neither ran the test suite nor opened the app. I can tell you the branch's tests assert the right things — the read-only mount, the `auth.json`-only copy, the API key still reaching the container, the doctor deciding by the file — but not that they pass. The Enable-AFK card is the weakest spot: I could not click it, and `apps/web` has no component-rendering tests, so nothing anywhere has confirmed the new Sign in row actually renders and opens the login terminal. Commit or stash that stray file and this review can close both gaps in a second pass. Everything else — the Claude side untouched, the stale docs refreshed — checks out on reading, with four smaller code-quality notes that are worth a look but not a blocker.
