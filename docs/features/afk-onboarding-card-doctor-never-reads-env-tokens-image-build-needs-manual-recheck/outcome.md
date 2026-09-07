# Outcome — AFK onboarding card: doctor never reads .env tokens, image build needs manual recheck

Bug: the AFK card's Claude Code token row stays amber ('no CLAUDE_CODE_OAUTH_TOKEN') even after Save & verify succeeds ('OAuth token captured to ~/.runcastle/.env'). Root cause: the tRPC doctor query (packages/server/src/trpc/routers/setup.ts:43) calls runDoctor without an `env`, so the afk-token probe reads bare process.env (packages/server/src/doctor/doctor.ts:604). The CLI doctor path already fixes this — packages/server/src/doctor/cli.ts:27-41 merges every runtime's afkKey from ~/.runcastle/.env over process.env — but the server tRPC path never got the merge, so a token saved to .env is permanently invisible to the web doctor. Fix: extract the CLI's .env-merge helper (or reuse it) and pass the merged env from the tRPC doctor route too, so a fresh read of ~/.runcastle/.env happens on every doctor query — not a boot-time snapshot, since Save & verify writes the file while the server is running. Regression test in packages/server/test: with CLAUDE_CODE_OAUTH_TOKEN present in the data-dir .env but absent from process.env, the tRPC doctor report marks the afk-token probe ok.

- Shipped: 2026-09-07
- Laps run: 1

## What shipped

4 commits · 9 files

### Lap 1
- 2 tickets landed: #1 Bug: the AFK card's Claude Code token row stays amber ('no…; #2 UX: building the sandcastle image from the AFK card requires manually…
- 0 waived
- 0 failed

## Review record

### Lap 1 · review

- Reviewed commit: a6e2ede3261750428bd624cc307aaceaca3758c5
- Landed since: 0
- Outcome: done

- **Saved Claude Code token is recognized by the next web doctor check** — open
- **Image build exit automatically rechecks doctor while preserving the manual fallback** — open

## Notes record

- No human notes

## Per-ticket digests

### Lap 1

#### 1. Bug: the AFK card's Claude Code token row stays amber ('no…

# ticket(1) — the web doctor now reads AFK tokens from `~/.runcastle/.env`

## What was done

The `.env`-merge helper that only the CLI doctor had was extracted verbatim out of
`packages/server/src/doctor/cli.ts` into a new module,
`packages/server/src/doctor/afk-env.ts`, exporting `envWithAfkCredentials()`. The CLI now
imports it (its `resolveDoctorEnv` is otherwise unchanged), and the tRPC `setup.doctor`
query in `packages/server/src/trpc/routers/setup.ts` passes `env: envWithAfkCredentials()`
to `runDoctor`. The helper reads the file on every call, so a token that "Save & verify"
writes while the server is running is visible to the very next doctor query — no boot-time
snapshot. A regression test at the tRPC seam,
`packages/server/test/setup-doctor-env.test.ts`, points the data dir at a temp home
containing a `.env` with `CLAUDE_CODE_OAUTH_TOKEN`, deletes that variable from
`process.env`, and asserts the `afk-token` probe in `caller.setup.doctor()` reports `ok`.
It was red ("expected 'unset' to be 'ok'") before the fix. One stale doc comment in
`doctor.ts` — which said only the CLI merges the env file — was corrected in the same
commit. No deviation from the approach the ticket described.

## Surprises

- The stated baseline is out of date in two ways. The suite is 225 files / 3283 tests, not
  the 118 / 1768 the prompt lists, and it is **not** fully green: `dev-pane.test.ts:183`
  ("expect(pidAlive(-pgid)).toBe(false)") fails. I confirmed it is pre-existing by running
  that one file against the pre-change server sources (`git checkout HEAD~1 --
  packages/server/src`, run, restore) — it fails identically there. It is a process-group
  SIGKILL assertion in this container, untouched by this diff. Everything else passes.
- The tRPC doctor route still spawns real `--version` probes in the test, but with no
  runtimes installed in the sandbox they all fail fast; the new test runs in ~0.5s and
  needed nothing like the CLI test's 15s budget (it carries a 20s one anyway, matching the
  convention for real-process tests in this package).

## Left undone

- The tRPC route still passes no `cwd` or `platform` to `runDoctor`, so its git-identity
  probe reads the server process's cwd rather than a project's, and platform defaults
  inside the probe library. The CLI path passes both. Out of scope here, but it is the same
  class of "the tRPC path never got the CLI's wiring" bug.
- No `.runcastle/` drive-machinery change was needed: this ticket adds no service, no
  required env var read at boot, no seed and no extra process. I read the drive scripts'
  contract only; I did not run `drive-setup`/`drive-stop` (the sandbox has no services or
  app, as the brief instructs).
- Ticket 2 (auto-recheck on build-terminal exit) is untouched.

#### 2. UX: building the sandcastle image from the AFK card requires manually…

# Ticket 2 — the image build re-checks the AFK checklist when it exits

## What was done

The exit signal turned out to be reachable end to end already, so no new plumbing
was needed and no polling was added. The PTY registry sends a `{t:'status',
status:'ended', exitCode}` control frame when the process exits; `TerminalClient`
turns that into `onStatus('ended')`; the signal simply stopped at `TerminalView`'s
local state, which used it only to render the "session stream ended" strip. So:
`TerminalView` gained an optional `onEnded` prop (held in a ref, like
`apps/web/src/lib/live.ts:274`, so an inline closure does not tear down and
reconnect the terminal each render), `RowTerminal` gained a matching `onEnded`
that is deliberately distinct from its `onDone`, and the AFK card's image row
passes `onEnded={onDone}` — the build's exit re-checks the doctor report, success
or failure alike, and the probe decides whether the image is now present. The
terminal and the "Done — re-check" button both stay up after the exit: the log is
what says *why* a build failed, and the button remains the fallback for a socket
that dies before the exit frame arrives. Two tests in
`apps/web/test/enable-afk-card.test.ts` cover it, with `TerminalView` stubbed
(xterm wants a laid-out canvas) and `setup.startTerminal` now firing its
`onSuccess` so the terminal actually mounts.

## Surprises

- The stated verify baseline is stale in two ways. It says 118 files / 1768
  tests; the suite is actually 224 files / 3284 tests. And it says fully green,
  but `packages/server/test/dev-pane.test.ts > kills the child process tree so
  the port-holder is not orphaned` fails — `pidAlive(-pgid)` is still true after
  the kill. It reproduces on a targeted run and is a container process-reaping
  artefact: this diff touches only three `apps/web` files and nothing that test
  imports. Everything else passes (3279 passed, 4 skipped), and `bun run
  typecheck` is clean.
- `TerminalClient` also reports `ended` when the server has no live PTY for the
  id at all (attach fails, it sends `ended` and closes). That path now triggers a
  re-check too, which is harmless and arguably right — the probe is the judge.

## Left undone

- `SignInRow` and `CredentialRow` open terminals through the same `RowTerminal`
  and could take the same `onEnded` for free — `claude setup-token` exiting could
  re-check as well. Out of this ticket's scope, deliberately not done.
- Drive machinery needed no edit: this change adds no service, required env var,
  seed, or long-running process. I did not run `.runcastle/drive-setup.ts` or
  `drive-stop.ts` (no services in the sandbox) and did not need to read them,
  since nothing here changes what the dev environment must provide.
